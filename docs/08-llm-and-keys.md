# 08 LLM 接入与 Key 管理

## 8.1 中转站接入

### 8.1.1 协议与 SDK

中转站走 **OpenAI 兼容协议**，直接用官方 `openai` Python SDK：

```bash
pip install openai==1.*
```

```python
from openai import AsyncOpenAI

client = AsyncOpenAI(
    base_url="https://your-aggregator.com/v1",  # 中转站地址（系统级配置）
    api_key="sk-user-personal-key",              # 用户个人 key（每次调用传入）
    timeout=300,                                 # 5 分钟单次超时
    max_retries=0,                               # 重试逻辑由我们自己控制
)

# 流式调用
stream = await client.chat.completions.create(
    model="claude-3-5-sonnet-20241022",
    messages=[{"role": "user", "content": "..."}],
    stream=True,
    max_tokens=8000,
    temperature=0.85,
)

async for chunk in stream:
    if chunk.choices[0].delta.content:
        token = chunk.choices[0].delta.content
        # ... 处理 token ...
    
    if chunk.choices[0].finish_reason:
        # length / stop / content_filter / null
        finish_reason = chunk.choices[0].finish_reason
```

### 8.1.2 系统级配置

`base_url` 是系统级配置（所有用户共用同一中转站），存在环境变量：

```bash
# .env
LLM_BASE_URL=https://your-aggregator.com/v1
LLM_DEFAULT_MODEL_PRIMARY=claude-3-5-sonnet-20241022
LLM_DEFAULT_MODEL_FALLBACK=claude-3-5-haiku-20241022
LLM_TIMEOUT_SECONDS=300
```

**API key 不存系统级**，每个用户在个人设置中配置自己的。

### 8.1.3 LLM Client 封装

封装一层薄包装，提供统一的 stream/complete 接口、模型降级、重试：

```python
# app/services/llm_client.py

from openai import AsyncOpenAI, RateLimitError, APITimeoutError, APIError
from typing import AsyncIterator
import structlog

logger = structlog.get_logger()


class LLMResponseChunk:
    content: str | None
    finish_reason: str | None
    model: str
    usage: dict | None


class LLMClient:
    def __init__(self, base_url: str, default_timeout: int = 300):
        self.base_url = base_url
        self.default_timeout = default_timeout
    
    def _client(self, api_key: str) -> AsyncOpenAI:
        return AsyncOpenAI(
            base_url=self.base_url,
            api_key=api_key,
            timeout=self.default_timeout,
            max_retries=0,
        )
    
    async def stream(
        self,
        *,
        api_key: str,
        messages: list[dict],
        model: str,
        max_tokens: int = 4000,
        temperature: float = 0.7,
        response_format: dict | None = None,
        fallback_models: list[str] | None = None,
    ) -> AsyncIterator[LLMResponseChunk]:
        """带降级的流式调用"""
        models_to_try = [model] + (fallback_models or [])
        last_error = None
        
        for m in models_to_try:
            try:
                async for chunk in self._stream_once(
                    api_key=api_key,
                    messages=messages,
                    model=m,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    response_format=response_format,
                ):
                    yield chunk
                return  # 成功完成，退出降级链
            except (RateLimitError, APITimeoutError, APIError) as e:
                last_error = e
                logger.warning("llm.fallback", model=m, error=str(e))
                continue  # 切到下一个模型
        
        raise last_error or RuntimeError("所有模型均失败")
    
    async def _stream_once(self, *, api_key, messages, model, **kwargs):
        client = self._client(api_key)
        kwargs_clean = {k: v for k, v in kwargs.items() if v is not None}
        
        stream = await client.chat.completions.create(
            messages=messages,
            model=model,
            stream=True,
            stream_options={"include_usage": True},
            **kwargs_clean,
        )
        
        async for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            yield LLMResponseChunk(
                content=choice.delta.content if choice and choice.delta else None,
                finish_reason=choice.finish_reason if choice else None,
                model=chunk.model,
                usage=chunk.usage.model_dump() if chunk.usage else None,
            )
    
    async def complete(self, **kwargs) -> str:
        """非流式调用（用于摘要等小任务）"""
        full = ""
        async for chunk in self.stream(**kwargs):
            if chunk.content:
                full += chunk.content
        return full
```

## 8.2 Key 管理

### 8.2.1 用户 Key 存储

每个用户在个人设置中配置自己的 key。**敏感数据，加密存储**。

```sql
-- users 表（节选）
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',           -- user | admin
    
    -- LLM 配置（加密）
    llm_api_key_encrypted BYTEA,                  -- AES-GCM 加密后的密文
    llm_api_key_hint TEXT,                        -- 提示，如 "sk-...xK9p"（最后4位）
    llm_api_key_status TEXT DEFAULT 'unknown',    -- unknown | valid | invalid | expired
    llm_api_key_validated_at TIMESTAMPTZ,
    llm_key_concurrency_limit INT DEFAULT 5,      -- 该用户 key 的并发上限
    
    -- 配额
    daily_task_limit INT DEFAULT 20,
    monthly_token_limit BIGINT,
    
    status TEXT DEFAULT 'active',                 -- active | disabled
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 8.2.2 加密实现

使用 AES-GCM，主密钥放环境变量：

```python
# app/services/crypto.py
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MASTER_KEY = bytes.fromhex(os.environ['CRYPTO_MASTER_KEY'])  # 32 字节 hex

def encrypt(plaintext: str) -> bytes:
    aesgcm = AESGCM(MASTER_KEY)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return nonce + ct  # 存储 nonce(12B) + ciphertext

def decrypt(blob: bytes) -> str:
    aesgcm = AESGCM(MASTER_KEY)
    nonce, ct = blob[:12], blob[12:]
    return aesgcm.decrypt(nonce, ct, None).decode()


# 用法
def set_user_api_key(user: User, plain_key: str):
    user.llm_api_key_encrypted = encrypt(plain_key)
    user.llm_api_key_hint = f"sk-...{plain_key[-4:]}"
    user.llm_api_key_status = 'unknown'

def get_user_api_key(user: User) -> str:
    if not user.llm_api_key_encrypted:
        raise ValueError("用户未配置 LLM API Key")
    return decrypt(user.llm_api_key_encrypted)
```

**主密钥管理：**

- 部署时生成 32 字节随机数，hex 编码后写入 `.env`
- **不要提交到 git**，`.env` 加到 `.gitignore`
- 密钥丢失会导致所有用户 key 无法解密，需重新配置
- 生产可考虑用 HashiCorp Vault 或云 KMS（v2 优化点）

### 8.2.3 Key 配置 UI

`/settings/llm` 页面：

```
┌──────────────────────────────────────────────────────┐
│ LLM API Key 配置                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  当前 Key: sk-...xK9p ✅ 已验证                       │
│  配置时间: 2026-04-25 10:30                           │
│  最近验证: 2026-04-28 09:00                           │
│                                                      │
│  并发上限: [5] (中转站给你的 key 允许同时几个请求)   │
│                                                      │
│  ──────────────────────                              │
│  更新 Key:                                            │
│  ┌──────────────────────────────────────────────┐    │
│  │ 输入新的 API Key (sk-xxxxxx...)               │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  [验证 Key]    [保存]                                 │
│                                                      │
│  ──────────────────────                              │
│  Key 怎么获取？                                       │
│  联系工作室管理员申请，每人一个独立 key。              │
└──────────────────────────────────────────────────────┘
```

### 8.2.4 Key 验证

保存前先验证可用性：调一次便宜的 LLM 请求确认能成功。

```python
@router.post("/api/users/me/llm-key/validate")
async def validate_key(payload: KeyValidatePayload, user, llm_client):
    try:
        # 调一次极小的请求
        result = await llm_client.complete(
            api_key=payload.api_key,
            messages=[{"role": "user", "content": "ping"}],
            model='claude-3-5-haiku-20241022',
            max_tokens=10,
            temperature=0,
        )
        return {"valid": True, "response_sample": result[:50]}
    except AuthenticationError:
        return {"valid": False, "reason": "key 无效或已过期"}
    except RateLimitError:
        return {"valid": False, "reason": "key 已限流，但可能仍有效"}
    except Exception as e:
        return {"valid": False, "reason": f"验证失败: {e}"}


@router.put("/api/users/me/llm-key")
async def set_key(payload, user, db, llm_client):
    # 自动先验证
    validation = await validate_key(payload, user, llm_client)
    if not validation['valid']:
        raise HTTPException(400, validation['reason'])
    
    set_user_api_key(user, payload.api_key)
    user.llm_api_key_status = 'valid'
    user.llm_api_key_validated_at = datetime.utcnow()
    await db.commit()
    return {"hint": user.llm_api_key_hint}
```

### 8.2.5 Key 失效检测

在任务执行中如果遇到 `AuthenticationError`，立即标记用户 key 失效：

```python
async def _stream_once(self, *, api_key, ...):
    try:
        ...
    except AuthenticationError as e:
        # 标记 key 失效
        await self.db.update_user_key_status(user_id, 'invalid')
        # 任务转 failed 并提示
        raise FatalError("您的 LLM API Key 已失效，请前往设置更新")
```

前端在任务列表 / 设置页都展示 key 状态：

```
[⚠ 你的 LLM Key 似乎已失效，请检查] [前往设置]
```

### 8.2.6 用户配额

```python
async def check_user_quota(user: User, db):
    # 每日任务数限制
    today_count = await db.count(
        Task,
        user_id=user.id,
        created_at__gte=today_start(),
    )
    if today_count >= user.daily_task_limit:
        raise HTTPException(429, f"今日提交任务已达上限 ({user.daily_task_limit})")
    
    # 同时进行任务数限制（防止单人占用所有 worker 槽）
    running_count = await db.count(
        Task,
        user_id=user.id,
        status__in=['queued', 'outlining', 'writing', 'paused', 'outline_review']
    )
    MAX_RUNNING_PER_USER = 50
    if running_count >= MAX_RUNNING_PER_USER:
        raise HTTPException(429, f"您当前进行中的任务已达上限 ({MAX_RUNNING_PER_USER})，请等待或取消其他任务")
    
    # 月度 token 限制（可选）
    if user.monthly_token_limit:
        monthly_tokens = await db.sum(
            'tokens_used',
            from_table='task_events',
            user_id=user.id,
            created_at__gte=month_start(),
        )
        if monthly_tokens >= user.monthly_token_limit:
            raise HTTPException(429, "本月 token 用量已达上限")
```

## 8.3 模型降级链

### 8.3.1 配置

每个生成阶段有独立的主备模型配置：

```yaml
# config.yaml
llm:
  base_url: ${LLM_BASE_URL}
  
  models:
    outline:
      primary: claude-3-5-sonnet-20241022
      fallback: claude-3-5-haiku-20241022
    
    writing:
      primary: claude-3-5-sonnet-20241022
      fallback: claude-3-5-haiku-20241022
    
    summary:
      primary: claude-3-5-haiku-20241022
      fallback: claude-3-5-haiku-20241022   # 摘要简单，用同一个
    
    edit:
      primary: claude-3-5-sonnet-20241022
      fallback: claude-3-5-haiku-20241022
    
    consistency_check:
      primary: claude-3-5-sonnet-20241022   # 长文本检查需要强模型
      fallback: claude-3-5-sonnet-20241022
```

### 8.3.2 用户级覆盖

任务的 `config` 可指定模型，覆盖系统默认：

```python
# task.config = {"writing_model": "claude-3-opus-20240229", ...}

writing_model = task.config.get('writing_model', system_config.models.writing.primary)
fallback = task.config.get('writing_fallback', system_config.models.writing.fallback)

async for chunk in llm.stream(
    api_key=user.api_key,
    model=writing_model,
    fallback_models=[fallback],
    ...
):
    ...
```

### 8.3.3 降级触发与记录

降级触发的所有事件都写入 `task_events` 让用户可见：

```python
await db.insert_event(
    task_id=task.id,
    event_type='model_fallback',
    actor='worker',
    payload={
        'phase': 'writing',
        'segment_id': seg.id,
        'from_model': 'claude-3-5-sonnet-20241022',
        'to_model': 'claude-3-5-haiku-20241022',
        'reason': str(error),
    }
)
```

任务详情页可显示：

```
⚠ 第 3 章曾使用降级模型 (claude-3-5-haiku) 
原因: 主模型限流 429
质量可能略低，建议审核时关注
```

## 8.4 Token 计量与成本追踪

### 8.4.1 记录每次调用

```python
# 流式调用结束时
await db.insert_event(
    task_id=task.id,
    event_type='llm_call',
    payload={
        'phase': phase,            # outline | writing | summary | edit | consistency
        'segment_id': seg_id,
        'model': model_used,
        'tokens_in': usage.prompt_tokens,
        'tokens_out': usage.completion_tokens,
        'tokens_total': usage.total_tokens,
        'elapsed_ms': elapsed_ms,
        'finish_reason': finish_reason,
    }
)
```

### 8.4.2 任务级汇总

`tasks` 表加冗余字段：

```sql
ALTER TABLE tasks ADD COLUMN total_tokens_in BIGINT DEFAULT 0;
ALTER TABLE tasks ADD COLUMN total_tokens_out BIGINT DEFAULT 0;
ALTER TABLE tasks ADD COLUMN total_llm_calls INT DEFAULT 0;
```

每次 LLM 调用结束更新（用 UPDATE...SET total_tokens_in = total_tokens_in + xxx）。

### 8.4.3 用户/管理员视图

任务详情页显示 token 用量：

```
本任务消耗:
  输入: 12,450 tokens
  输出: 18,234 tokens
  总计: 30,684 tokens
  调用次数: 8 次
  耗时: 11 分 23 秒
```

管理员后台 `/admin/usage` 看全局：

```
本月 Token 用量统计
┌──────────┬──────────────┬──────────────┬──────────┐
│ 用户     │ 输入 tokens  │ 输出 tokens  │ 任务数   │
├──────────┼──────────────┼──────────────┼──────────┤
│ 张三     │ 1,234,567    │ 2,345,678    │ 45       │
│ 李四     │ 800,000      │ 1,500,000    │ 30       │
└──────────┴──────────────┴──────────────┴──────────┘
```

具体接入方式见 [10-api-spec.md](./10-api-spec.md) 的 admin 接口章节。

## 8.5 中转站故障应对

### 8.5.1 降级范围有限

我们只用一个中转站，不做"切到其他中转站"的双备份。当中转站完全不可用时：

| 故障类型 | 持续时间 | 处理 |
|---|---|---|
| 短暂限流（< 1 分钟）| 几秒-几十秒 | 自动重试 + 模型降级 |
| 中等故障（5-30 分钟）| 几十分钟 | 任务保持 queued，定期探活，自动恢复 |
| 长时间故障（> 1 小时）| 数小时 | 凌晨告警，管理员介入决定是否取消任务 |
| 完全不可用 | 长期 | 需人工切换中转站配置（修改 .env）|

### 8.5.2 探活机制

```python
@celery_app.task
async def llm_health_check():
    """每 5 分钟探活一次"""
    try:
        result = await llm_client.complete(
            api_key=os.environ['SYSTEM_HEALTH_CHECK_KEY'],   # 系统级监控 key
            model='claude-3-5-haiku-20241022',
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
            timeout=30,
        )
        await redis.set("llm:health", "ok", ex=600)
    except Exception as e:
        await redis.set("llm:health", f"down:{e}", ex=600)
        # 连续 3 次失败发告警
        ...
```

提交任务前可检查 `llm:health`，如果 down 给前端友好提示但**仍允许提交**（任务进队列等服务恢复，不丢数据）。
