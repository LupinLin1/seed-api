# Seedance 2.0 全能参考功能实现总结

## 实现概述

本次更新为 Jimeng API 添加了 Seedance 2.0 模型的"全能参考"功能支持。该功能允许用户上传 1-5 张参考图片或视频，并在提示词中引用这些素材，实现更复杂的视频生成场景。

## 修改的文件

### 1. `src/api/routes/videos.ts`

**修改内容**：

- 添加了 `mode`、`materials`、`material_sequence` 参数验证
- 将新参数传递给控制器

**关键代码**：

```typescript
.validate('body.mode', v => _.isUndefined(v) || ['auto', 'first_last_frames', 'omni_reference'].includes(v))
.validate('body.materials', v => _.isUndefined(v) || (_.isArray(v) && v.length <= 5))
.validate('body.material_sequence', v => _.isUndefined(v) || _.isString(v))
```

### 2. `src/api/controllers/videos.ts`

**主要修改**：

1. **更新 `getVideoBenefitType` 函数**：
   - 添加 `mode` 参数
   - 全能参考模式使用不同的 `benefit_type`

2. **新增 `uploadMaterials` 函数**：
   - 处理全能参考素材列表的上传
   - 支持图片和视频素材上传
   - 支持三种输入格式：URL、Base64、本地文件

3. **新增 `buildMetaList` 函数**：
   - 解析 `material_sequence` 参数
   - 构建元数据列表（简化实现）

4. **更新 `generateVideo` 函数签名**：
   - 添加新参数类型定义
   - 添加 `mode`、`materials`、`material_sequence` 参数

5. **添加模式判断逻辑**：
   ```typescript
   let actualMode = mode;
   if (actualMode === "auto") {
     if (materials.length > 0) {
       actualMode = "omni_reference";
     } else if (filePaths.length >= 2 || (_.values(files).length >= 2)) {
       actualMode = "first_last_frames";
     } else {
       actualMode = "text_to_video";
     }
   }
   ```

6. **更新 `draft_content` 构建**：
   - 全能参考模式使用 `unified_edit_input`
   - 首尾帧模式使用 `first_frame_image` 和 `end_frame_image`
   - 动态设置 `min_version` 和 `min_features`

7. **更新 `sceneOption` 和 `metricsExtra`**：
   - 全能参考模式添加 `materialTypes`
   - 使用正确的 `functionMode`

## 技术实现细节

### 模式自动选择逻辑

```
mode="auto"
  ├─ materials.length > 0 → omni_reference
  ├─ filePaths.length >= 2 → first_last_frames
  └─ 否则 → text_to_video
```

### 素材上传流程

```
materials[]
  └─ 循环处理每个素材
      ├─ type === 'image'
      │   ├─ 有 url → uploadImageFromUrl()
      │   └─ 有 file → uploadImageFromFile()
      └─ type === 'video'
          └─ 抛出异常（待实现）
```

### draft_content 结构

#### 全能参考模式：

```json
{
  "video_gen_inputs": [{
    "min_version": "3.3.9",
    "unified_edit_input": {
      "type": "",
      "id": "uuid",
      "material_list": [
        {
          "material_type": "image",
          "image_info": {
            "type": "image",
            "id": "uuid",
            "source_from": "upload",
            "platform_type": 1,
            "image_uri": "...",
            "uri": "...",
            "width": 0,
            "height": 0,
            "format": ""
          }
        }
      ],
      "meta_list": [...] // 如果提供了 material_sequence
    }
  }]
}
```

#### 首尾帧模式：

```json
{
  "video_gen_inputs": [{
    "min_version": "3.0.5",
    "first_frame_image": {...},
    "end_frame_image": {...}
  }]
}
```

## 向后兼容性

- ✅ 所有新参数都是可选的
- ✅ 不提供新参数时，行为与现有实现完全一致
- ✅ `mode="auto"` 会根据输入自动选择最合适的模式
- ✅ 现有首尾帧功能完全保留

## 已知限制

1. **视频素材上传**: 当前仅支持图片素材，视频素材上传功能待实现
2. **material_sequence 解析**: 当前为简化实现，完整的 @ 语法解析器待开发
3. **素材数量限制**: 最多 5 个素材（Jimeng 官方限制）

## 测试建议

### 单元测试

- [ ] 测试 `mode="auto"` 的自动选择逻辑
- [ ] 测试素材上传处理
- [ ] 测试不同模式的 `draft_content` 结构生成
- [ ] 测试参数验证

### 集成测试

- [ ] 首尾帧模式（现有功能回归测试）
- [ ] 全能参考模式（新功能）
- [ ] 自动模式测试
- [ ] 纯文本模式测试

### 测试脚本

已提供测试脚本：`test_seedance_omni_reference.sh`

使用前需修改 `TOKEN` 变量为实际值：

```bash
TOKEN="your_token_here"  # 修改这里
./test_seedance_omni_reference.sh
```

## 未来扩展

1. **支持视频素材上传**: 实现 `uploadVideoFromFile` 和 `uploadVideoFromUrl` 函数
2. **完善 material_sequence 解析**: 实现完整的 @ 语法解析器
3. **支持更多模式**: 主体参考模式、智能多帧模式等
4. **素材预处理**: 自动调整图片尺寸、格式转换等

## API 文档

详细的 API 使用文档请参考：`docs/seedance-omni-reference-api.md`

## 示例用法

### 全能参考模式

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
      {"type": "image", "url": "https://example.com/image2.jpg"}
    ],
    "material_sequence": "@图片1 和 @图片2 在打架"
  }'
```

### 自动模式

```bash
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "测试",
    "model": "seedance_40",
    "materials": [
      {"type": "image", "url": "https://example.com/image1.jpg"}
    ]
  }'
```

## 总结

本次实现在保持现有功能完整性的前提下，为 Jimeng API 添加了 Seedance 2.0 的全能参考功能支持。通过扩展现有 API 而非创建新端点，确保了良好的向后兼容性和易用性。

主要特点：
- ✅ 完全向后兼容
- ✅ 支持自动模式选择
- ✅ 支持最多 5 个素材
- ✅ 支持图片和视频（视频待实现）
- ✅ 灵活的素材引用机制
