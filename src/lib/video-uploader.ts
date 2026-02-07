import crypto from "crypto";
import axios from "axios";
import { RegionInfo, request } from "@/api/controllers/core.ts";
import { createSignature } from "@/lib/aws-signature.ts";
import logger from "@/lib/logger.ts";

/**
 * 视频上传模块 - 支持上传视频到 Jimeng VOD 服务
 */

/**
 * 上传视频 Buffer
 * @param videoBuffer 视频数据
 * @param refreshToken 刷新令牌
 * @param regionInfo 区域信息
 * @returns 视频 URI
 */
export async function uploadVideoBuffer(
  videoBuffer: ArrayBuffer | Buffer,
  refreshToken: string,
  regionInfo: RegionInfo
): Promise<string> {
  try {
    logger.info(`开始上传视频Buffer... (isInternational: ${regionInfo.isInternational})`);

    // 第一步：获取上传令牌 (scene=1 表示视频上传)
    const tokenResult = await request("post", "/mweb/v1/get_upload_token", refreshToken, {
      data: {
        scene: 1, // 视频上传场景
      },
    });

    const { access_key_id, secret_access_key, session_token, space_name, upload_domain } = tokenResult;

    if (!access_key_id || !secret_access_key || !session_token) {
      throw new Error("获取上传令牌失败");
    }

    logger.info(`获取视频上传令牌成功: space_name=${space_name}, upload_domain=${upload_domain}`);

    // 准备文件信息
    const fileSize = videoBuffer.byteLength;
    const crc32 = calculateCRC32(videoBuffer);
    logger.info(`视频Buffer: 大小=${fileSize}字节, CRC32=${crc32}`);

    // 第二步：申请视频上传权限
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const randomStr = Math.random().toString(36).substring(2, 12);

    const applyUrl = `${upload_domain}/?Action=ApplyUploadInner&Version=2020-11-19&SpaceName=${space_name}&FileType=video&IsInner=1&FileSize=${fileSize}&s=${randomStr}`;

    const awsRegion = RegionUtils.getAWSRegion(regionInfo);
    const origin = RegionUtils.getOrigin(regionInfo);

    const requestHeaders = {
      'x-amz-date': timestamp,
      'x-amz-security-token': session_token
    };

    const authorization = createSignature('GET', applyUrl, requestHeaders, access_key_id, secret_access_key, session_token, '', awsRegion);

    logger.info(`申请视频上传权限: ${applyUrl}`);

    let applyResponse;
    try {
      applyResponse = await axios({
        method: 'GET',
        url: applyUrl,
        headers: {
          'accept': '*/*',
          'accept-language': 'zh-CN,zh;q=0.9',
          'authorization': authorization,
          'origin': origin,
          'referer': `${origin}/ai-tool/generate`,
          'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'cross-site',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
          'x-amz-date': timestamp,
          'x-amz-security-token': session_token,
        },
        validateStatus: () => true,
      });
    } catch (fetchError: any) {
      logger.error(`Fetch请求失败，目标URL: ${applyUrl}`);
      logger.error(`错误详情: ${fetchError.message}`);
      throw new Error(`网络请求失败 (${upload_domain}): ${fetchError.message}. 请检查网络连接`);
    }

    if (applyResponse.status < 200 || applyResponse.status >= 300) {
      const errorText = typeof applyResponse.data === 'string' ? applyResponse.data : JSON.stringify(applyResponse.data);
      throw new Error(`申请视频上传权限失败: ${applyResponse.status} - ${errorText}`);
    }

    const applyResult = applyResponse.data;

    if (applyResult?.ResponseMetadata?.Error) {
      throw new Error(`申请视频上传权限失败: ${JSON.stringify(applyResult.ResponseMetadata.Error)}`);
    }

    logger.info(`申请视频上传权限成功`);

    // 解析上传信息
    const innerUploadAddress = applyResult?.Result?.InnerUploadAddress;
    if (!innerUploadAddress || !innerUploadAddress.UploadNodes || innerUploadAddress.UploadNodes.length === 0) {
      throw new Error(`获取上传地址失败: ${JSON.stringify(applyResult)}`);
    }

    // 选择第一个上传节点
    const uploadNode = innerUploadAddress.UploadNodes[0];
    const storeInfo = uploadNode.StoreInfos[0];
    const uploadHost = uploadNode.UploadHost;
    const auth = storeInfo.Auth;
    const uploadUrl = `https://${uploadHost}/upload/v1/${storeInfo.StoreUri}`;
    const sessionKey = uploadNode.SessionKey;

    logger.info(`准备上传视频: uploadUrl=${uploadUrl}`);

    // 第三步：上传视频文件
    let uploadResponse;
    try {
      uploadResponse = await axios({
        method: 'POST',
        url: uploadUrl,
        headers: {
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Authorization': auth,
          'Connection': 'keep-alive',
          'Content-CRC32': crc32,
          'Content-Disposition': 'attachment; filename="undefined"',
          'Content-Type': 'application/octet-stream',
          'Origin': origin,
          'Referer': `${origin}/`,
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'cross-site',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
          'X-Storage-U': Date.now().toString(),
        },
        data: videoBuffer,
        validateStatus: () => true,
      });
    } catch (fetchError: any) {
      logger.error(`视频文件上传fetch请求失败，目标URL: ${uploadUrl}`);
      logger.error(`错误详情: ${fetchError.message}`);
      throw new Error(`视频上传网络请求失败 (${uploadHost}): ${fetchError.message}. 请检查网络连接`);
    }

    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
      const errorText = typeof uploadResponse.data === 'string' ? uploadResponse.data : JSON.stringify(uploadResponse.data);
      throw new Error(`视频上传失败: ${uploadResponse.status} - ${errorText}`);
    }

    logger.info(`视频文件上传成功`);

    // 第四步：提交上传
    const commitUrl = `${upload_domain}/?Action=CommitUploadInner&Version=2020-11-19&SpaceName=${space_name}`;
    const commitTimestamp = new Date().toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const commitPayload = JSON.stringify({
      SessionKey: sessionKey,
      Functions: []
    });

    const payloadHash = crypto.createHash('sha256').update(commitPayload, 'utf8').digest('hex');

    const commitRequestHeaders = {
      'x-amz-date': commitTimestamp,
      'x-amz-security-token': session_token,
      'x-amz-content-sha256': payloadHash
    };

    const commitAuthorization = createSignature('POST', commitUrl, commitRequestHeaders, access_key_id, secret_access_key, session_token, commitPayload, awsRegion);

    let commitResponse;
    try {
      commitResponse = await axios({
        method: 'POST',
        url: commitUrl,
        headers: {
          'accept': '*/*',
          'accept-language': 'zh-CN,zh;q=0.9',
          'authorization': commitAuthorization,
          'content-type': 'text/plain;charset=UTF-8',
          'origin': origin,
          'referer': `${origin}/`,
          'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'cross-site',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
          'x-amz-date': commitTimestamp,
          'x-amz-security-token': session_token,
          'x-amz-content-sha256': payloadHash,
        },
        data: commitPayload,
        validateStatus: () => true,
      });
    } catch (fetchError: any) {
      logger.error(`提交视频上传fetch请求失败，目标URL: ${commitUrl}`);
      logger.error(`错误详情: ${fetchError.message}`);
      throw new Error(`提交上传网络请求失败 (${upload_domain}): ${fetchError.message}. 请检查网络连接`);
    }

    if (commitResponse.status < 200 || commitResponse.status >= 300) {
      const errorText = typeof commitResponse.data === 'string' ? commitResponse.data : JSON.stringify(commitResponse.data);
      throw new Error(`提交视频上传失败: ${commitResponse.status} - ${errorText}`);
    }

    const commitResult = commitResponse.data;

    if (commitResult?.ResponseMetadata?.Error) {
      throw new Error(`提交视频上传失败: ${JSON.stringify(commitResult.ResponseMetadata.Error)}`);
    }

    if (!commitResult?.Result?.Results || commitResult.Result.Results.length === 0) {
      throw new Error(`提交视频上传响应缺少结果: ${JSON.stringify(commitResult)}`);
    }

    const uploadResult = commitResult.Result.Results[0];
    const videoMeta = uploadResult.VideoMeta;

    if (!videoMeta || !videoMeta.Uri) {
      throw new Error(`视频上传响应缺少 URI: ${JSON.stringify(uploadResult)}`);
    }

    const fullVideoUri = videoMeta.Uri;
    logger.info(`视频上传完成: ${fullVideoUri}, 宽度: ${videoMeta.Width}, 高度: ${videoMeta.Height}, 时长: ${videoMeta.Duration}s`);

    return fullVideoUri;
  } catch (error: any) {
    logger.error(`视频Buffer上传失败: ${error.message}`);
    throw error;
  }
}

/**
 * 从URL下载并上传视频
 * @param videoUrl 视频 URL
 * @param refreshToken 刷新令牌
 * @param regionInfo 区域信息
 * @returns 视频 URI
 */
export async function uploadVideoFromUrl(
  videoUrl: string,
  refreshToken: string,
  regionInfo: RegionInfo
): Promise<string> {
  try {
    logger.info(`开始从URL下载并上传视频: ${videoUrl}`);

    const videoResponse = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
    });
    if (videoResponse.status < 200 || videoResponse.status >= 300) {
      throw new Error(`下载视频失败: ${videoResponse.status}`);
    }

    const videoBuffer = videoResponse.data;
    return await uploadVideoBuffer(videoBuffer, refreshToken, regionInfo);
  } catch (error: any) {
    logger.error(`从URL上传视频失败: ${error.message}`);
    throw error;
  }
}

/**
 * 处理本地上传的视频文件
 * @param file 视频文件
 * @param refreshToken 刷新令牌
 * @param regionInfo 区域信息
 * @returns 视频 URI
 */
export async function uploadVideoFromFile(file: any, refreshToken: string, regionInfo: RegionInfo): Promise<string> {
  try {
    logger.info(`开始从本地文件上传视频: ${file.originalFilename} (路径: ${file.filepath})`);
    const fs = await import('fs-extra');
    const videoBuffer = await fs.readFile(file.filepath);
    return await uploadVideoBuffer(videoBuffer, refreshToken, regionInfo);
  } catch (error: any) {
    logger.error(`从本地文件上传视频失败: ${error.message}`);
    throw error;
  }
}

/**
 * 计算 CRC32 校验和
 * @param data 数据
 * @returns CRC32 值 (十六进制字符串)
 */
function calculateCRC32(data: ArrayBuffer | Buffer): string {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // CRC32 算法实现
  let crc = 0xFFFFFFFF;
  const polynomial = 0xEDB88320;

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ polynomial;
      } else {
        crc = crc >>> 1;
      }
    }
  }

  crc = crc ^ 0xFFFFFFFF;
  // 转换为无符号整数，然后转换为十六进制字符串
  const crcValue = crc >>> 0;
  return crcValue.toString(16);
}

// 导入 RegionUtils (延迟导入以避免循环依赖)
import { RegionUtils } from "@/lib/region-utils.ts";
