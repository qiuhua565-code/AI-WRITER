# 附录 C · 配置项清单

## C.1 环境变量（部署级）

`.env` 文件（参考 [12-deployment.md](../12-deployment.md)）。

### C.1.1 数据库

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://...` | PG 连接串 |
| `POSTGRES_PASSWORD` | 必填 | PG 密码（compose 内部使用）|
| `DB_POOL_SIZE` | 20 | SQLAlchemy 连接池大小 |
| `DB_MAX_OVERFLOW` | 10 | 连接池溢出 |
| `DB_POOL_TIMEOUT` | 30 | 获取连接超时（秒）|

### C.1.2 Redis

| 变量 | 默认 | 说明 |
|---|---|---|
| `REDIS_URL` | `redis://...` | Redis 连接串 |
| `REDIS_PASSWORD` | 必填 | Redis 密码 |
| `CELERY_BROKER_URL` | `redis://...:/1` | Celery broker（用 db 1）|
| `CELERY_RESULT_BACKEND` | `redis://...:/2` | Celery 结果（用 db 2）|

### C.1.3 LLM

| 变量 | 默认 | 说明 |
|---|---|---|
| `LLM_BASE_URL` | 必填 | 中转站 base URL |
| `LLM_DEFAULT_MODEL_PRIMARY` | `claude-3-5-sonnet-20241022` | 主模型 |
| `LLM_DEFAULT_MODEL_FALLBACK` | `claude-3-5-haiku-20241022` | 降级模型 |
| `LLM_DEFAULT_OUTLINE_MODEL` | `claude-3-5-sonnet-20241022` | 大纲生成模型 |
| `LLM_DEFAULT_SUMMARY_MODEL` | `claude-3-5-haiku-20241022` | 摘要模型 |
| `LLM_TIMEOUT_SECONDS` | 300 | 单次调用超时 |
| `SYSTEM_HEALTH_CHECK_KEY` | 选填 | 探活用 key（可与某管理员复用）|

### C.1.4 安全

| 变量 | 默认 | 说明 |
|---|---|---|
| `CRYPTO_MASTER_KEY` | 必填 | 32 字节 hex（64 字符），用于加密用户 LLM key |
| `JWT_SECRET` | 必填 | JWT 签名密钥（>= 32 字符）|
| `JWT_EXPIRE_HOURS` | 24 | access token 有效期 |
| `JWT_REFRESH_EXPIRE_DAYS` | 30 | refresh token 有效期 |
| `BCRYPT_ROUNDS` | 12 | 密码哈希成本 |

### C.1.5 调度

| 变量 | 默认 | 说明 |
|---|---|---|
| `WORKER_REPLICAS` | 2 | docker-compose worker 副本数 |
| `WORKER_CONCURRENCY` | 15 | 每 worker 并发协程数 |
| `USER_CONCURRENCY_DEFAULT` | 5 | 单用户默认并发 |
| `FAIR_QUEUE_POLL_INTERVAL` | 0.5 | 公平队列轮询间隔（秒）|

### C.1.6 任务超时

| 变量 | 默认 | 说明 |
|---|---|---|
| `TASK_TOTAL_TIMEOUT` | 1800 | 单任务总超时（秒）|
| `LLM_CALL_TIMEOUT` | 300 | 单次 LLM 调用超时 |
| `SEGMENT_INACTIVITY_TIMEOUT` | 180 | 段落多久无进度判定卡死 |
| `MAX_TASK_RETRIES` | 3 | 任务级最大重试 |
| `MAX_SEGMENT_RETRIES` | 5 | 段落级最大重试 |
| `MAX_CONTINUATIONS_PER_CHAPTER` | 5 | 单章最多续写次数 |

### C.1.7 配额（默认值）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEFAULT_DAILY_TASK_LIMIT` | 20 | 新用户默认每日上限 |
| `DEFAULT_MAX_RUNNING_TASKS` | 50 | 默认同时进行任务上限 |
| `DEFAULT_USER_KEY_CONCURRENCY` | 5 | 用户 key 默认并发 |

### C.1.8 告警

| 变量 | 默认 | 说明 |
|---|---|---|
| `ALERT_WEBHOOK_URL` | 选填 | 钉钉/企微/Slack webhook URL |
| `ALERT_WEBHOOK_TYPE` | `dingtalk` | webhook 类型：dingtalk / wechat / slack / generic |
| `ALERT_LEVEL_THRESHOLD` | `yellow` | 最低告警级别（red/orange/yellow/blue）|

### C.1.9 日志

| 变量 | 默认 | 说明 |
|---|---|---|
| `LOG_LEVEL` | `INFO` | DEBUG / INFO / WARNING / ERROR |
| `LOG_FORMAT` | `json` | json / text |

### C.1.10 杂项

| 变量 | 默认 | 说明 |
|---|---|---|
| `TZ` | `Asia/Shanghai` | 时区 |
| `ENVIRONMENT` | `production` | development / staging / production |

## C.2 任务级配置（task.config JSONB）

每个任务可独立配置，覆盖系统默认。

### C.2.1 完整 schema

```typescript
interface TaskConfig {
  // 基础
  target_words: number;            // 5000 - 30000
  genre: string;                   // 题材
  style?: string;                  // 风格描述
  
  // 模型
  outline_model?: string;
  outline_fallback_model?: string;
  writing_model?: string;
  writing_fallback_model?: string;
  summary_model?: string;
  edit_model?: string;
  
  // 生成参数
  temperature?: number;            // 0.0 - 1.5，默认 0.85
  outline_max_tokens?: number;     // 默认 4000
  writing_max_tokens?: number;     // 默认 8000
  
  // 工作流
  need_outline_review?: boolean;   // 默认 false
  auto_consistency_check?: boolean;// 完成后自动跑一致性检查
  
  // 续写控制
  max_continuations_per_chapter?: number;  // 默认 5
  
  // Prompt 微调
  outline?: {
    chapter_count_min?: number;    // 默认 5
    chapter_count_max?: number;    // 默认 10
  };
  writing?: {
    previous_summary_limit?: number;  // 默认全部，可设为限定塞前N章
    tail_chars_for_continuation?: number;  // 默认 800
  };
  
  // 实验性
  experimental?: {
    enable_chapter_review_mid?: boolean;   // 每章生成完即可暂停审核（v2）
  };
}
```

### C.2.2 默认值

```python
# app/core/config.py
DEFAULT_TASK_CONFIG = {
    "target_words": 12000,
    "genre": "通用",
    "temperature": 0.85,
    "writing_max_tokens": 8000,
    "outline_max_tokens": 4000,
    "max_continuations_per_chapter": 5,
    "need_outline_review": False,
    "auto_consistency_check": False,
    "outline": {
        "chapter_count_min": 5,
        "chapter_count_max": 10,
    },
    "writing": {
        "previous_summary_limit": 10,  # 即全部塞
        "tail_chars_for_continuation": 800,
    },
}
```

## C.3 用户级配置（users.preferences JSONB）

用户偏好设置，影响 UI 默认值。

```typescript
interface UserPreferences {
  // UI
  theme?: 'light' | 'dark' | 'auto';
  language?: 'zh-CN' | 'en-US';
  
  // 默认任务参数
  default_genre?: string;
  default_target_words?: number;
  default_style?: string;
  default_writing_model?: string;
  
  // 编辑器
  editor_font_size?: number;
  editor_font_family?: 'serif' | 'sans-serif' | 'mono';
  
  // 通知
  email_notifications?: {
    task_completed?: boolean;
    task_failed?: boolean;
    daily_summary?: boolean;
  };
}
```

## C.4 系统级配置（admin 可改）

部分配置可在运行时改（存于一张 `system_settings` 表，由 admin 修改）：

| 配置项 | 含义 |
|---|---|
| `system.global_disable_submit` | 全局禁止提交新任务（维护期用）|
| `system.maintenance_mode` | 维护模式（前端展示横幅）|
| `system.announcement` | 全局公告 |
| `system.default_models` | 默认模型链（覆盖环境变量）|

```sql
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by BIGINT REFERENCES users(id)
);
```

API：

```http
GET  /api/v1/admin/settings
PUT  /api/v1/admin/settings/{key}
```

## C.5 推荐的初始配置

适合 40 人工作室，开箱即用：

```bash
# 关键参数
WORKER_REPLICAS=2
WORKER_CONCURRENCY=15
USER_CONCURRENCY_DEFAULT=5
DEFAULT_DAILY_TASK_LIMIT=20
DEFAULT_MAX_RUNNING_TASKS=50

# 超时
TASK_TOTAL_TIMEOUT=1800
LLM_CALL_TIMEOUT=300

# 模型
LLM_DEFAULT_MODEL_PRIMARY=claude-3-5-sonnet-20241022
LLM_DEFAULT_MODEL_FALLBACK=claude-3-5-haiku-20241022
```

## C.6 配置变更影响

| 配置 | 修改后 | 是否需要重启 |
|---|---|---|
| 环境变量 | 修改 .env | ✅ 重启相应容器 |
| `task.config` | 提交任务时指定 | 仅影响该任务 |
| `user.preferences` | API 调 PUT /users/me | 立即生效 |
| `system_settings` | API 调 admin 接口 | 立即生效，热加载 |
| Prompt 模板 | 修改 .j2 文件 | ✅ 重启 worker |
| Celery 任务调度 | 修改 `celery_app.beat_schedule` | ✅ 重启 beat |
