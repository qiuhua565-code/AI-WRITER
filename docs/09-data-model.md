# 09 数据模型（PostgreSQL Schema）

完整的 PostgreSQL 表结构定义，可直接用于 Alembic 迁移或手动建表。

## 9.1 总览

| 表 | 行数估算 | 用途 |
|---|---|---|
| `users` | 50 行 | 用户与权限 |
| `tasks` | 10 万行/年 | 任务主表 |
| `segments` | 60 万行/年 | 章节 |
| `segment_versions` | 200 万行/年 | 编辑历史（自动清理）|
| `messages` | 50 万行/年 | LLM 对话历史 + AI 编辑记录 |
| `task_events` | 200 万行/年 | 审计日志 |

## 9.2 完整 DDL

### 9.2.1 users

```sql
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    password_hash TEXT NOT NULL,                    -- bcrypt
    role TEXT NOT NULL DEFAULT 'user',              -- user | admin
    status TEXT NOT NULL DEFAULT 'active',          -- active | disabled
    
    -- LLM 配置
    llm_api_key_encrypted BYTEA,                    -- AES-GCM 密文（含 nonce 前12字节）
    llm_api_key_hint TEXT,                          -- "sk-...xK9p"
    llm_api_key_status TEXT DEFAULT 'unknown',      -- unknown | valid | invalid | expired
    llm_api_key_validated_at TIMESTAMPTZ,
    llm_key_concurrency_limit INT NOT NULL DEFAULT 5,
    
    -- 配额
    daily_task_limit INT NOT NULL DEFAULT 20,
    monthly_token_limit BIGINT,
    max_running_tasks INT NOT NULL DEFAULT 50,
    
    -- 偏好
    preferences JSONB NOT NULL DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_role ON users(role);
```

### 9.2.2 tasks

```sql
CREATE TABLE tasks (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 业务字段
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
        -- draft | queued | outlining | outline_review | writing 
        -- | paused | review | approved | rejected | cancelled | failed
    
    -- 配置（详见 04 文档）
    config JSONB NOT NULL DEFAULT '{}',
        -- {target_words, genre, style, temperature, models, ...}
    need_outline_review BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- 大纲
    outline JSONB,                                  -- Outline schema (见 04)
    outline_buffer TEXT,                            -- 流式生成时的临时累积
    
    -- 最终内容
    content TEXT,                                   -- 拼接好的完整 markdown
    word_count INT,
    
    -- 进度展示（实时维护）
    progress INT NOT NULL DEFAULT 0,                -- 0-100
    current_chapter INT,                            -- 正在处理的章节序号
    
    -- 错误与重试
    retry_count INT NOT NULL DEFAULT 0,
    error_msg TEXT,
    warning_msg TEXT,
    
    -- LLM 用量统计
    total_tokens_in BIGINT NOT NULL DEFAULT 0,
    total_tokens_out BIGINT NOT NULL DEFAULT 0,
    total_llm_calls INT NOT NULL DEFAULT 0,
    
    -- 时间
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,                         -- worker 第一次拉到时
    completed_at TIMESTAMPTZ                        -- 任务终态时间
);

CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_user_created ON tasks(user_id, created_at DESC);
CREATE INDEX idx_tasks_status_created ON tasks(status, created_at);
CREATE INDEX idx_tasks_completed_at ON tasks(completed_at) WHERE completed_at IS NOT NULL;

-- updated_at 自动维护
CREATE OR REPLACE FUNCTION trigger_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
```

### 9.2.3 segments

```sql
CREATE TABLE segments (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    -- 章节信息
    index INT NOT NULL,                             -- 第几章 (1-based)
    title TEXT NOT NULL,
    target_word_count INT NOT NULL,
    
    -- 状态
    status TEXT NOT NULL DEFAULT 'pending',
        -- pending | generating | needs_continuation 
        -- | completed | failed | partial_failed | cancelled
    
    -- 内容
    content TEXT,                                   -- 累积的章节正文（流式追加）
    word_count INT NOT NULL DEFAULT 0,
    summary TEXT,                                   -- 章节摘要（200字内）
    version INT NOT NULL DEFAULT 1,                 -- 乐观锁版本号
    
    -- LLM 元信息
    finish_reason TEXT,
    tokens_used INT,
    model_used TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    
    -- 时间
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT segments_task_index_unique UNIQUE (task_id, index)
);

CREATE INDEX idx_segments_task ON segments(task_id, index);
CREATE INDEX idx_segments_status ON segments(status) WHERE status NOT IN ('completed', 'cancelled');

CREATE TRIGGER segments_set_updated_at BEFORE UPDATE ON segments
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
```

### 9.2.4 segment_versions

```sql
CREATE TABLE segment_versions (
    id BIGSERIAL PRIMARY KEY,
    segment_id BIGINT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    version INT NOT NULL,
    
    content TEXT NOT NULL,
    word_count INT NOT NULL DEFAULT 0,
    
    edit_type TEXT NOT NULL,
        -- ai_initial | ai_continuation | manual | ai_partial | ai_full | rollback
    edited_by BIGINT REFERENCES users(id),          -- NULL 表示系统/AI
    edit_metadata JSONB,                            -- {instruction, selection_range, ...}
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT segment_versions_unique UNIQUE (segment_id, version)
);

CREATE INDEX idx_segment_versions_segment ON segment_versions(segment_id, version DESC);

-- 自动清理：每段保留最新 20 个版本（用 trigger 或定时任务）
-- 简单做法：定时任务每天跑
-- DELETE FROM segment_versions sv
-- WHERE sv.id NOT IN (
--   SELECT id FROM segment_versions 
--   WHERE segment_id = sv.segment_id 
--   ORDER BY version DESC LIMIT 20
-- );
```

### 9.2.5 messages

记录 LLM 对话历史（包括 worker 内部的生成对话和审核期用户与 AI 的对话）。

```sql
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    segment_id BIGINT REFERENCES segments(id) ON DELETE SET NULL,
    
    role TEXT NOT NULL,                             -- system | user | assistant
    content TEXT NOT NULL,
    
    -- 元信息
    kind TEXT NOT NULL DEFAULT 'orchestration',
        -- orchestration | review_chat | ai_edit | consistency_check
    model TEXT,
    tokens_in INT,
    tokens_out INT,
    elapsed_ms INT,
    
    -- 上下文关联
    parent_message_id BIGINT REFERENCES messages(id),
    metadata JSONB,                                 -- {finish_reason, prompt_template, ...}
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_task_created ON messages(task_id, created_at);
CREATE INDEX idx_messages_kind ON messages(kind);
CREATE INDEX idx_messages_segment ON messages(segment_id) WHERE segment_id IS NOT NULL;
```

### 9.2.6 task_events

审计日志，记录任务生命周期所有关键事件。

```sql
CREATE TABLE task_events (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    event_type TEXT NOT NULL,
        -- status_changed | llm_call | llm_failed | model_fallback
        -- | paused | resumed | cancelled
        -- | segment_edited | segment_rolled_back
        -- | rejected | approved | exported
        -- | watchdog_requeued | timeout
    
    actor TEXT NOT NULL,                            -- system | worker | user:<id>
    payload JSONB NOT NULL DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_events_task_created ON task_events(task_id, created_at);
CREATE INDEX idx_task_events_type ON task_events(event_type);
CREATE INDEX idx_task_events_payload_gin ON task_events USING gin(payload);
```

## 9.3 关键 JSONB Schema

### 9.3.1 tasks.config

```typescript
{
  target_words: number,                  // 目标字数，如 12000
  genre: string,                         // 题材，如 "玄幻"
  style?: string,                        // 风格描述，如 "古风武侠，文笔典雅"
  
  temperature?: number,                  // 默认 0.85
  
  outline_model?: string,                // 默认系统配置
  writing_model?: string,
  summary_model?: string,
  outline_fallback_model?: string,
  writing_fallback_model?: string,
  
  max_continuations_per_chapter?: number,// 默认 5
  
  need_outline_review: boolean,          // 是否需要审大纲（已提到 tasks.need_outline_review 列）
  auto_consistency_check: boolean        // 完成后自动跑一致性检查
}
```

### 9.3.2 tasks.outline

```typescript
{
  title: string,
  genre: string,
  target_word_count: number,
  main_characters: [
    { name: string, role: string, description: string }
  ],
  world_setting: string,
  theme: string,
  chapters: [
    {
      index: number,
      title: string,
      summary: string,                   // 200-500 字章节梗概
      key_events: string[],
      target_word_count: number
    }
  ]
}
```

### 9.3.3 segment_versions.edit_metadata

```typescript
// edit_type = 'ai_partial'（选中段落让AI改）
{
  instruction: string,                   // 用户指令
  selection_start: number,
  selection_end: number,
  selected_text: string,
  context_range: 'sentence' | 'paragraph' | 'chapter' | 'full',
  model: string
}

// edit_type = 'rollback'
{
  rolled_back_from_version: number,
  rolled_back_to_version: number
}
```

### 9.3.4 task_events.payload

按 `event_type` 不同：

```typescript
// status_changed
{ from: string, to: string, reason?: string }

// llm_call
{
  phase: 'outline' | 'writing' | 'summary' | 'edit' | 'consistency',
  segment_id?: number,
  model: string,
  tokens_in: number,
  tokens_out: number,
  tokens_total: number,
  elapsed_ms: number,
  finish_reason: string
}

// llm_failed
{
  phase: string,
  model: string,
  error_type: string,                    // RateLimitError | APITimeoutError | ...
  error_msg: string,
  retry_count: number
}

// model_fallback
{
  phase: string,
  segment_id?: number,
  from_model: string,
  to_model: string,
  reason: string
}

// paused / resumed / cancelled
{
  at_chapter?: number,
  at_progress?: number,
  reason?: string                        // 用户填的原因（可选）
}

// segment_edited
{
  segment_id: number,
  version_before: number,
  version_after: number,
  edit_type: string
}
```

## 9.4 关键查询

### 9.4.1 任务列表（含进度）

```sql
SELECT 
    t.id, t.title, t.status, t.progress, t.current_chapter, 
    t.word_count, t.config->>'target_words' AS target_words,
    t.created_at, t.updated_at, t.completed_at,
    t.warning_msg, t.error_msg
FROM tasks t
WHERE t.user_id = $1
  AND ($2::text IS NULL OR t.status = $2)
ORDER BY 
  CASE t.status                        -- 状态优先级排序：待审核 > 进行中 > ...
    WHEN 'review' THEN 1
    WHEN 'outline_review' THEN 2
    WHEN 'writing' THEN 3
    WHEN 'outlining' THEN 4
    WHEN 'paused' THEN 5
    WHEN 'queued' THEN 6
    WHEN 'failed' THEN 7
    WHEN 'approved' THEN 8
    ELSE 9
  END,
  t.created_at DESC
LIMIT 50;
```

### 9.4.2 任务详情（含段落 + 摘要消息）

```sql
-- 主任务
SELECT * FROM tasks WHERE id = $1;

-- 章节
SELECT * FROM segments WHERE task_id = $1 ORDER BY index;

-- 最近 50 条消息（按 kind 分组）
SELECT * FROM messages 
WHERE task_id = $1 
ORDER BY created_at DESC 
LIMIT 50;
```

或单条查询用 JSON 聚合：

```sql
SELECT 
    row_to_json(t) AS task,
    (SELECT json_agg(s ORDER BY s.index) FROM segments s WHERE s.task_id = t.id) AS segments
FROM tasks t
WHERE t.id = $1;
```

### 9.4.3 用户任务统计

```sql
SELECT 
    user_id,
    COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
    COUNT(*) FILTER (WHERE status IN ('queued','outlining','writing','paused')) AS in_progress_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    SUM(total_tokens_in) AS total_tokens_in,
    SUM(total_tokens_out) AS total_tokens_out
FROM tasks
WHERE user_id = $1
  AND created_at >= $2  -- 时间范围
GROUP BY user_id;
```

### 9.4.4 凌晨巡检

```sql
SELECT 
    COUNT(*) FILTER (WHERE status IN ('outlining','writing')) AS still_running,
    COUNT(*) FILTER (WHERE status = 'queued') AS queued,
    COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '12 hours') AS failed_recent,
    COUNT(*) FILTER (WHERE status = 'approved' AND updated_at > NOW() - INTERVAL '12 hours') AS approved_recent
FROM tasks;
```

## 9.5 Alembic 迁移

项目使用 Alembic 管理数据库迁移：

```bash
# 初始化
alembic init migrations

# 自动生成迁移（基于 SQLAlchemy 模型）
alembic revision --autogenerate -m "initial schema"

# 应用迁移
alembic upgrade head

# 回滚一步
alembic downgrade -1
```

迁移文件示例骨架：

```python
# migrations/versions/001_initial.py
"""initial schema"""
revision = '001'
down_revision = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

def upgrade():
    op.create_table('users',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('email', sa.Text(), nullable=False),
        ...
    )
    op.create_unique_constraint('users_email_unique', 'users', ['email'])
    # ... 其他表 ...

def downgrade():
    op.drop_table('task_events')
    op.drop_table('messages')
    # ... ...
```

## 9.6 数据保留与清理策略

定时任务 (Celery beat) 跑这些清理：

| 频率 | 任务 | 保留策略 |
|---|---|---|
| 每天 03:00 | 清理过期 segment_versions | 每段保留最新 20 个 |
| 每天 03:00 | 清理 14 天前的 task_events（除关键事件） | 保留 status_changed/failed 类型 |
| 每天 03:00 | 清理 30 天前的 cancelled 任务 | 物理删除 |
| 每天 03:00 | 清理 90 天前的 failed 任务（无人重试的） | 物理删除 |
| 每周日 04:00 | VACUUM ANALYZE | 维护索引和统计信息 |

```sql
-- 清理 segment_versions 示例
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY segment_id ORDER BY version DESC) AS rn
    FROM segment_versions
)
DELETE FROM segment_versions WHERE id IN (
    SELECT id FROM ranked WHERE rn > 20
);
```

## 9.7 备份策略

- 每日 02:00 用 `pg_dump` 全量备份到 `/backup/{date}.sql.gz`
- 保留 7 天滚动备份 + 每月 1 号备份保留 1 年
- 备份目录监控磁盘空间，低于 10GB 告警
- 详见 [12-deployment.md](./12-deployment.md)
