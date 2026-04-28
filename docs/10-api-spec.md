# 10 API 规范

完整的 REST + SSE API 端点定义，用于前后端联调。

## 10.1 通用约定

### 10.1.1 BasePath

```
/api/v1
```

### 10.1.2 鉴权

除 `/auth/login`、`/health` 外，所有端点强制 JWT 鉴权：

```
Authorization: Bearer <jwt-token>
```

JWT payload：

```json
{
  "sub": "5",                    // user_id
  "name": "张三",
  "role": "user",
  "exp": 1714280000,
  "iat": 1714193600
}
```

过期：默认 24h，可通过 `/auth/refresh` 刷新。

### 10.1.3 响应格式

成功：

```json
HTTP 200
{
  "data": { ... }
}
```

或直接返回业务对象（适合简单接口）：

```json
HTTP 200
{ ...task fields... }
```

错误：

```json
HTTP 4xx/5xx
{
  "detail": "错误描述",
  "code": "VALIDATION_FAILED",   // 可选，机器可读错误码（见附录）
  "field_errors": { ... }         // 可选，字段级错误
}
```

### 10.1.4 分页

列表接口统一约定：

```
GET /api/v1/tasks?page=1&page_size=20&sort=-created_at&status=review

Response:
{
  "items": [...],
  "total": 123,
  "page": 1,
  "page_size": 20,
  "has_next": true
}
```

### 10.1.5 时间格式

统一 ISO 8601 UTC：`2026-04-28T17:30:00Z`

## 10.2 认证

### POST /auth/login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "zhangsan@studio.com",
  "password": "xxxxxx"
}

→ 200
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": { "id": 5, "name": "张三", "email": "...", "role": "user" }
}

→ 401 { "detail": "邮箱或密码错误", "code": "INVALID_CREDENTIALS" }
→ 403 { "detail": "账号已禁用", "code": "ACCOUNT_DISABLED" }
```

### POST /auth/refresh

```http
POST /api/v1/auth/refresh
Authorization: Bearer <refresh_token>

→ 200 { "access_token": "..." }
```

### POST /auth/logout

```http
POST /api/v1/auth/logout
Authorization: Bearer <access_token>

→ 204 No Content
```

(MVP 阶段简单实现：客户端丢弃 token 即可，服务端不维护黑名单)

## 10.3 用户与设置

### GET /users/me

```http
GET /api/v1/users/me

→ 200
{
  "id": 5,
  "name": "张三",
  "email": "...",
  "role": "user",
  "avatar_url": "...",
  "llm_api_key_status": "valid",
  "llm_api_key_hint": "sk-...xK9p",
  "llm_api_key_validated_at": "2026-04-28T09:00:00Z",
  "llm_key_concurrency_limit": 5,
  "daily_task_limit": 20,
  "monthly_token_limit": null,
  "preferences": {}
}
```

### PUT /users/me

```http
PUT /api/v1/users/me
{
  "name": "张三新",
  "preferences": { "theme": "dark" }
}

→ 200 { ...user fields... }
```

### POST /users/me/llm-key/validate

验证某个 key 是否可用（不保存）。

```http
POST /api/v1/users/me/llm-key/validate
{ "api_key": "sk-..." }

→ 200 { "valid": true, "response_sample": "pong" }
→ 200 { "valid": false, "reason": "key 无效或已过期" }
```

### PUT /users/me/llm-key

设置或更新 key（自动先验证）。

```http
PUT /api/v1/users/me/llm-key
{ "api_key": "sk-...", "concurrency_limit": 5 }

→ 200 { "hint": "sk-...xK9p", "status": "valid" }
→ 400 { "detail": "key 验证失败：xxx" }
```

### DELETE /users/me/llm-key

```http
DELETE /api/v1/users/me/llm-key
→ 204
```

### POST /users/me/password

```http
POST /api/v1/users/me/password
{ "old_password": "...", "new_password": "..." }
→ 204
```

## 10.4 任务

### GET /tasks

```http
GET /api/v1/tasks?page=1&page_size=20&status=review&sort=-created_at&search=星际

→ 200
{
  "items": [
    {
      "id": 123,
      "title": "星际迷途",
      "status": "writing",
      "progress": 45,
      "current_chapter": 3,
      "word_count": 5400,
      "target_word_count": 12000,
      "warning_msg": null,
      "error_msg": null,
      "created_at": "...",
      "updated_at": "...",
      "completed_at": null,
      "config_summary": { "genre": "玄幻", "target_words": 12000 }
    },
    ...
  ],
  "total": 35,
  "page": 1,
  "page_size": 20,
  "has_next": true
}
```

### POST /tasks/batch

批量创建任务。

```http
POST /api/v1/tasks/batch
{
  "titles": ["星际迷途", "江湖夜雨", "都市奇缘"],
  "config": {
    "target_words": 12000,
    "genre": "玄幻",
    "style": "古风武侠，文笔典雅",
    "writing_model": "claude-3-5-sonnet-20241022"
  },
  "need_outline_review": false
}

→ 201
{
  "task_ids": [123, 124, 125],
  "queued_count": 3,
  "rejected_count": 0,
  "rejected_reasons": []
}

→ 429 { "detail": "今日提交任务已达上限 (20)" }
→ 400 { "detail": "未配置 LLM API Key", "code": "NO_API_KEY" }
```

### GET /tasks/{id}

任务详情（含 segments）。

```http
GET /api/v1/tasks/123

→ 200
{
  "task": {
    "id": 123,
    "title": "星际迷途",
    "status": "review",
    "config": { ... },
    "outline": { ... },
    "content": "## 第一章 ...",
    "word_count": 12340,
    "progress": 100,
    "warning_msg": null,
    ...
  },
  "segments": [
    {
      "id": 456,
      "index": 1,
      "title": "雨夜惊变",
      "status": "completed",
      "content": "...",
      "word_count": 2400,
      "summary": "...",
      "version": 3,
      "model_used": "claude-3-5-sonnet-20241022",
      "tokens_used": 4500,
      ...
    },
    ...
  ],
  "last_event_id": "1714193600000-0"   // 用于订阅 SSE 时的起始位置
}
```

### GET /tasks/{id}/full

同 `GET /tasks/{id}`，但额外包含 messages（不分页，仅最近 100 条）。

```http
GET /api/v1/tasks/123/full

→ 200 { "task": ..., "segments": [...], "messages": [...], "last_event_id": "..." }
```

### POST /tasks/{id}/pause

```http
POST /api/v1/tasks/123/pause
→ 200 { "status": "pausing", "message": "暂停指令已发送，将在数秒内生效" }
→ 400 { "detail": "当前状态不可暂停" }
```

### POST /tasks/{id}/resume

```http
POST /api/v1/tasks/123/resume
→ 200 { "status": "resumed" }
→ 400 { "detail": "任务未处于暂停状态" }
```

### POST /tasks/{id}/cancel

```http
POST /api/v1/tasks/123/cancel
{ "reason": "标题打错了" }

→ 200 { "status": "cancelling" } 或 { "status": "cancelled" }
```

### POST /tasks/{id}/retry

失败任务手动重试。

```http
POST /api/v1/tasks/123/retry
→ 200 { "status": "queued" }
→ 400 { "detail": "任务非失败状态" }
```

### DELETE /tasks/{id}

仅 draft 状态可删除（其他状态用 cancel）。

```http
DELETE /api/v1/tasks/123
→ 204
→ 400 { "detail": "仅草稿状态可删除" }
```

## 10.5 大纲审核

### PATCH /tasks/{id}/outline

```http
PATCH /api/v1/tasks/123/outline
{
  "outline": { ... },          // 完整新大纲
  "version": 1                 // 乐观锁
}

→ 200 { "version": 2 }
→ 409 { "detail": "大纲已被更新", "current_version": 2 }
```

### POST /tasks/{id}/outline/approve

通过大纲，进入正文生成。

```http
POST /api/v1/tasks/123/outline/approve
→ 200 { "status": "writing" }
→ 400 { "detail": "任务非 outline_review 状态" }
```

### POST /tasks/{id}/outline/regenerate

让 AI 重新生成大纲（保留任务，清空旧大纲）。

```http
POST /api/v1/tasks/123/outline/regenerate
{ "additional_instruction": "请把节奏放慢些" }

→ 200 { "status": "outlining" }
```

## 10.6 段落编辑

### PATCH /tasks/{task_id}/segments/{seg_id}

手动编辑段落。

```http
PATCH /api/v1/tasks/123/segments/456
{
  "content": "修改后的章节内容...",
  "version": 3
}

→ 200 { "version": 4, "word_count": 2350, "task_word_count": 12290 }
→ 409 { "detail": "内容已被更新", "current_version": 5 }
```

### GET /tasks/{task_id}/segments/{seg_id}/versions

历史版本列表。

```http
GET /api/v1/tasks/123/segments/456/versions

→ 200
{
  "items": [
    {
      "version": 5,
      "edit_type": "manual",
      "edited_by": { "id": 5, "name": "张三" },
      "created_at": "...",
      "word_count": 2350,
      "is_current": true
    },
    ...
  ]
}
```

### GET /tasks/{task_id}/segments/{seg_id}/versions/{version}

获取指定版本的内容。

```http
GET /api/v1/tasks/123/segments/456/versions/3

→ 200 { "content": "...", "word_count": 2400, ... }
```

### POST /tasks/{task_id}/segments/{seg_id}/rollback

回滚到指定版本（实际是创建新版本，内容来自旧版本）。

```http
POST /api/v1/tasks/123/segments/456/rollback
{ "to_version": 3 }

→ 200 { "version": 6, "content": "...", "word_count": 2400 }
```

## 10.7 AI 辅助

所有 AI 辅助接口都返回 SSE 流。

### POST /tasks/{id}/ai-edit

选中段落让 AI 修改（建议-确认两步）。

```http
POST /api/v1/tasks/123/ai-edit
{
  "segment_id": 456,
  "selection_start": 1234,
  "selection_end": 1456,
  "selected_text": "他走进了房间。",
  "instruction": "改得更生动些，加点动作描写",
  "context_range": "paragraph",
  "model": "claude-3-5-sonnet-20241022"
}

→ 200 (SSE stream)
event: token
data: {"content":"他"}

event: token
data: {"content":"蹑"}

...

event: done
data: {
  "suggestion": "他蹑手蹑脚地推开了房门...",
  "tokens_used": 234,
  "message_id": 789
}
```

如用户接受，前端再调 `PATCH /tasks/{id}/segments/{seg_id}` 落库。

### POST /tasks/{id}/chat

审核期跟 AI 对话。

```http
POST /api/v1/tasks/123/chat
{
  "message": "第三章节奏太快，能放慢些吗？",
  "include_full_text": false   // 是否塞全文给 AI（默认仅章节摘要）
}

→ 200 (SSE stream)
event: token
data: {"content":"我觉得"}

...

event: action_proposal
data: {
  "type": "rewrite_segment",
  "segment_id": 458,
  "preview_content": "...新的第三章...",
  "diff_summary": "扩充了主角心理描写"
}

event: done
data: { "message_id": 790 }
```

### POST /tasks/{id}/consistency-check

全文一致性扫描。

```http
POST /api/v1/tasks/123/consistency-check

→ 200 (SSE stream)
event: token
data: {"content":"扫描中..."}

...

event: done
data: {
  "issues": [
    {
      "severity": "high",
      "category": "character",
      "location": "第1章 vs 第5章",
      "location_segment_ids": [456, 460],
      "description": "主角年龄不一致",
      "suggestion": "统一为同一年龄设定"
    }
  ]
}
```

### GET /tasks/{id}/messages

聊天历史。

```http
GET /api/v1/tasks/123/messages?kind=review_chat&page=1&page_size=50

→ 200
{
  "items": [
    {
      "id": 789,
      "role": "user",
      "content": "...",
      "kind": "review_chat",
      "created_at": "...",
      "metadata": { ... }
    },
    ...
  ],
  ...
}
```

## 10.8 审核与导出

### POST /tasks/{id}/approve

```http
POST /api/v1/tasks/123/approve
→ 200 { "status": "approved" }
→ 400 { "detail": "仅 review 状态可审核" }
```

### POST /tasks/{id}/reject

```http
POST /api/v1/tasks/123/reject
{ "reason": "情节太单薄，重新生成" }

→ 200 { "status": "queued", "message": "任务已重新进入队列" }
```

### GET /tasks/{id}/export.docx

下载 Word 文件。

```http
GET /api/v1/tasks/123/export.docx
Authorization: Bearer ...

→ 200
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="星际迷途.docx"
[binary]

→ 400 { "detail": "仅已审核通过的任务可导出" }
```

## 10.9 SSE 流式端点

### GET /tasks/{id}/stream

订阅单任务的实时事件流。详见 [05-streaming.md](./05-streaming.md)。

```http
GET /api/v1/tasks/123/stream
Authorization: Bearer ...
Last-Event-ID: 1714193600000-0    (可选，从指定位置继续)

→ 200
Content-Type: text/event-stream
X-Accel-Buffering: no

事件类型:
  - outline_token
  - outline_complete
  - token
  - segment_status
  - task_status
  - progress
  - error
  - done
```

### GET /tasks/stream

订阅当前用户所有任务的状态变化（任务列表页用）。

```http
GET /api/v1/tasks/stream
Authorization: Bearer ...

→ 200 (SSE)
event: task_update
data: {
  "task_id": 123,
  "status": "writing",
  "progress": 67,
  "current_chapter": 4,
  "word_count": 8200
}

event: task_completed
data: {
  "task_id": 123,
  "final_status": "review"
}
```

## 10.10 管理后台 (admin)

所有 `/admin/*` 接口要求 `role=admin`。

### GET /admin/users

```http
GET /api/v1/admin/users?page=1&page_size=20&search=张

→ 200
{
  "items": [
    {
      "id": 5,
      "email": "...",
      "name": "...",
      "role": "user",
      "status": "active",
      "task_count": 45,
      "tokens_used_month": 1234567,
      "llm_api_key_status": "valid",
      "created_at": "..."
    }
  ],
  ...
}
```

### POST /admin/users

```http
POST /api/v1/admin/users
{
  "email": "newuser@studio.com",
  "name": "新用户",
  "password": "init-pwd-please-change",
  "role": "user",
  "daily_task_limit": 20
}

→ 201 { ...user... }
```

### PUT /admin/users/{id}

```http
PUT /api/v1/admin/users/5
{
  "status": "disabled",
  "daily_task_limit": 30,
  "max_running_tasks": 80
}

→ 200 { ...user... }
```

### POST /admin/users/{id}/reset-password

```http
POST /api/v1/admin/users/5/reset-password
{ "new_password": "..." }

→ 204
```

### GET /admin/queue/status

```http
GET /api/v1/admin/queue/status

→ 200
{
  "queued": 12,
  "running": 8,
  "paused": 2,
  "review": 45,
  "approved_today": 87,
  "failed_today": 3,
  "active_users": [5, 6, 12, 18],
  "worker_replicas": 2,
  "worker_concurrency_per_replica": 15,
  "total_concurrency": 30,
  "current_active_tasks": 8,
  "estimated_completion_time_min": 35
}
```

### GET /admin/usage

```http
GET /api/v1/admin/usage?month=2026-04

→ 200
{
  "total_tasks": 1234,
  "total_tokens_in": 12345678,
  "total_tokens_out": 23456789,
  "by_user": [
    {
      "user_id": 5,
      "user_name": "张三",
      "tasks": 45,
      "tokens_in": 1234567,
      "tokens_out": 2345678
    },
    ...
  ],
  "by_model": [
    { "model": "claude-3-5-sonnet-20241022", "calls": 5678, "tokens": 12345678 },
    ...
  ]
}
```

### GET /admin/tasks

管理员能看所有用户的任务（参数同 `/tasks` 但不限于自己）。

```http
GET /api/v1/admin/tasks?user_id=5&status=failed&page=1
```

### POST /admin/tasks/{id}/force-cancel

```http
POST /api/v1/admin/tasks/123/force-cancel
→ 200 { "status": "cancelled" }
```

## 10.11 健康检查

### GET /health

```http
GET /api/v1/health

→ 200 { "status": "ok", "db": "ok", "redis": "ok", "llm": "ok" }
→ 503 { "status": "degraded", "db": "ok", "redis": "ok", "llm": "down:..." }
```

### GET /metrics

Prometheus 兼容指标（v2 加，MVP 简单版）：

```
# HELP tasks_total Total tasks created
# TYPE tasks_total counter
tasks_total{status="approved"} 1234
tasks_total{status="failed"} 23

# HELP llm_tokens_total Total LLM tokens consumed
# TYPE llm_tokens_total counter
llm_tokens_total{model="claude-3-5-sonnet",direction="in"} 12345678
...
```

## 10.12 OpenAPI 文档

FastAPI 自动生成：

- Swagger UI: `/api/docs`
- ReDoc: `/api/redoc`
- OpenAPI JSON: `/api/openapi.json`

前端可用此 JSON 自动生成 TypeScript 类型（如用 `openapi-typescript`）。
