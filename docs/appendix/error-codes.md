# 附录 B · 错误码表

所有 API 错误响应都会带 `code` 字段，前端依此做差异化处理。

## B.1 响应格式

```json
{
  "detail": "人类可读的错误描述",
  "code": "MACHINE_READABLE_CODE",
  "field_errors": {                   // 可选，字段级
    "field_name": "该字段的错误"
  },
  "extra": { ... }                    // 可选，附加信息（如冲突时的当前版本号）
}
```

## B.2 通用错误码

| HTTP | code | 含义 | 前端处理 |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | 请求参数校验失败 | 展示 field_errors |
| 401 | `INVALID_CREDENTIALS` | 邮箱密码错 | 登录页提示 |
| 401 | `TOKEN_EXPIRED` | JWT 过期 | 引导重新登录 |
| 401 | `TOKEN_INVALID` | JWT 无效 | 引导重新登录 |
| 403 | `ACCOUNT_DISABLED` | 账号被禁用 | 提示联系管理员 |
| 403 | `INSUFFICIENT_PERMISSIONS` | 权限不足 | 提示无权限 |
| 404 | `RESOURCE_NOT_FOUND` | 资源不存在 | 404 页面 |
| 409 | `VERSION_CONFLICT` | 乐观锁冲突 | 提示刷新 |
| 429 | `QUOTA_EXCEEDED_DAILY` | 每日任务数超限 | toast 提示 |
| 429 | `QUOTA_EXCEEDED_RUNNING` | 同时进行任务超限 | 提示等待或取消 |
| 429 | `QUOTA_EXCEEDED_TOKENS` | 月度 token 超限 | 提示联系管理员 |
| 500 | `INTERNAL_ERROR` | 服务端未知异常 | toast + 重试 |
| 503 | `SERVICE_UNAVAILABLE` | 服务降级 | 提示稍后重试 |

## B.3 业务相关错误码

### B.3.1 任务

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_TASK_STATUS_FOR_OPERATION` | 当前状态不支持该操作（如 `approved` 不能 pause）|
| 400 | `EMPTY_TITLES` | 批量提交但标题列表为空 |
| 400 | `TITLE_TOO_LONG` | 单个标题超过 200 字 |
| 400 | `TASK_NOT_EDITABLE` | 任务在生成中或终态，不可编辑 |
| 400 | `TASK_NOT_EXPORTABLE` | 任务非 approved 状态，不可导出 |
| 422 | `INVALID_TASK_CONFIG` | config JSON 不符合 schema |

### B.3.2 LLM Key

| HTTP | code | 含义 |
|---|---|---|
| 400 | `NO_API_KEY` | 用户未配置 LLM Key |
| 400 | `INVALID_API_KEY` | Key 验证失败 |
| 401 | `API_KEY_EXPIRED` | Key 已过期/被撤销 |
| 429 | `API_KEY_RATE_LIMITED` | Key 限流（一般在任务执行中由 worker 处理，不直接抛给用户）|

### B.3.3 段落编辑

| HTTP | code | 含义 |
|---|---|---|
| 400 | `SEGMENT_NOT_EDITABLE` | 段落非 completed 状态，不可编辑 |
| 409 | `VERSION_CONFLICT` | 版本号不匹配，需刷新 |
| 422 | `CONTENT_TOO_LONG` | 段落内容超过 50000 字 |

### B.3.4 大纲

| HTTP | code | 含义 |
|---|---|---|
| 400 | `OUTLINE_INVALID_SCHEMA` | 编辑后的大纲不符合 schema |
| 400 | `TASK_NOT_IN_OUTLINE_REVIEW` | 任务不在 outline_review 状态 |

### B.3.5 AI 调用

| HTTP | code | 含义 |
|---|---|---|
| 502 | `LLM_UPSTREAM_ERROR` | 中转站 5xx 错误 |
| 503 | `LLM_UNAVAILABLE` | 中转站连续探活失败，服务暂不可用 |
| 408 | `LLM_TIMEOUT` | LLM 调用超时 |
| 422 | `LLM_OUTPUT_INVALID` | LLM 输出无法解析（如大纲 JSON 解析失败）|

## B.4 SSE 错误事件

SSE 流中的 `error` 事件 payload：

```json
{
  "code": "STREAM_INTERRUPTED",
  "message": "流式输出被中断",
  "recoverable": true,
  "retry_after_ms": 2000
}
```

| code | 含义 | recoverable |
|---|---|---|
| `STREAM_INTERRUPTED` | 流被服务端关闭（worker 重启等）| true |
| `LLM_FAILED_NON_RECOVERABLE` | LLM 调用失败且不可重试（如 key 失效） | false |
| `TASK_FAILED` | 任务整体失败 | false |
| `TASK_PAUSED_BY_USER` | 用户主动暂停 | true（继续后会重连）|
| `TASK_CANCELLED_BY_USER` | 用户主动取消 | false |

## B.5 前端统一错误处理

```typescript
// lib/api/errorHandler.ts
export function handleApiError(error: ApiError) {
  // 401 系列：清登录重定向
  if (error.status === 401) {
    useAuthStore.getState().clearAuth();
    window.location.href = '/login';
    return;
  }
  
  // 409 版本冲突：弹刷新提示
  if (error.code === 'VERSION_CONFLICT') {
    toast.error('内容已被更新，请刷新后重试', {
      action: { label: '刷新', onClick: () => window.location.reload() }
    });
    return;
  }
  
  // Key 相关：引导到设置
  if (['NO_API_KEY', 'INVALID_API_KEY', 'API_KEY_EXPIRED'].includes(error.code)) {
    toast.error('LLM API Key 异常，请前往设置', {
      action: { label: '设置', onClick: () => router.push('/settings/llm-key') }
    });
    return;
  }
  
  // 配额：友好提示
  if (error.code?.startsWith('QUOTA_EXCEEDED')) {
    toast.warning(error.detail);
    return;
  }
  
  // 其他：通用提示
  toast.error(error.detail || '操作失败');
}
```
