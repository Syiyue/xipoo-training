# OCR 标注核验图服务接口文档

**接收方：服务端 AI / OCR 服务维护者**  
**用途：让小程序能够在识别完成时展示标注核验图，并在“AI 识别记录”中长期查看同一张图。**

## 1. 当前问题与必须达成的目标

小程序已完成以下能力：

1. 识别完成后调用 `GET /jobs/{job_id}/annotated` 获取二进制标注图；
2. 将成功取得的图片上传到小程序云存储，并以 `job_id` 关联到课程导入批次；
3. “AI 识别记录 -> 查看”优先读取该持久化图片；
4. 历史批次若没有已保存的图片，会按原 `job_id` 再尝试一次 `/annotated` 补取。

因此，服务端的首要任务是：**一个已完成任务的标注图必须按 `job_id` 可稳定获取，不能只存在 Python 进程内存或临时目录。**

现有 Flask 实现中的 `JOBS = {}`、`_annotated_bytes` 和任务目录均是实例本地状态；容器重启、扩缩容或请求命中另一实例后，`GET /jobs/{job_id}/annotated` 会返回 404。`batch_eval_v9/.../result_annotated.png` 是开发机上的离线测试产物，不会自动成为云托管服务可访问的文件。

## 2. 调用链与职责边界

```text
小程序
  -> 云函数 schedule / action: ocrSubmit
  -> OCR 服务 POST /parse
  <- job_id

小程序
  -> 云函数 schedule / action: ocrPoll
  -> OCR 服务 GET /jobs/{job_id}
  <- status=done + expanded

小程序
  -> 云函数 schedule / action: ocrAnnotated
  -> OCR 服务 GET /jobs/{job_id}/annotated
  <- image/png 或 image/jpeg 二进制

小程序
  -> 云存储（保存标注图）
  -> 云函数 schedule / action: saveOcrImportBatchArtifact
  <- 以 job_id 关联的 verificationFileId
```

服务端只需要提供 OCR 作业和标注图的可靠接口。小程序不会调用 `/parse-sync`，不会从任务 JSON 中读取图片 URL/base64，也不会自行重新绘制框、编号或颜色。

## 3. 必须实现的持久化模型

请使用持久数据库（例如 CloudBase 数据库、Redis + 对象存储、MySQL 等）保存任务元数据，并使用对象存储保存图片二进制。禁止仅使用进程级字典或容器本地文件作为唯一数据源。

建议的任务记录字段：

```json
{
  "job_id": "uuid-or-random-id",
  "owner_user_id": "optional-user-id-from-parse",
  "status": "queued | processing | done | failed",
  "expanded": [],
  "created_at": "2026-08-02T12:00:00Z",
  "finished_at": "2026-08-02T12:00:10Z",
  "annotated_object_key": "ocr-annotated/<job_id>.png",
  "annotated_mime": "image/png",
  "annotated_size": 123456,
  "annotated_available": true
}
```

任务完成的推荐原子流程：

1. OCR 管线生成带彩色框和序号的 `result_annotated.png` 或 JPEG；
2. 压缩后最长边不超过 1600 px，文件通常不超过 2 MB；
3. 上传图片到对象存储，得到持久 `object_key`；
4. 在同一任务记录中写入 `annotated_object_key`、MIME、大小以及 `annotated_available=true`；
5. 最后才把任务状态更新为 `done`。

若第 3 或第 4 步失败，任务可以仍为 `done`，但必须写入 `annotated_available=false` 并记录可观测错误；不能假装图片存在。

> 保留策略：标注图的保留时间应至少覆盖对应 AI 导入记录的保留时间。若服务端设置过期清理，必须让 `/annotated` 返回 404，不能返回原始截图或其他任务的图片。

## 4. 接口：提交识别（保持现有契约）

### `POST /parse`

请求由 `schedule` 云函数发起，JSON 格式保持不变：

```json
{
  "image": "<纯 base64 图片内容>",
  "fileName": "timetable.png",
  "userId": "XP8148770JR"
}
```

成功响应：

```json
{
  "success": true,
  "job_id": "abc123",
  "status": "queued"
}
```

要求：

- 立即返回 `job_id`，不要同步等待 OCR 完成；
- `job_id` 必须全局唯一、不可预测；
- 任务记录须持久化，以便后续轮询和取图请求可由任意服务实例处理；
- 不要改为要求小程序调用 `/parse-sync`。

## 5. 接口：查询识别任务（保持现有契约）

### `GET /jobs/{job_id}`

未完成时可返回 `queued` 或 `processing`。完成时必须返回：

```json
{
  "success": true,
  "job_id": "abc123",
  "status": "done",
  "annotated_available": true,
  "expanded": [
    {
      "course_code": "IOT105TC",
      "date": "2026-09-07",
      "start_time": "09:00",
      "end_time": "10:20",
      "room": "TC-BC-3001"
    }
  ]
}
```

字段要求：

- `expanded` 的数组顺序就是图片上的课程编号顺序：第一个元素对应图片编号 `1`，第二个对应 `2`，以此类推；
- `annotated_available` 为布尔值；标注图已持久化时为 `true`；
- JSON 中不要放图片 URL、data URL、base64 或二进制；图片只能走第 6 节的独立接口；
- 若任务不存在，返回 HTTP 404；若任务失败，返回明确的失败状态和 `error`。

## 6. 接口：获取标注核验图（新增/必须可靠）

### `GET /jobs/{job_id}/annotated`

此接口由小程序云函数调用。必须从**持久化对象存储**读取 `annotated_object_key`，不要从 `JOBS` 内存缓存或本地临时目录读取。

#### 成功响应

```http
HTTP/1.1 200 OK
Content-Type: image/png
Cache-Control: private, max-age=300
```

响应体为原始图片二进制。允许的 MIME 类型只有：

- `image/png`
- `image/jpeg`

约束：

- 仅在 HTTP `200` 且图片内容非空时视为成功；
- 不能把二进制 JSON 序列化，也不能返回 base64；
- 不能以用户上传原图冒充标注图；
- 必须包含课程彩色标注框和与 `expanded` 顺序一致的数字序号；
- 绿色=识别正常，蓝色=教室待定，黄色=待确认，红色=需人工修复；颜色判定和绘制仅由服务端完成；
- 图片需完整保留课表右侧摘要和底部课程块，不能裁切。

#### 暂不可用或不存在

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "success": false,
  "error_code": 404,
  "error": "Annotated image not available"
}
```

404 的唯一语义是：任务不存在、图片尚未生成、图片已按保留策略清理，或对应对象丢失。不要对 404 返回 HTTP 200，也不要返回空 PNG。

#### 服务故障

- 对象存储、数据库或内部处理故障：HTTP 5xx，并输出可追踪日志；
- 超时：HTTP 504 或服务端约定的 5xx；
- 不要把内部堆栈、密钥、对象存储签名等敏感信息返回给客户端。

小程序会在图片请求失败时最多重试一次；最终 404、超时或本地落盘失败才降级显示用户原始截图，并会明确写“核验标注图暂不可用，以下为原始截图”。

## 7. 服务端实现参考（伪代码）

```python
def finish_job(job_id, pipeline_result):
    # 1. 生成的图必须是带编号和检测框的图。
    image_path = pipeline_result.annotated_image
    image_bytes, mime = encode_png_or_jpeg(image_path, max_long_edge=1600)
    if not image_bytes:
        jobs.update(job_id, status="done", annotated_available=False)
        return

    # 2. 放到共享持久存储；不要保存到 /tmp 或实例磁盘作为唯一副本。
    key = f"ocr-annotated/{job_id}.{extension_for(mime)}"
    object_store.put_bytes(key, image_bytes, content_type=mime)

    # 3. 任务完成状态与图片引用一起持久化。
    jobs.update(
        job_id,
        status="done",
        expanded=pipeline_result.expanded,
        annotated_object_key=key,
        annotated_mime=mime,
        annotated_size=len(image_bytes),
        annotated_available=True,
    )


@app.get("/jobs/<job_id>/annotated")
def get_annotated(job_id):
    job = jobs.get(job_id)  # 持久数据库查询，不是全局 dict
    if not job or not job.get("annotated_available"):
        return {"success": False, "error": "Annotated image not available"}, 404

    content = object_store.get_bytes(job["annotated_object_key"])
    if not content:
        return {"success": False, "error": "Annotated image not available"}, 404

    return Response(content, mimetype=job.get("annotated_mime", "image/png"))
```

## 8. 小程序云函数返回契约（请勿破坏）

OCR 服务的二进制响应由 `cloudfunctions/schedule` 的 `ocrAnnotated` 动作转换。该云函数会向小程序返回：

```js
// OCR 服务成功返回图片时
{
  success: true,
  mime: "image/png", // 或 image/jpeg
  base64: "iVBORw0KGgo..." // 纯 base64，不含 data: 前缀
}

// OCR 服务返回 404、网络异常或超时时
{
  success: false,
  statusCode: 404,
  error: "Annotated image not available"
}
```

请勿将 OCR 服务改成返回旧结构 `{"ok": true, "data": {"annotated": ...}}`；也不要在图片成功响应中混入 JSON 包装。

## 9. 发布前验收清单

服务端 AI 完成后，请在**已部署的云托管地址**上验收，不要仅在开发机 `batch_eval` 目录验证。

- [ ] `POST /parse` 返回可轮询的唯一 `job_id`；
- [ ] 任意实例可通过 `GET /jobs/{job_id}` 查询该任务；
- [ ] 完成响应具有正确的 `expanded` 顺序和 `annotated_available=true`；
- [ ] `GET /jobs/{job_id}/annotated` 返回 HTTP 200、非空 `image/png` 或 `image/jpeg`；
- [ ] 图片可看见彩色框与 `1, 2, 3...` 序号，且与 `expanded` 一一对应；
- [ ] 服务重启后、等待一段时间后、或多实例请求时，仍能取回同一张图片；
- [ ] 人为删除对象存储图片后，接口返回 JSON 404 而不是原始截图；
- [ ] PNG 与 JPEG 都已测试；
- [ ] 日志能按 `job_id` 查到提交、完成、图片上传、图片读取和失败原因；
- [ ] 不使用 `/parse-sync`。

## 10. 与小程序一起部署的清单

服务端完成后，小程序侧还需：

1. 部署更新后的 `cloudfunctions/schedule` 云函数；
2. 确认云环境允许创建/访问 `ocr_import_batches` 集合；
3. 完成一次新的真机识别，确认结果弹窗显示标注图；
4. 关闭并重新进入“AI 识别记录 -> 查看”，确认同一图仍存在；
5. 测试删除该导入批次后，课程、批次元数据和云存储图均被清理。

旧历史记录此前没有保存核验图引用，无法仅靠小程序恢复开发机上的 `result_annotated.png`。只有服务端仍保有相同 `job_id` 的持久化图时，小程序才能在打开历史记录时自动补存。
