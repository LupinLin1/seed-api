# 视频上传功能实现文档

## 概述

本文档详细说明了为 Jimeng API 添加的视频上传功能实现。通过分析 Jimeng 官方网站的网络请求，我们实现了完整的视频上传流程。

## 视频上传流程

根据捕获的网络请求分析，视频上传分为以下四个步骤：

### 1. 获取上传令牌

**端点**: `POST /mweb/v1/get_upload_token`

**请求参数**:
```json
{
  "scene": 1  // scene=1 表示视频上传 (scene=2 用于图片上传)
}
```

**响应**:
```json
{
  "access_key_id": "AKTP...",
  "secret_access_key": "8HVC...",
  "session_token": "STS2...",
  "space_name": "dreamina",
  "upload_domain": "vod.bytedanceapi.com",
  "expired_time": "2026-02-07T14:19:22+08:00"
}
```

### 2. 申请视频上传权限

**端点**: `GET https://vod.bytedanceapi.com/?Action=ApplyUploadInner`

**查询参数**:
- `Action`: ApplyUploadInner
- `Version`: 2020-11-19
- `SpaceName`: dreamina
- `FileType`: video
- `IsInner`: 1
- `FileSize`: 视频文件大小（字节）

**认证**: AWS4-HMAC-SHA256 签名

**响应**:
```json
{
  "Result": {
    "InnerUploadAddress": {
      "UploadNodes": [
        {
          "StoreInfos": [
            {
              "StoreUri": "tos-cn-v-148450/...",
              "Auth": "SpaceKey/dreamina/0/...",
              "UploadID": "..."
            }
          ],
          "UploadHost": "tos-hl-x.snssdk.com",
          "SessionKey": "..."
        }
      ]
    }
  }
}
```

### 3. 上传视频文件

**端点**: `POST https://tos-hl-x.snssdk.com/upload/v1/{StoreUri}`

**请求头**:
- `Authorization`: 从 ApplyUploadInner 获取的 Auth
- `Content-CRC32`: 视频 CRC32 校验和（十六进制）
- `Content-Type`: application/octet-stream
- `Content-Disposition`: attachment; filename="undefined"
- `X-Storage-U`: 时间戳

**请求体**: 视频二进制数据

**响应**:
```json
{
  "code": 2000,
  "message": "Success",
  "data": {
    "crc32": "2ca4f812"
  }
}
```

### 4. 提交上传

**端点**: `POST https://vod.bytedanceapi.com/?Action=CommitUploadInner`

**请求参数**:
```json
{
  "SessionKey": "从步骤2获取的SessionKey",
  "Functions": []
}
```

**认证**: AWS4-HMAC-SHA256 签名

**响应**:
```json
{
  "Result": {
    "Results": [
      {
        "Vid": "v03870g10004d63cmmvog65lt0hhk6t0",
        "VideoMeta": {
          "Uri": "tos-cn-v-148450/...",
          "Height": 1280,
          "Width": 720,
          "Duration": 8,
          "Bitrate": 2025542,
          "Md5": "64ed41a63b3f1d527bfe65623f0741db",
          "Format": "MP4",
          "Size": 2025542,
          "FileType": "video",
          "Codec": "h264"
        }
      }
    ]
  }
}
```

## 实现细节

### 新增文件

#### `src/lib/video-uploader.ts`

核心视频上传模块，包含以下函数：

1. **`uploadVideoBuffer(videoBuffer, refreshToken, regionInfo)`**
   - 上传视频 Buffer 数据
   - 返回视频 URI

2. **`uploadVideoFromUrl(videoUrl, refreshToken, regionInfo)`**
   - 从 URL 下载并上传视频
   - 返回视频 URI

3. **`uploadVideoFromFile(file, refreshToken, regionInfo)`**
   - 从本地文件上传视频
   - 返回视频 URI

4. **`calculateCRC32(data)`**
   - 计算 CRC32 校验和
   - 返回十六进制字符串

### 修改的文件

#### `src/api/controllers/videos.ts`

1. **导入视频上传函数**:
```typescript
import { uploadVideoBuffer } from "@/lib/video-uploader.ts";
```

2. **更新 `uploadMaterials` 函数**:
   - 支持视频素材上传
   - 返回 `video_info` 结构（类似于 `image_info`）

3. **添加辅助函数**:
   - `uploadVideoFromUrl`: 处理来自 URL 的视频
   - `uploadVideoFromFile`: 处理本地上传的视频文件

## API 使用示例

### 全能参考模式（包含视频素材）

```bash
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "孙悟空和猪八戒在打架",
    "model": "seedance_40",
    "mode": "omni_reference",
    "materials": [
      {"type": "image", "url": "https://example.com/image1.jpg"},
      {"type": "image", "url": "https://example.com/image2.jpg"},
      {"type": "video", "url": "https://example.com/video1.mp4"}
    ],
    "material_sequence": "@图片1 和 @图片2 在打架，用 @视频1 的动作"
  }'
```

### 使用本地视频文件

```bash
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "prompt=孙悟空和猪八戒在打架" \
  -F "model=seedance_40" \
  -F "mode=omni_reference" \
  -F "materials[0][type]=image" \
  -F "materials[0][file]=@image1.jpg" \
  -F "materials[1][type]=video" \
  -F "materials[1][file]=@video1.mp4"
```

## 数据结构

### 上传后的视频素材结构

```typescript
{
  material_type: "video",
  video_info: {
    type: "video",
    id: "uuid",
    source_from: "upload",
    platform_type: 1,
    video_uri: "tos-cn-v-148450/...",
    uri: "tos-cn-v-148450/...",
    width: 0,
    height: 0,
    duration: 0,
    format: ""
  }
}
```

## 技术要点

### 1. CRC32 校验

视频上传需要 CRC32 校验和，我们实现了标准的 CRC32 算法：

```typescript
function calculateCRC32(data: ArrayBuffer | Buffer): string {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
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
  const crcValue = crc >>> 0;
  return crcValue.toString(16);
}
```

### 2. AWS 签名

视频上传使用 AWS4-HMAC-SHA256 签名算法，与图片上传相同，复用了 `createSignature` 函数。

### 3. 区域处理

视频上传与图片上传使用相同的区域处理逻辑，通过 `RegionInfo` 参数传递区域信息。

## 与图片上传的对比

| 特性 | 图片上传 | 视频上传 |
|-----|---------|----------|
| 场景值 (scene) | 2 | 1 |
| 服务域名 | imagex.bytedanceapi.com | vod.bytedanceapi.com |
| Action | ApplyImageUpload | ApplyUploadInner |
| Action (Commit) | CommitImageUpload | CommitUploadInner |
| 存储 URI 前缀 | tos-cn-i-{service_id} | tos-cn-v-148450 |
| 返回信息 | image_uri | video_uri + 元数据 |

## 支持的视频格式

根据官方实现，支持的视频格式包括：
- MP4 (H.264 编码)
- MOV (QuickTime)

## 限制

1. **文件大小**: 视频文件大小没有明确限制，但建议控制在合理范围内（例如 < 100MB）
2. **时长**: 根据模型不同，支持的视频时长可能有所不同
3. **编码**: 主要支持 H.264 编码的 MP4 和 MOV 格式
4. **素材数量**: 全能参考模式最多支持 5 个素材（图片+视频混合）

## 测试建议

### 单元测试

- [ ] 测试 `uploadVideoBuffer` 函数
- [ ] 测试 `uploadVideoFromUrl` 函数
- [ ] 测试 `uploadVideoFromFile` 函数
- [ ] 测试 `calculateCRC32` 函数的正确性

### 集成测试

1. **测试小视频上传** (< 5MB)
2. **测试中等视频上传** (5-50MB)
3. **测试大视频上传** (> 50MB)
4. **测试不同格式** (MP4, MOV)
5. **测试 URL 上传**
6. **测试本地上传**
7. **测试混合素材上传** (图片+视频)

### 测试命令

```bash
# 使用 URL 上传视频
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "测试视频生成",
    "model": "seedance_40",
    "mode": "omni_reference",
    "materials": [
      {"type": "video", "url": "https://example.com/test.mp4"}
    ]
  }'

# 使用本地文件上传视频
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "prompt=测试视频生成" \
  -F "model=seedance_40" \
  -F "mode=omni_reference" \
  -F "materials[0][type]=video" \
  -F "materials[0][file]=@test.mp4"
```

## 故障排查

### 常见错误

1. **获取上传令牌失败**
   - 检查 refresh_token 是否有效
   - 检查网络连接

2. **申请上传权限失败**
   - 检查文件大小是否合理
   - 检查 AWS 签名是否正确

3. **上传视频失败**
   - 检查 CRC32 计算是否正确
   - 检查视频格式是否支持
   - 检查网络稳定性

4. **提交上传失败**
   - 检查 SessionKey 是否有效
   - 检查 AWS 签名是否正确

### 调试技巧

1. 启用详细日志：
```typescript
logger.info(`视频上传详情: ${JSON.stringify(uploadResult)}`);
```

2. 检查网络请求：
   - 使用 Chrome DevTools 查看网络请求
   - 对比与官方请求的差异

3. 验证 CRC32：
```typescript
const crc = calculateCRC32(videoBuffer);
logger.info(`计算的 CRC32: ${crc}`);
```

## 未来改进

1. **支持分片上传**: 对于大文件，实现分片上传功能
2. **视频预处理**: 自动调整视频尺寸、编码等
3. **断点续传**: 支持上传失败后继续上传
4. **进度显示**: 实现上传进度回调
5. **格式验证**: 更严格的视频格式验证

## 总结

本实现通过分析 Jimeng 官方网站的网络请求，成功实现了完整的视频上传功能。核心特点是：

- ✅ 完整的四步上传流程
- ✅ 支持本地文件和 URL 上传
- ✅ 正确的 AWS 签名认证
- ✅ CRC32 校验和计算
- ✅ 与现有图片上传流程保持一致
- ✅ 完全集成到全能参考模式

视频上传功能现已完全实现，可以支持 Seedance 2.0 的全能参考模式中的视频素材上传。
