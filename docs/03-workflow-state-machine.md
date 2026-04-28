# 03 工作流与状态机

## 3.1 任务级状态机

### 3.1.1 状态定义

| 状态 | 中文名 | 说明 | 用户可见 | 终态 |
|---|---|---|---|---|
| `draft` | 草稿 | 在批量提交页编辑中，未提交 | 仅当前用户编辑中 | 否 |
| `queued` | 排队中 | 已提交，等待 worker 拉取 | ✓ | 否 |
| `outlining` | 大纲生成中 | worker 正在调 LLM 生成大纲 | ✓ | 否 |
| `outline_review` | 待审大纲 | 大纲已生成，等待用户审核（仅当 `need_outline_review=true`）| ✓ | 否 |
| `writing` | 正文生成中 | worker 正在按章生成正文 | ✓ | 否 |
| `paused` | 已暂停 | 用户主动暂停，可继续 | ✓ | 否 |
| `review` | 待审核 | 全文生成完毕，等待用户审核 | ✓ | 否 |
| `approved` | 已通过 | 审核通过，可导出 | ✓ | 是 |
| `rejected` | 已退回 | 审核退回，重新进入队列重写 | ✓ | 否（自动转 queued）|
| `cancelled` | 已取消 | 用户主动取消 | ✓ | 是 |
| `failed` | 失败 | 重试耗尽仍失败 | ✓ | 是（可手动重试）|

### 3.1.2 状态转换图

```
                           ┌──────────┐
                           │  draft   │
                           └────┬─────┘
                                │ 用户提交（批量）
                                ▼
              ┌────────────►┌──────────┐
              │             │  queued  │
              │             └────┬─────┘
              │                  │ worker 拉取
              │                  ▼
              │             ┌──────────┐
              │       ┌─────│outlining │
              │       │     └────┬─────┘
              │ pause │     大纲完成
              │       │          │
              │       │   ┌──────┴──────┐
              │       │   │ need_outline_review?
              │       │   └──┬───────┬──┘
              │       │     是│      │否
              │       │       ▼      │
              │       │  ┌─────────────┐
              │       │  │outline_review│
              │       │  └──────┬───────┘
              │       │       通过│  退回
              │       │          │   └─→ queued (重试)
              │       │          ▼
              │       │     ┌──────────┐
              │       └────►│ writing  │◄────┐
              │             └────┬─────┘      │
              │                  │            │ resume
              │             pause│            │
              │                  ▼            │
              │             ┌──────────┐      │
              │             │ paused   │──────┘
              │             └────┬─────┘
              │                  │ cancel
              │                  ▼
              │             ┌──────────┐
              │             │cancelled │ (终态)
              │             └──────────┘
              │
              │   writing 全部章节完成
              │             ▼
              │      ┌──────────────┐
              │      │   review     │
              │      └──┬───────┬───┘
              │      通过│        │退回
              │         │        │
              │         ▼        ▼
              │   ┌──────────┐  ┌──────────┐
              │   │ approved │  │ rejected │
              │   └──────────┘  └────┬─────┘
              │     (终态)           │ 自动转
              └──────────────────────┘
                  
失败路径（任意步骤）：
  outlining/writing 重试耗尽 → failed
  failed 用户点"重试" → queued
```

### 3.1.3 状态转换矩阵

| 当前状态 → 下一状态 | 触发者 | 触发动作 | 副作用 |
|---|---|---|---|
| `draft` → `queued` | 用户 | 点"提交" | 写库 + 发 Celery |
| `queued` → `outlining` | Worker | 拉取任务开始执行 | 标记 `started_at` |
| `outlining` → `outline_review` | Worker | 大纲生成完毕 + need_outline_review=true | SSE 推送，等用户 |
| `outlining` → `writing` | Worker | 大纲生成完毕 + need_outline_review=false | 直接进入下一步 |
| `outline_review` → `writing` | 用户 | 点"通过大纲" | 重新 send_task |
| `outline_review` → `queued` | 用户 | 点"重新生成大纲" | 清空 outline 重新跑 |
| `writing` → `review` | Worker | 全部章节完成 | 拼接 content，SSE 推送 |
| `writing` → `paused` | 用户 → Worker | 用户点"暂停" | 协作式停止 |
| `paused` → `writing` | 用户 | 点"继续" | 清信号 + send_task |
| `paused` → `cancelled` | 用户 | 点"取消" | 状态终结 |
| `outlining`/`writing` → `cancelled` | 用户 | 点"取消" | 协作式停止 |
| `outlining`/`writing` → `failed` | Worker | 重试耗尽 | 记录 error_msg |
| `failed` → `queued` | 用户/管理员 | 点"重试" | 清错误 + send_task |
| `review` → `approved` | 用户 | 点"审核通过" | 锁定内容，可导出 |
| `review` → `rejected` | 用户 | 点"退回重写" | 自动转 queued |
| `rejected` → `queued` | 系统 | 自动 | 清空 segments，从大纲重跑 |

### 3.1.4 失败 → 重试规则

```python
# 任务级失败重试（worker 内部）
RETRYABLE_ERRORS = {
    'timeout', 'rate_limit', '5xx', 'connection_error'
}
NON_RETRYABLE_ERRORS = {
    'invalid_api_key',  # 用户的 key 配错，得提示用户修改
    'content_filter',   # 内容审核拒绝
    'context_length',   # 上下文超限（编排逻辑 bug）
}

MAX_TASK_RETRIES = 3     # 任务级
MAX_SEGMENT_RETRIES = 5  # 段级（更细）

# 退避策略：10s → 30s → 90s → 270s
backoff_seconds = 10 * (3 ** retry_count)
```

## 3.2 段落级状态机

任务下的每个章节是一个 segment，独立有状态。这样能精细化控制续写、单章重试。

### 3.2.1 状态定义

| 状态 | 说明 |
|---|---|
| `pending` | 待生成，未开始 |
| `generating` | LLM 正在流式输出中 |
| `needs_continuation` | LLM 返回 `finish_reason=length`，需要追加续写 |
| `completed` | 章节完成，字数达标且 `finish_reason=stop` |
| `failed` | 单章重试耗尽 |
| `cancelled` | 任务被取消时段落同步取消 |
| `partial_failed` | 重试过多，标记为部分失败但保留已生成内容（最终文章里这章可能不完整） |

### 3.2.2 段级流程

```python
# 简化伪代码
def execute_chapter(seg: Segment):
    while seg.status not in ('completed', 'failed', 'partial_failed'):
        if seg.status == 'pending':
            seg.status = 'generating'
            seg.save()
            
            response = stream_llm(prompt=build_prompt_for_chapter(seg), ...)
            for token in response:
                seg.append_token(token)              # 写 PG + Redis Stream
                check_control_signal(seg.task_id)    # 暂停/取消检查
            
            if response.finish_reason == 'stop' and seg.word_count >= seg.target_words * 0.8:
                seg.status = 'completed'
            elif response.finish_reason == 'length':
                seg.status = 'needs_continuation'
                seg.retry_count += 1
                if seg.retry_count >= MAX_CONTINUATIONS:
                    seg.status = 'partial_failed'
            else:
                seg.status = 'failed'
            seg.save()
        
        elif seg.status == 'needs_continuation':
            # 续写模式
            response = stream_llm(prompt=build_continuation_prompt(seg), ...)
            ...同上处理...
```

详细的章节生成与续写策略见 [04-story-orchestration.md](./04-story-orchestration.md)。

## 3.3 控制信号机制

任务执行中支持三种"外部干预"：暂停、继续、取消。通过 Redis 中的"控制信号"实现协作式中断。

### 3.3.1 信号存储

```
Redis Key: task:{task_id}:control
Value: "pause" | "cancel" | "" (空表示无信号)
TTL: 24h（防止脏数据残留）
```

### 3.3.2 设置信号（API 端）

| 操作 | API | Redis 操作 |
|---|---|---|
| 暂停 | `POST /api/tasks/{id}/pause` | `SET task:{id}:control "pause" EX 86400` |
| 继续 | `POST /api/tasks/{id}/resume` | `DEL task:{id}:control` + `celery.send_task(...)` |
| 取消 | `POST /api/tasks/{id}/cancel` | `SET task:{id}:control "cancel" EX 86400` |

### 3.3.3 检查信号（Worker 端）

worker 在以下时机检查信号：

1. **每章节开始前**：检查一次
2. **每 50 个流式 token**：检查一次（折中性能与响应性）
3. **每次 LLM 调用前**：检查一次

```python
def should_stop(task_id: int) -> Optional[str]:
    signal = redis.get(f"task:{task_id}:control")
    return signal.decode() if signal else None

# 在生成循环中
for i, token in enumerate(stream):
    if i % 50 == 0:
        signal = should_stop(seg.task_id)
        if signal == 'pause':
            seg.task.status = 'paused'
            seg.save_with_pending_buffer()
            return  # worker 协程退出，释放槽位
        elif signal == 'cancel':
            seg.task.status = 'cancelled'
            seg.status = 'cancelled'
            seg.save()
            return
    seg.append_token(token)
```

### 3.3.4 暂停后的状态保持

暂停时的"现场"完全保留在数据库里：

- `tasks.status = 'paused'`
- `tasks.outline` 已生成的部分
- `segments[i].content` 当前章节已生成的内容
- `segments[i].status = 'generating' | 'needs_continuation'` 该章节的进度
- 用户可以查看、编辑、再继续

继续时：
1. API 清掉 Redis 信号
2. 重新 `celery.send_task('run_story', task_id)`
3. Worker 拉到任务，看到 `status='paused' → writing`，从 segments 当前状态接着跑
4. 编排引擎是幂等的：已 `completed` 的 segment 跳过，从 `pending`/`needs_continuation` 的开始

## 3.4 任务级别"退回重写"机制

审核期点"退回重写"，行为：

```python
async def reject_task(task_id, reason):
    task = await db.get_task(task_id)
    
    # 记录历史（不彻底删除，留作审计）
    await db.insert_event(task_id, type='rejected', payload={'reason': reason, 'old_content': task.content})
    
    # 重置任务状态，但保留大纲（一般大纲没问题，问题在正文）
    task.content = None
    task.word_count = None
    task.error_msg = None
    task.status = 'queued'
    task.retry_count = 0
    
    # 删除/归档 segments（让 worker 重新生成）
    await db.archive_segments(task_id)  # 移到 segments_archive 表
    await db.delete_segments(task_id)
    
    # 重发任务
    celery.send_task('run_story', task_id)
```

**注意**：不重新生成大纲。如果用户想换大纲，应该用"重新生成大纲"而不是"退回重写"。

## 3.5 状态字段计算

任务列表卡片需要展示进度。`progress` 字段在 `tasks` 表中由 worker 实时维护：

```python
def calculate_progress(task) -> int:
    """0-100 的整数百分比"""
    if task.status in ('queued',):
        return 0
    if task.status == 'outlining':
        return min(int(len(task.outline_buffer) / 2000 * 10), 9)  # 最多 9%
    if task.status == 'outline_review':
        return 10
    if task.status == 'writing':
        total_target = sum(s.target_word_count for s in task.segments)
        total_written = sum(s.word_count for s in task.segments)
        return 10 + int(total_written / total_target * 80)  # 10-90%
    if task.status in ('review', 'approved'):
        return 100
    if task.status == 'paused':
        return task.last_progress  # 暂停前的最后进度
    return 0
```

`current_chapter` 字段（用于卡片显示"正在写第 3 章"）：

```python
def calculate_current_chapter(task) -> Optional[int]:
    if task.status != 'writing':
        return None
    for seg in task.segments_ordered():
        if seg.status in ('pending', 'generating', 'needs_continuation'):
            return seg.index
    return None
```

这两个字段不需要每个 token 都更新，**每完成一段或每 30 秒更新一次**即可，避免数据库压力过大。

## 3.6 任务事件表（审计）

每次状态转换、LLM 调用、用户操作都写入 `task_events` 表，便于排错和审计。

```sql
INSERT INTO task_events (task_id, event_type, actor, payload, created_at)
VALUES 
  (1, 'status_changed', 'worker',  '{"from": "queued", "to": "outlining"}', NOW()),
  (1, 'llm_call',        'worker',  '{"model": "claude-3-5-sonnet", "tokens_in": 850, "tokens_out": 1200, "elapsed_ms": 8500}', NOW()),
  (1, 'paused',          'user:5',  '{"at_chapter": 3, "at_progress": 67}', NOW()),
  (1, 'resumed',         'user:5',  '{}', NOW()),
  (1, 'edited',          'user:5',  '{"segment_id": 12, "version_before": 2, "version_after": 3}', NOW());
```

详细 schema 见 [09-data-model.md](./09-data-model.md)。
