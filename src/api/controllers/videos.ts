import _ from "lodash";
import fs from "fs-extra";
import axios from "axios";

import APIException from "@/lib/exceptions/APIException.ts";

import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request, parseRegionFromToken, getAssistantId, RegionInfo } from "./core.ts";
import logger from "@/lib/logger.ts";
import { SmartPoller, PollingStatus } from "@/lib/smart-poller.ts";
import { DEFAULT_ASSISTANT_ID_CN, DEFAULT_ASSISTANT_ID_US, DEFAULT_ASSISTANT_ID_HK, DEFAULT_ASSISTANT_ID_JP, DEFAULT_ASSISTANT_ID_SG, DEFAULT_VIDEO_MODEL, DRAFT_VERSION, VIDEO_MODEL_MAP, VIDEO_MODEL_MAP_US, VIDEO_MODEL_MAP_ASIA } from "@/api/consts/common.ts";
import { uploadImageBuffer } from "@/lib/image-uploader.ts";
import { extractVideoUrl } from "@/lib/image-utils.ts";
import { uploadVideoBuffer } from "@/lib/video-uploader.ts";

export const DEFAULT_MODEL = DEFAULT_VIDEO_MODEL;

export function getModel(model: string, regionInfo: RegionInfo) {
  // 根据站点选择不同的模型映射
  let modelMap: Record<string, string>;
  if (regionInfo.isUS) {
    modelMap = VIDEO_MODEL_MAP_US;
  } else if (regionInfo.isHK || regionInfo.isJP || regionInfo.isSG) {
    modelMap = VIDEO_MODEL_MAP_ASIA;
  } else {
    modelMap = VIDEO_MODEL_MAP;
  }
  return modelMap[model] || modelMap[DEFAULT_MODEL] || VIDEO_MODEL_MAP[DEFAULT_MODEL];
}

function getVideoBenefitType(model: string, mode: string = "text_to_video"): string {
  // Seedance 2.0 模型
  if (model.includes("seedance_40")) {
    // 全能参考模式使用不同的 benefit_type
    if (mode === "omni_reference") {
      return "dreamina_video_seedance_20_video_add";
    }
    return "dreamina_video_seedance_20_pro";
  }
  // veo3.1 模型 (需先于 veo3 检查)
  if (model.includes("veo3.1")) {
    return "generate_video_veo3.1";
  }
  // veo3 模型
  if (model.includes("veo3")) {
    return "generate_video_veo3";
  }
  // sora2 模型
  if (model.includes("sora2")) {
    return "generate_video_sora2";
  }
  if (model.includes("3.5_pro")) {
    return "dreamina_video_seedance_15_pro";
  }
  if (model.includes("3.5")) {
    return "dreamina_video_seedance_15";
  }
  return "basic_video_operation_vgfm_v_three";
}

// 处理本地上传的文件
async function uploadImageFromFile(file: any, refreshToken: string, regionInfo: RegionInfo): Promise<string> {
  try {
    logger.info(`开始从本地文件上传视频图片: ${file.originalFilename} (路径: ${file.filepath})`);
    const imageBuffer = await fs.readFile(file.filepath);
    return await uploadImageBuffer(imageBuffer, refreshToken, regionInfo);
  } catch (error: any) {
    logger.error(`从本地文件上传视频图片失败: ${error.message}`);
    throw error;
  }
}

// 处理来自URL的图片
async function uploadImageFromUrl(imageUrl: string, refreshToken: string, regionInfo: RegionInfo): Promise<string> {
  try {
    logger.info(`开始从URL下载并上传视频图片: ${imageUrl}`);
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
    });
    if (imageResponse.status < 200 || imageResponse.status >= 300) {
      throw new Error(`下载图片失败: ${imageResponse.status}`);
    }
    const imageBuffer = imageResponse.data;
    return await uploadImageBuffer(imageBuffer, refreshToken, regionInfo);
  } catch (error: any) {
    logger.error(`从URL上传视频图片失败: ${error.message}`);
    throw error;
  }
}

// 处理来自URL的视频
async function uploadVideoFromUrl(videoUrl: string, refreshToken: string, regionInfo: RegionInfo): Promise<string> {
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

// 处理本地上传的视频文件
async function uploadVideoFromFile(file: any, refreshToken: string, regionInfo: RegionInfo): Promise<string> {
  try {
    logger.info(`开始从本地文件上传视频: ${file.originalFilename} (路径: ${file.filepath})`);
    const videoBuffer = await fs.readFile(file.filepath);
    return await uploadVideoBuffer(videoBuffer, refreshToken, regionInfo);
  } catch (error: any) {
    logger.error(`从本地文件上传视频失败: ${error.message}`);
    throw error;
  }
}

// 处理全能参考素材列表
async function uploadMaterials(materials: any[], refreshToken: string, regionInfo: RegionInfo): Promise<any[]> {
  const uploadedMaterials = [];

  for (let i = 0; i < materials.length; i++) {
    const material = materials[i];
    try {
      if (material.type === 'image') {
        let imageUri: string;

        if (util.isBASE64Data(material.url)) {
          // 处理 base64 格式的图片
          logger.info(`检测到 base64 格式的图片数据，大小: ${material.url.length} 字符`);
          const imageBuffer = Buffer.from(util.removeBASE64DataHeader(material.url), "base64");
          imageUri = await uploadImageBuffer(imageBuffer, refreshToken, regionInfo);
        } else if (material.url) {
          // 从 URL 上传图片
          imageUri = await uploadImageFromUrl(material.url, refreshToken, regionInfo);
        } else if (material.file) {
          // 从本地文件上传图片
          imageUri = await uploadImageFromFile(material.file, refreshToken, regionInfo);
        } else {
          throw new APIException(EX.API_REQUEST_FAILED, `图片素材缺少 url 或 file 参数`);
        }

        uploadedMaterials.push({
          material_type: "image",
          image_info: {
            type: "image",
            id: util.uuid(),
            source_from: "upload",
            platform_type: 1,
            image_uri: imageUri,
            uri: imageUri,
            width: 0,
            height: 0,
            format: ""
          }
        });
      } else if (material.type === 'video') {
        let videoUri: string;

        if (util.isBASE64Data(material.url)) {
          // 处理 base64 格式的视频
          logger.info(`检测到 base64 格式的视频数据，大小: ${material.url.length} 字符`);
          const videoBuffer = Buffer.from(util.removeBASE64DataHeader(material.url), "base64");
          videoUri = await uploadVideoBuffer(videoBuffer, refreshToken, regionInfo);
        } else if (material.url) {
          // 从 URL 上传视频
          videoUri = await uploadVideoFromUrl(material.url, refreshToken, regionInfo);
        } else if (material.file) {
          // 从本地文件上传视频
          videoUri = await uploadVideoFromFile(material.file, refreshToken, regionInfo);
        } else {
          throw new APIException(EX.API_REQUEST_FAILED, `视频素材缺少 url 或 file 参数`);
        }

        uploadedMaterials.push({
          material_type: "video",
          video_info: {
            type: "video",
            id: util.uuid(),
            source_from: "upload",
            platform_type: 1,
            video_uri: videoUri,
            uri: videoUri,
            width: 0,
            height: 0,
            duration: 0,
            format: ""
          }
        });
      }
    } catch (error: any) {
      logger.error(`素材 ${i+1} 上传失败: ${error.message}`);
      throw error;
    }
  }

  return uploadedMaterials;
}

// 从 prompt 中构建 meta_list（解析 @图片N、@视频N 语法）
function buildMetaListFromPrompt(prompt: string): any {
  const metaList = [];

  // TODO: 实现完整的 @ 语法解析
  // 当前简化实现：将整个 prompt 作为文本
  // 用户的 @图片1、@视频1 等引用会直接传递给 AI
  metaList.push({
    meta_type: "text",
    text: prompt
  });

  return { meta_list: metaList };
}

/**
 * 获取原始质量的视频URL
 * @param itemId 视频项ID
 * @param refreshToken 刷新令牌
 * @returns 原始视频URL，失败返回null
 */
async function fetchOriginVideoUrl(
  itemId: string,
  refreshToken: string
): Promise<string | null> {
  const startTime = Date.now();

  try {
    logger.info(`尝试获取原始视频URL, itemId: ${itemId}`);

    const result = await request("post", "/mweb/v1/get_local_item_list", refreshToken, {
      data: {
        item_id_list: [itemId],
        is_for_video_download: true,
        pack_item_opt: {
          scene: 1,
          need_data_integrity: true
        }
      }
    });

    const elapsed = Date.now() - startTime;

    // 验证响应结构
    if (!result || typeof result !== 'object') {
      logger.warn(`get_local_item_list返回无效响应`, {
        itemId,
        responseType: typeof result,
        elapsedMs: elapsed
      });
      return null;
    }

    if (!Array.isArray(result.item_list)) {
      logger.warn(`get_local_item_list响应缺少item_list字段`, {
        itemId,
        responseKeys: Object.keys(result),
        elapsedMs: elapsed
      });
      return null;
    }

    if (result.item_list.length === 0) {
      logger.warn(`get_local_item_list返回空item_list`, {
        itemId,
        elapsedMs: elapsed
      });
      return null;
    }

    // 从响应中提取 transcoded_video.origin.video_url
    const firstItem = result.item_list[0];
    if (firstItem?.video?.transcoded_video?.origin?.video_url) {
      const originUrl = firstItem.video.transcoded_video.origin.video_url;

      // 验证URL格式
      try {
        new URL(originUrl);
      } catch (urlError) {
        logger.error(`获取的origin URL格式无效`, {
          itemId,
          url: originUrl.substring(0, 100),
          urlError: urlError.message,
          elapsedMs: elapsed
        });
        return null;
      }

      logger.info(`成功获取原始视频URL`, {
        itemId,
        urlPrefix: originUrl.substring(0, 50) + '...',
        elapsedMs: elapsed
      });
      return originUrl;
    }

    // 记录响应结构用于调试
    logger.warn(`未能从get_local_item_list响应中提取origin URL`, {
      itemId,
      hasVideo: !!firstItem?.video,
      hasTranscodedVideo: !!firstItem?.video?.transcoded_video,
      hasOrigin: !!firstItem?.video?.transcoded_video?.origin,
      originKeys: firstItem?.video?.transcoded_video?.origin
        ? Object.keys(firstItem.video.transcoded_video.origin)
        : [],
      elapsedMs: elapsed
    });
    return null;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorContext = {
      itemId,
      errorType: error.constructor.name,
      errorMessage: error.message,
      errorCode: error.code,
      responseStatus: error.response?.status,
      elapsedMs: elapsed
    };

    // 可预期的网络错误 - 使用降级策略
    if (error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.message?.includes('timeout')) {
      logger.warn(`获取原始视频URL超时，使用降级URL`, errorContext);
      return null;
    }

    if (error.response?.status === 401 || error.response?.status === 403) {
      logger.warn(`获取原始视频URL认证失败，使用降级URL`, errorContext);
      return null;
    }

    if (error.response?.status >= 500) {
      logger.warn(`获取原始视频URL服务端错误 ${error.response.status}，使用降级URL`, errorContext);
      return null;
    }

    // 不可预期的错误 - 记录详细信息但不中断流程
    logger.error(`获取原始视频URL遇到未预期错误`, {
      ...errorContext,
      errorStack: error.stack
    });

    // 由于这是可选增强功能，仍然使用降级策略
    // 但详细记录错误以便后续调试
    return null;
  }
}

/**
 * 生成视频
 *
 * @param _model 模型名称
 * @param prompt 提示词
 * @param options 选项
 * @param refreshToken 刷新令牌
 * @returns 视频URL
 */
export async function generateVideo(
  _model: string,
  prompt: string,
  {
    ratio = "1:1",
    resolution = "720p",
    duration = 5,
    files = {},
    mode = "auto",
    materials = []
  }: {
    ratio?: string;
    resolution?: string;
    duration?: number;
    files?: any;
    mode?: string;
    materials?: Array<{type: string, url?: string, file?: any}>;
  },
  refreshToken: string
) {
  // 检测区域
  const regionInfo = parseRegionFromToken(refreshToken);
  const { isInternational } = regionInfo;

  logger.info(`视频生成区域检测: isInternational=${isInternational}`);

  const model = getModel(_model, regionInfo);
  const isVeo3 = model.includes("veo3");
  const isSora2 = model.includes("sora2");
  const is35Pro = model.includes("3.5_pro");
  const isSeedance20 = model.includes("seedance_40");
  // video-3.0, video-3.0-fast 和 seedance-2.0 支持 resolution 参数（3.0-pro、3.5-pro、veo3、sora2 不支持）
  const supportsResolution = (model.includes("vgfm_3.0") || model.includes("vgfm_3.0_fast") || isSeedance20) && !model.includes("_pro");

  // 将秒转换为毫秒
  // veo3 模型固定 8 秒
  // sora2 模型支持 4秒、8秒、12秒，默认4秒
  // seedance-2.0 模型支持 4-15秒，默认5秒
  // 3.5-pro 模型支持 5秒、10秒、12秒，默认5秒
  // 其他模型支持 5秒、10秒，默认5秒
  let durationMs: number;
  let actualDuration: number;
  if (isVeo3) {
    durationMs = 8000;
    actualDuration = 8;
  } else if (isSora2) {
    if (duration === 12) {
      durationMs = 12000;
      actualDuration = 12;
    } else if (duration === 8) {
      durationMs = 8000;
      actualDuration = 8;
    } else {
      durationMs = 4000;
      actualDuration = 4;
    }
  } else if (isSeedance20) {
    // Seedance 2.0 支持 4-15秒 (fps=24, frames=96-360)
    if (duration >= 4 && duration <= 15) {
      durationMs = duration * 1000;
      actualDuration = duration;
    } else {
      durationMs = 5000;
      actualDuration = 5;
    }
  } else if (is35Pro) {
    if (duration === 12) {
      durationMs = 12000;
      actualDuration = 12;
    } else if (duration === 10) {
      durationMs = 10000;
      actualDuration = 10;
    } else {
      durationMs = 5000;
      actualDuration = 5;
    }
  } else {
    durationMs = duration === 10 ? 10000 : 5000;
    actualDuration = duration === 10 ? 10 : 5;
  }

  logger.info(`使用模型: ${_model} 映射模型: ${model} 比例: ${ratio} 分辨率: ${supportsResolution ? resolution : '不支持'} 时长: ${actualDuration}s`);

  // 检查积分
  const { totalCredit } = await getCredit(refreshToken);
  if (totalCredit <= 0) {
    logger.info("积分为 0，尝试收取今日积分...");
    try {
      await receiveCredit(refreshToken);
    } catch (receiveError) {
      logger.warn(`收取积分失败: ${receiveError.message}. 这可能是因为: 1) 今日已收取过积分, 2) 账户受到风控限制, 3) 需要在官网手动收取首次积分`);
      throw new APIException(EX.API_VIDEO_GENERATION_FAILED,
        `积分不足且无法自动收取。请访问即梦官网手动收取首次积分，或检查账户状态。`);
    }
  }

  // 确定实际使用的模式
  let actualMode = mode;
  if (actualMode === "auto") {
    const uploadedFilesCount = _.values(files).length;
    const imageMaterialsCount = materials.filter(m => m.type === 'image').length;
    const videoMaterialsCount = materials.filter(m => m.type === 'video').length;

    // 智能模式判断：
    // 1. 有视频素材 → 全能参考
    // 2. 图片素材 > 2 个 → 全能参考
    // 3. 图片素材 = 1-2 个 → 首尾帧
    // 4. 本地上传文件 = 1-2 个 → 首尾帧
    // 5. 无素材 → 文生视频
    if (videoMaterialsCount > 0 || imageMaterialsCount > 2) {
      actualMode = "omni_reference";
    } else if (imageMaterialsCount > 0 || uploadedFilesCount > 0) {
      actualMode = "first_last_frames";
    } else {
      actualMode = "text_to_video";
    }

    logger.info(`自动模式判断: materials=${materials.length}个(图片${imageMaterialsCount}+视频${videoMaterialsCount}), 本地文件=${uploadedFilesCount}个 → ${actualMode}`);
  }

  logger.info(`使用模式: ${actualMode}，原始mode参数: ${mode}`);

  // 处理全能参考模式
  let unified_edit_input = undefined;
  if (actualMode === "omni_reference") {
    logger.info(`使用全能参考模式，素材数量: ${materials.length}`);

    // 上传所有素材
    const materialList = await uploadMaterials(materials, refreshToken, regionInfo);

    // 构建 unified_edit_input 结构
    unified_edit_input = {
      type: "",
      id: util.uuid(),
      material_list: materialList,
      // 从 prompt 中提取素材引用信息（支持 @图片1、@视频1 语法）
      ...buildMetaListFromPrompt(prompt)
    };
  }

  // 处理首帧和尾帧图片（仅在首尾帧模式下使用）
  let first_frame_image = undefined;
  let end_frame_image = undefined;
  let uploadIDs: string[] = [];

  // 仅在首尾帧模式下处理图片参数
  if (actualMode === "first_last_frames") {
    // ========== 优先级1: 处理本地上传的文件 ==========
    const uploadedFiles = _.values(files); // 将files对象转为数组
    if (uploadedFiles && uploadedFiles.length > 0) {
      logger.info(`检测到 ${uploadedFiles.length} 个本地上传文件，优先处理`);
      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        if (!file) continue;
        try {
          logger.info(`开始上传第 ${i + 1} 张本地图片: ${file.originalFilename}`);
          const imageUri = await uploadImageFromFile(file, refreshToken, regionInfo);
          if (imageUri) {
            uploadIDs.push(imageUri);
            logger.info(`第 ${i + 1} 张本地图片上传成功: ${imageUri}`);
          } else {
            logger.error(`第 ${i + 1} 张本地图片上传失败: 未获取到 image_uri`);
          }
        } catch (error: any) {
          logger.error(`第 ${i + 1} 张本地图片上传失败: ${error.message}`);
          if (i === 0) {
            throw new APIException(EX.API_REQUEST_FAILED, `首帧图片上传失败: ${error.message}`);
          }
        }
      }
    }
    // ========== 优先级2: 从 materials 中提取图片素材（最多2个）==========
    else if (materials && materials.length > 0) {
      const imageMaterials = materials.filter(m => m.type === 'image').slice(0, 2);
      if (imageMaterials.length > 0) {
        logger.info(`从 materials 中提取到 ${imageMaterials.length} 个图片素材（首尾帧模式）`);

        for (let i = 0; i < imageMaterials.length; i++) {
          const material = imageMaterials[i];
          try {
            if (material.file) {
              // 处理本地文件
              logger.info(`开始上传第 ${i + 1} 张本地图片: ${material.file.originalFilename}`);
              const imageUri = await uploadImageFromFile(material.file, refreshToken, regionInfo);
              if (imageUri) {
                uploadIDs.push(imageUri);
                logger.info(`第 ${i + 1} 张本地图片上传成功: ${imageUri}`);
              }
            } else if (material.url) {
              // 处理 URL（包括 Base64 Data URL）
              logger.info(`开始上传第 ${i + 1} 个URL图片`);
              const imageUri = await uploadImageFromUrl(material.url, refreshToken, regionInfo);
              if (imageUri) {
                uploadIDs.push(imageUri);
                logger.info(`第 ${i + 1} 个URL图片上传成功: ${imageUri}`);
              }
            }
          } catch (error: any) {
            logger.error(`第 ${i + 1} 张图片上传失败: ${error.message}`);
            if (i === 0) {
              throw new APIException(EX.API_REQUEST_FAILED, `首帧图片上传失败: ${error.message}`);
            }
          }
        }
      }
    } else {
      logger.info(`未提供图片素材，将进行纯文本视频生成`);
    }
  }

  // 如果有图片上传（无论来源），构建对象
  if (uploadIDs.length > 0) {
    logger.info(`图片上传完成，共成功 ${uploadIDs.length} 张`);
    // 构建首帧图片对象
    if (uploadIDs[0]) {
      first_frame_image = {
        format: "",
        height: 0,
        id: util.uuid(),
        image_uri: uploadIDs[0],
        name: "",
        platform_type: 1,
        source_from: "upload",
        type: "image",
        uri: uploadIDs[0],
        width: 0,
      };
      logger.info(`设置首帧图片: ${uploadIDs[0]}`);
    }

    // 构建尾帧图片对象
    if (uploadIDs[1]) {
      end_frame_image = {
        format: "",
        height: 0,
        id: util.uuid(),
        image_uri: uploadIDs[1],
        name: "",
        platform_type: 1,
        source_from: "upload",
        type: "image",
        uri: uploadIDs[1],
        width: 0,
      };
      logger.info(`设置尾帧图片: ${uploadIDs[1]}`);
    }
  }


  const componentId = util.uuid();
  const originSubmitId = util.uuid();

  // 根据实际使用的模式设置 functionMode
  const functionMode = actualMode === "omni_reference"
    ? "omni_reference"
    : "first_last_frames";

  const sceneOption = {
    type: "video",
    scene: "BasicVideoGenerateButton",
    ...(supportsResolution ? { resolution: resolution } : {}),
    modelReqKey: model,
    videoDuration: actualDuration,
    reportParams: {
      enterSource: "generate",
      vipSource: "generate",
      extraVipFunctionKey: supportsResolution ? `${model}-${resolution}` : model,
      useVipFunctionDetailsReporterHoc: true,
    },
    // 全能参考模式需要 materialTypes
    ...(actualMode === "omni_reference" ? {
      materialTypes: materials.map(m => m.type === 'image' ? 1 : 2)
    } : {})
  };

  const metricsExtra = JSON.stringify({
    promptSource: "custom",
    isDefaultSeed: 1,
    originSubmitId: originSubmitId,
    isRegenerate: false,
    enterFrom: "click",
    functionMode: functionMode,
    sceneOptions: JSON.stringify([sceneOption]),
  });

  // 当有图片输入时，ratio参数会被图片的实际比例覆盖
  const hasImageInput = uploadIDs.length > 0 || materials.length > 0;
  if (hasImageInput && ratio !== "1:1") {
    logger.warn(`图生视频模式下，ratio参数将被忽略（由输入图片的实际比例决定），但resolution参数仍然有效`);
  }

  logger.info(`视频生成模式: ${actualMode} (首帧: ${!!first_frame_image}, 尾帧: ${!!end_frame_image}, 素材: ${materials.length}), resolution: ${resolution}`);

  // 构建请求参数
  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    {
      params: {
        aigc_features: "app_lip_sync",
        web_version: "7.5.0",
        da_version: DRAFT_VERSION,
      },
      data: {
        "extend": {
          "root_model": model,
          "m_video_commerce_info": {
            benefit_type: getVideoBenefitType(model, actualMode),
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc"
          },
          "m_video_commerce_info_list": [{
            benefit_type: getVideoBenefitType(model, actualMode),
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc"
          }]
        },
        "submit_id": util.uuid(),
        "metrics_extra": metricsExtra,
        "draft_content": JSON.stringify({
          "type": "draft",
          "id": util.uuid(),
          "min_version": "3.0.5",
          "min_features": actualMode === "omni_reference"
            ? ["AIGC_Video_UnifiedEdit"]
            : [],
          "is_from_tsn": true,
          "version": DRAFT_VERSION,
          "main_component_id": componentId,
          "component_list": [{
            "type": "video_base_component",
            "id": componentId,
            "min_version": "1.0.0",
            "aigc_mode": "workbench",
            "metadata": {
              "type": "",
              "id": util.uuid(),
              "created_platform": 3,
              "created_platform_version": "",
              "created_time_in_ms": Date.now().toString(),
              "created_did": ""
            },
            "generate_type": "gen_video",
            "abilities": {
              "type": "",
              "id": util.uuid(),
              "gen_video": {
                "id": util.uuid(),
                "type": "",
                "text_to_video_params": {
                  "type": "",
                  "id": util.uuid(),
                  "video_gen_inputs": [{
                    "type": "",
                    "id": util.uuid(),
                    "min_version": actualMode === "omni_reference" ? "3.3.9" : "3.0.5",
                    "prompt": prompt,
                    "video_mode": 2,
                    "fps": 24,
                    "duration_ms": durationMs,
                    ...(supportsResolution ? { "resolution": resolution } : {}),
                    // 根据模式添加不同的字段
                    ...(actualMode === "omni_reference" ? {
                      "unified_edit_input": unified_edit_input
                    } : {
                      "first_frame_image": first_frame_image,
                      "end_frame_image": end_frame_image
                    }),
                    "idip_meta_list": []
                  }],
                  "video_aspect_ratio": ratio,
                  "seed": Math.floor(Math.random() * 100000000) + 2500000000,
                  "model_req_key": model,
                  "priority": 0
                },
                "video_task_extra": metricsExtra,
              }
            },
            "process_type": 1
          }],
        }),
        http_common_info: {
          aid: getAssistantId(regionInfo)
        },
      },
    }
  );

  const historyId = aigc_data.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  logger.info(`视频生成任务已提交，history_id: ${historyId}，等待生成完成...`);

  // 首次查询前等待，让服务器有时间处理请求
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 使用 SmartPoller 进行智能轮询
  const maxPollCount = 900; // 增加轮询次数，支持更长的生成时间
  let pollAttempts = 0;

  const poller = new SmartPoller({
    maxPollCount,
    pollInterval: 2000, // 2秒基础间隔
    expectedItemCount: 1,
    type: 'video',
    timeoutSeconds: 1200 // 20分钟超时
  });

  const { result: pollingResult, data: finalHistoryData } = await poller.poll(async () => {
    pollAttempts++;

    // 使用标准API请求方式
    const result = await request("post", "/mweb/v1/get_history_by_ids", refreshToken, {
      data: {
        history_ids: [historyId],
      },
    });

    // 检查响应中是否有该 history_id 的数据
    // 由于 API 存在最终一致性，早期轮询可能暂时获取不到记录，返回处理中状态继续轮询
    if (!result[historyId]) {
      logger.warn(`API未返回历史记录 (轮询第${pollAttempts}次)，historyId: ${historyId}，继续等待...`);
      return {
        status: {
          status: 20, // PROCESSING
          itemCount: 0,
          historyId
        } as PollingStatus,
        data: { status: 20, item_list: [] }
      };
    }

    const historyData = result[historyId];

    const currentStatus = historyData.status;
    const currentFailCode = historyData.fail_code;
    const currentItemList = historyData.item_list || [];
    const finishTime = historyData.task?.finish_time || 0;

    // 记录详细信息
    if (currentItemList.length > 0) {
      const tempVideoUrl = currentItemList[0]?.video?.transcoded_video?.origin?.video_url ||
                          currentItemList[0]?.video?.play_url ||
                          currentItemList[0]?.video?.download_url ||
                          currentItemList[0]?.video?.url;
      if (tempVideoUrl) {
        logger.info(`检测到视频URL: ${tempVideoUrl}`);
      }
    }

    return {
      status: {
        status: currentStatus,
        failCode: currentFailCode,
        itemCount: currentItemList.length,
        finishTime,
        historyId
      } as PollingStatus,
      data: historyData
    };
  }, historyId);

  const item_list = finalHistoryData.item_list || [];

  // 首先尝试提取视频URL（作为降级方案）
  let videoUrl = item_list?.[0] ? extractVideoUrl(item_list[0]) : null;

  // 尝试获取原始质量的视频URL
  if (item_list?.[0]) {
    const firstItem = item_list[0];

    // 尝试从item中找到item_id
    const itemId = firstItem.id ||
                   firstItem.item_id ||
                   firstItem.video?.id ||
                   firstItem.video?.item_id ||
                   firstItem.video?.video_id ||
                   firstItem.common_attr?.id;

    // 如果item中找不到itemId，尝试使用historyId
    const finalItemId = itemId || historyId;

    if (finalItemId) {
      logger.info(`✓ 检测到itemId: ${finalItemId} ${itemId ? '(从item)' : '(使用historyId)'}, 尝试获取原始质量视频URL`);

      // 调用新API获取原始URL
      const originUrl = await fetchOriginVideoUrl(finalItemId, refreshToken);

      if (originUrl) {
        videoUrl = originUrl;
        logger.info(`✓ 成功获取原始质量视频URL`);
      } else {
        logger.warn(`✗ 无法获取原始URL,使用当前URL`);
      }
    } else {
      logger.warn(`✗ 无法确定itemId`);
    }
  }

  // 如果无法获取视频URL，抛出异常
  if (!videoUrl) {
    logger.error(`未能获取视频URL，item_list: ${JSON.stringify(item_list)}`);
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "未能获取视频URL，请稍后查看");
  }

  logger.info(`视频生成成功，URL: ${videoUrl}，总耗时: ${pollingResult.elapsedTime}秒`);
  return videoUrl;
}
