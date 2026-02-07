# 🎬 Seedance 2.0 全能参考功能 - 用户使用指南

## 📖 快速开始

Seedance 2.0 全能参考功能现已完全集成到 Jimeng API 中！这个功能允许您：

1. **上传多个参考素材**（1-5 张图片或视频）
2. **智能组合生成视频**（如："图片1 作为首帧，图片2 作为尾帧，模仿视频1 的动作"）
3. **使用三种输入方式**（URL/Base64/本地文件）
4. **自动或手动选择生成模式**

## 🚀 基础使用

### 方式 1: 使用图片 URL

```bash
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "孙悟空和猪八戒在打架",
    "model": "seedance_40",
    "mode": "omni_reference",
    "file_paths": [
      {"type": "image", "url": "https://example.com/image1.jpg"},
      {"type": "image", "url": "https://example.com/image2.jpg"}
    ]
  }'
```

### 方式 2: 使用 Base64

```javascript
// JavaScript 示例
const fs = require('fs');
const imageData = fs.readFileSync('image.jpg', 'base64');
const dataUrl = `data:image/jpeg;base64,${imageData}`;

fetch('http://localhost:5100/v1/videos/generations', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: '孙悟空和猪八戒在打架',
    model: 'seedance_40',
    mode: 'omni_reference',
    file_paths: [
      { type: 'image', url: dataUrl }
    ]
  })
})
```

### 方式 3: 使用本地文件

```bash
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "prompt=孙悟空和猪八戒在打架" \
  -F "model=seedance_40" \
  -F "mode=omni_reference" \
  -F "file_paths[0][type]=image" \
  -F "file_paths[0][file]=@image1.jpg" \
  -F "file_paths[1][type]=image" \
  -F "file_paths[1][file]=@image2.jpg"
```

## 🎯 高级功能

### 1. 混合使用图片和视频

```bash
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "@图片1 和 @图片2 在打架，用 @视频1 的动作",
    "model": "seedance_40",
    "mode": "omni_reference",
    "file_paths": [
      {"type": "image", "url": "https://example.com/character1.jpg"},
      {"type": "image", "url": "https://example.com/character2.jpg"},
      {"type": "video", "url": "https://example.com/action.mp4"}
    ],
  }'
```

### 2. 使用自动模式

让系统自动选择最佳模式：

```bash
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "测试",
    "model": "seedance_40",
    "mode": "auto",
    "file_paths": [
      {"type": "image", "url": "https://example.com/image.jpg"}
    ]
  }'
```

**自动模式规则**：
- 有视频素材或超过2个图片 → 使用全能参考模式
- 有 2 个 `file_paths` → 使用首尾帧模式
- 否则 → 使用纯文本模式

### 3. 指定素材使用顺序


```bash
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "@图片1 作为背景，@图片2 中的角色，执行 @视频1 的动作",
    "model": "seedance_40",
    "mode": "omni_reference",
    "file_paths": [
      {"type": "image", "url": "https://example.com/bg.jpg"},
      {"type": "image", "url": "https://example.com/character.jpg"},
      {"type": "video", "url": "https://example.com/motion.mp4"}
    ],
  }'
```

## 📊 API 参数说明

### 新增参数

#### `mode` (可选)

生成模式，可选值：
- `"auto"` - 自动选择（推荐）
- `"omni_reference"` - 全能参考模式（新功能）
- `"first_last_frames"` - 首尾帧模式（现有功能）

#### `materials` (可选)

素材列表，最多 5 个：

```typescript
file_paths: [
  {
    type: "image" | "video",
    url: "https://..." | "data:image/jpeg;base64,..."  // 二选一
  }
]
```

**输入方式**：
1. **URL** - `https://example.com/image.jpg`
2. **Base64** - `data:image/jpeg;base64,/9j/4AAQ...`
3. **本地文件** - 仅在 multipart/form-data 时使用


## 💡 使用建议

### 1. 选择合适的模式

| 场景 | 推荐模式 | 说明 |
|-----|---------|------|
| 纯文字描述 | `auto` 或省略 | 自动使用纯文本模式 |
| 两张图片（首尾帧） | `first_last_frames` | 明确使用首尾帧 |
| 多个素材（1-5个） | `omni_reference` | 使用全能参考 |
| 不确定 | `auto` | 让系统自动选择 |

### 2. 素材选择建议

**图片素材**：
- 推荐使用 JPG、PNG 格式
- 建议尺寸：800x600 或更高
- 文件大小：< 10MB

**视频素材**：
- 推荐使用 MP4 (H.264) 格式
- 建议时长：5-15 秒
- 文件大小：< 50MB

### 3. 输入方式选择

| 方式 | 优点 | 缺点 | 适用场景 |
|-----|------|------|---------|
| **URL** | 简单，数据量小 | 需要可访问的 URL | 在线资源 |
| **Base64** | 自包含，无外部依赖 | 数据增大约 33% | 小文件 |
| **文件** | 直接上传 | 需要 multipart | 本地文件 |

## 🔧 常见问题

### Q1: 如何上传视频素材？

**A**: 支持三种方式：
1. URL：`{"type": "video", "url": "https://example.com/video.mp4"}`
2. Base64：`{"type": "video", "url": "data:video/mp4;base64,..."}`
3. 文件：`-F "file_paths[0][type]=video" -F "file_paths[0][file]=@video.mp4"`

### Q2: 最多可以上传多少个素材？

**A**: 最多 5 个素材，可以混合图片和视频。

### Q3: Base64 数据太大怎么办？

**A**:
- 对于图片：建议使用 URL 或文件上传
- 对于视频：强烈建议使用 URL 或文件上传
- Base64 编码会使数据增大约 33%

### Q4: 如何指定素材的使用方式？

**A**: 在 `prompt` 中使用 `@图片N`、`@视频N` 语法：
```json
{
  "prompt": "@图片1 作为背景，@图片2 中的角色，执行 @视频1 的动作",
  "file_paths": [
    {"type": "image", "url": "bg.jpg"},
    {"type": "image", "url": "character.jpg"},
    {"type": "video", "url": "action.mp4"}
  ]
}
```

### Q5: 自动模式和手动模式有什么区别？

**A**:
- **auto** (推荐)：系统根据输入自动选择最佳模式
- **手动**：明确指定使用 `omni_reference` 或 `first_last_frames`

### Q6: 兼容旧版本吗？

**A**: 完全兼容！所有新参数都是可选的：
- 不提供新参数 → 行为与之前完全一致
- 提供 `mode="auto"` → 智能选择模式

## 🎓 示例代码

### Python 示例

```python
import requests
import base64

API_URL = "http://localhost:5100/v1/videos/generations"
TOKEN = "your_refresh_token"

# 方式 1: 使用 URL
def generate_with_urls():
    response = requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json"
        },
        json={
            "prompt": "孙悟空和猪八戒在打架",
            "model": "seedance_40",
            "mode": "omni_reference",
            "file_paths": [
                {"type": "image", "url": "https://example.com/img1.jpg"},
                {"type": "image", "url": "https://example.com/img2.jpg"}
            ]
        }
    )
    return response.json()

# 方式 2: 使用 Base64
def generate_with_base64():
    with open("image.jpg", "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    data_url = f"data:image/jpeg;base64,{image_data}"

    response = requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json"
        },
        json={
            "prompt": "测试 Base64",
            "model": "seedance_40",
            "mode": "omni_reference",
            "file_paths": [
                {"type": "image", "url": data_url}
            ]
        }
    )
    return response.json()

# 方式 3: 使用本地文件
def generate_with_files():
    files = {
        "file_paths[0][file]": open("image1.jpg", "rb"),
        "file_paths[1][file]": open("image2.jpg", "rb"),
    }

    data = {
        "prompt": "孙悟空和猪八戒在打架",
        "model": "seedance_40",
        "mode": "omni_reference",
        "file_paths[0][type]": "image",
        "file_paths[1][type]": "image",
    }

    response = requests.post(
        API_URL,
        headers={"Authorization": f"Bearer {TOKEN}"},
        data=data,
        files=files
    )
    return response.json()
```

### Node.js 示例

```javascript
const axios = require('axios');
const fs = require('fs');

const API_URL = 'http://localhost:5100/v1/videos/generations';
const TOKEN = 'your_refresh_token';

// 使用 URL
async function generateWithUrls() {
  const response = await axios.post(API_URL, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    data: {
      prompt: '孙悟空和猪八戒在打架',
      model: 'seedance_40',
      mode: 'omni_reference',
      file_paths: [
        { type: 'image', url: 'https://example.com/img1.jpg' },
        { type: 'image', url: 'https://example.com/img2.jpg' }
      ]
    }
  });
  return response.data;
}

// 使用 Base64
async function generateWithBase64() {
  const imageBuffer = fs.readFileSync('image.jpg');
  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const response = await axios.post(API_URL, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    data: {
      prompt: '测试 Base64',
      model: 'seedance_40',
      mode: 'omni_reference',
      file_paths: [
        { type: 'image', url: dataUrl }
      ]
    }
  });
  return response.data;
}
```

## 📝 总结

Seedance 2.0 全能参考功能现已完全可用，支持：

✅ **多种素材** - 图片和视频混合使用
✅ **多种输入** - URL、Base64、本地文件
✅ **智能模式** - 自动选择最佳生成模式
✅ **完全兼容** - 不影响现有功能

开始使用吧！🚀
