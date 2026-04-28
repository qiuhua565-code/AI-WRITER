# 13 监控与告警

## 13.1 核心指标

```
任务相关:
  - tasks_in_queue                  当前排队任务数
  - tasks_in_progress               进行中任务数
  - tasks_pending_review            待审核任务数
  - tasks_completed_today           今日完成数
  - tasks_failed_today              今日失败数
  - task_avg_duration_minutes       任务平均耗时
  - task_p95_duration_minutes       任务 P95 耗时

LLM 相关:
  - llm_calls_total                 LLM 调用总次数（按模型/用户/任务阶段分维度）
  - llm_tokens_in/out_total         token 用量
  - llm_call_duration_seconds       调用耗时（histogram）
  - llm_errors_total                按错误类型分（rate_limit/timeout/auth/...）
  - llm_fallback_total              降级次数

系统相关:
  - active_users_in_queue           当前有任务待跑的用户数
  - worker_concurrency_used         worker 并发槽位使用数
  - sse_connections_active          活跃 SSE 连接数
  - db_connections_active
  - redis_memory_used
```

## 13.2 监控分级

### 13.2.1 MVP（必须有）

最简单实现：**任务数据全在数据库 + Redis**，写一个 admin dashboard 页面把这些指标查询并展示即可。不引入额外监控栈。

```python
# app/api/routes/admin/queue.py
@router.get("/api/v1/admin/queue/status")
async def queue_status(db, redis, user: User = Depends(require_admin)):
    # 任务统计
    rows = await db.execute("""
        SELECT status, COUNT(*) as cnt 
        FROM tasks 
        WHERE created_at > NOW() - INTERVAL '24 hours' 
        GROUP BY status
    """)
    today_stats = {row.status: row.cnt for row in rows}
    
    # 当前活跃用户
    active_users = await redis.scard("active_users")
    
    # 当前并发槽位（通过 Redis 计数器）
    used_concurrency = sum(
        int(await redis.get(f"user_concurrency:{u}") or 0)
        for u in await redis.smembers("active_users")
    )
    
    # 估算剩余时间
    queued = today_stats.get('queued', 0)
    in_progress = today_stats.get('writing', 0) + today_stats.get('outlining', 0)
    workers_total = SCHEDULER_TOTAL_CONCURRENCY  # 30
    
    if queued + in_progress > 0:
        remaining_min = (queued + in_progress) * 12 / max(workers_total, 1)
    else:
        remaining_min = 0
    
    return {
        "by_status": today_stats,
        "active_users": active_users,
        "worker_concurrency_used": used_concurrency,
        "worker_concurrency_total": workers_total,
        "estimated_completion_time_min": remaining_min,
        "llm_health": (await redis.get("llm:health")) or "unknown",
    }
```

前端 `/admin/queue` 页面每 10 秒轮询一次。

### 13.2.2 v2（可选增强）

- **Prometheus + Grafana**：
  - FastAPI 加 `prometheus-fastapi-instrumentator` 暴露 `/metrics`
  - Worker 用 `prometheus-client` 自己写指标
  - 部署 Prometheus + Grafana 容器
  - 预制看板：任务漏斗、LLM 用量、错误率
- **Sentry**：异常上报
- **OpenTelemetry**：分布式追踪（虽然单机不太需要）

不在 MVP 范围。

## 13.3 告警规则

### 13.3.1 触发条件

| 严重度 | 条件 | 处理 |
|---|---|---|
| 🔴 紧急 | LLM 中转站连续 5 分钟全失败 | 立即推送，电话/钉钉 |
| 🔴 紧急 | API 服务完全不可用（健康检查失败 2 分钟）| 立即推送 |
| 🟠 严重 | 凌晨 5 点仍有 > 10 个任务未完成 | 推送给管理员 |
| 🟠 严重 | 单日失败任务数 > 20 个 | 推送 |
| 🟡 警告 | 单任务执行 > 25 分钟（接近超时）| 记录日志 |
| 🟡 警告 | 用户 key 验证失败次数突增 | 推送给该用户 + 管理员 |
| 🔵 通知 | 用户每日任务完成（汇总）| 早上 9 点推送日报 |

### 13.3.2 告警通道

```python
# app/services/alert.py
class AlertService:
    def __init__(self, webhook_url: str | None):
        self.webhook_url = webhook_url
    
    async def send(self, level: str, title: str, message: str, **extra):
        # 写日志（始终）
        logger.bind(alert_level=level, **extra).warning(f"{title}: {message}")
        
        # 发 webhook（如配置）
        if self.webhook_url:
            emoji = {"red": "🔴", "orange": "🟠", "yellow": "🟡", "blue": "🔵"}[level]
            content = f"{emoji} [StoryFlow] {title}\n{message}"
            await httpx.post(self.webhook_url, json={
                "msgtype": "text",
                "text": {"content": content}
            }, timeout=10)
```

支持的 webhook 类型（按需选）：

- 钉钉机器人 webhook
- 企业微信群机器人 webhook
- Slack incoming webhook
- 自定义 HTTP 接口

配置方式：

```bash
# .env
ALERT_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx
ALERT_WEBHOOK_TYPE=dingtalk
```

## 13.4 凌晨巡检任务

```python
# app/tasks/health_check.py

@celery_app.task
async def nightly_health_check():
    """每天凌晨 5 点跑一次"""
    db = get_db()
    
    # 任务统计
    in_progress = await db.scalar("""
        SELECT COUNT(*) FROM tasks 
        WHERE status IN ('outlining', 'writing', 'queued', 'paused')
    """)
    
    failed_recent = await db.scalar("""
        SELECT COUNT(*) FROM tasks 
        WHERE status = 'failed' 
          AND updated_at > NOW() - INTERVAL '12 hours'
    """)
    
    approved_recent = await db.scalar("""
        SELECT COUNT(*) FROM tasks 
        WHERE status = 'approved' 
          AND updated_at > NOW() - INTERVAL '12 hours'
    """)
    
    total_overnight = approved_recent + failed_recent + in_progress
    
    msg = f"""昨夜任务汇总（{datetime.now().date()}）:
✅ 已完成: {approved_recent}
⏳ 还在跑: {in_progress}
❌ 失败:   {failed_recent}
─────────────────────────"""
    
    if in_progress > 10:
        # 还有较多任务未完成，发严重告警
        await alert.send(
            level='orange',
            title='凌晨巡检：仍有较多任务未完成',
            message=msg + "\n请管理员查看是否需介入"
        )
        
        # 列出具体哪些任务卡了
        stuck_tasks = await db.execute("""
            SELECT id, title, status, started_at, current_chapter
            FROM tasks 
            WHERE status IN ('outlining', 'writing')
              AND started_at < NOW() - INTERVAL '20 minutes'
            ORDER BY started_at ASC
            LIMIT 10
        """)
        
        for t in stuck_tasks:
            elapsed = datetime.utcnow() - t.started_at
            await alert.send(
                level='yellow',
                title=f'任务执行过长',
                message=f'task_{t.id} "{t.title[:30]}" 已运行 {elapsed.total_seconds() / 60:.1f}分钟'
            )
    
    elif failed_recent > 10:
        await alert.send(
            level='orange',
            title='今日失败任务较多',
            message=msg
        )
    
    else:
        # 一切正常，可选发个友好通知
        await alert.send(
            level='blue',
            title='昨夜批次顺利完成',
            message=msg
        )
```

## 13.5 任务级 watchdog

防止单任务卡死：

```python
# app/tasks/watchdog.py
@celery_app.task
async def watchdog():
    """每 1 分钟跑一次"""
    db = get_db()
    
    # 找出 segment 卡死的（generating 状态但 3 分钟没更新）
    stuck = await db.execute("""
        SELECT s.id, s.task_id, s.index, s.status, s.updated_at, t.title
        FROM segments s
        JOIN tasks t ON t.id = s.task_id
        WHERE s.status = 'generating'
          AND s.updated_at < NOW() - INTERVAL '3 minutes'
    """)
    
    for row in stuck:
        logger.warning(f"watchdog: stuck segment {row.id} (task {row.task_id} ch {row.index})")
        
        # 标记为可续写，等下次拉起
        await db.execute("""
            UPDATE segments SET status = 'needs_continuation', updated_at = NOW()
            WHERE id = :id
        """, {"id": row.id})
        
        await db.execute("""
            UPDATE tasks SET status = 'queued', updated_at = NOW()
            WHERE id = :id AND status IN ('writing', 'outlining')
        """, {"id": row.task_id})
        
        # 重新进队
        await scheduler.enqueue(...)
        
        await db.insert_event(
            task_id=row.task_id,
            event_type='watchdog_requeued',
            actor='system',
            payload={'segment_id': row.id, 'reason': 'no_progress_3min'}
        )
    
    # 找出整个任务超时的（30 分钟没结束）
    timeout_tasks = await db.execute("""
        SELECT id, title FROM tasks 
        WHERE status IN ('outlining', 'writing')
          AND started_at < NOW() - INTERVAL '30 minutes'
    """)
    
    for t in timeout_tasks:
        await db.execute("""
            UPDATE tasks SET status = 'failed', error_msg = '任务执行超过 30 分钟超时'
            WHERE id = :id
        """, {"id": t.id})
        await alert.send('yellow', '任务超时', f'task_{t.id} "{t.title}" 已超时强制失败')
```

## 13.6 LLM 中转站探活

```python
# app/tasks/llm_health.py
@celery_app.task
async def llm_health_check():
    """每 5 分钟探活"""
    health_key_user = os.environ.get('SYSTEM_HEALTH_CHECK_KEY')
    if not health_key_user:
        return
    
    try:
        await llm_client.complete(
            api_key=health_key_user,
            model='claude-3-5-haiku-20241022',
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
        )
        await redis.set("llm:health", "ok", ex=600)
        await redis.delete("llm:consecutive_failures")
    except Exception as e:
        await redis.set("llm:health", f"down:{type(e).__name__}", ex=600)
        consecutive = await redis.incr("llm:consecutive_failures")
        await redis.expire("llm:consecutive_failures", 3600)
        
        if consecutive >= 3:  # 连续 3 次失败 = 15 分钟
            await alert.send(
                'red',
                'LLM 中转站疑似不可用',
                f'连续 {consecutive} 次探活失败: {e}'
            )
```

## 13.7 Celery beat 定时任务配置

```python
# app/celery_app.py
from celery.schedules import crontab

celery_app.conf.beat_schedule = {
    'watchdog': {
        'task': 'app.tasks.watchdog',
        'schedule': 60.0,  # 每分钟
    },
    'llm-health-check': {
        'task': 'app.tasks.llm_health_check',
        'schedule': 300.0,  # 每 5 分钟
    },
    'nightly-health-check': {
        'task': 'app.tasks.nightly_health_check',
        'schedule': crontab(hour=5, minute=0),  # 每天凌晨 5 点
    },
    'cleanup-old-versions': {
        'task': 'app.tasks.cleanup_segment_versions',
        'schedule': crontab(hour=3, minute=0),  # 每天凌晨 3 点
    },
    'cleanup-old-events': {
        'task': 'app.tasks.cleanup_old_events',
        'schedule': crontab(hour=3, minute=15),
    },
    'cleanup-cancelled-tasks': {
        'task': 'app.tasks.cleanup_cancelled_tasks',
        'schedule': crontab(hour=3, minute=30),
    },
    'vacuum-analyze': {
        'task': 'app.tasks.vacuum_analyze',
        'schedule': crontab(hour=4, minute=0, day_of_week=0),  # 每周日 4 点
    },
}
```

## 13.8 日志规范

### 13.8.1 结构化日志

用 `structlog`，所有日志输出 JSON 格式，方便后续 ELK 接入。

```python
# app/core/logging.py
import structlog

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.add_log_level,
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO
)

logger = structlog.get_logger()

# 使用
logger.info("task.started", task_id=task.id, user_id=task.user_id, title=task.title)
logger.warning("llm.fallback", task_id=task.id, from_model="sonnet", to_model="haiku")
logger.error("task.failed", task_id=task.id, error=str(e), exc_info=True)
```

### 13.8.2 日志输出位置

- 容器内打印到 stdout/stderr（默认）
- docker-compose 收集所有容器日志
- 配 logrotate（可选）：

```yaml
# docker-compose.yml service 内
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "5"
```

### 13.8.3 关键事件需打的日志

| 模块 | 事件 | 字段 |
|---|---|---|
| API | 请求开始/完成 | path, method, user_id, status, elapsed_ms |
| API | 鉴权失败 | path, ip, reason |
| Worker | 任务开始 | task_id, user_id, title |
| Worker | LLM 调用 | task_id, phase, model, tokens, elapsed |
| Worker | LLM 失败 | task_id, model, error_type, error_msg |
| Worker | 模型降级 | task_id, from_model, to_model, reason |
| Worker | 任务完成 | task_id, total_tokens, total_time |
| Worker | 任务失败 | task_id, error, retry_count |
| Scheduler | 任务入队 | task_id, user_id |
| Scheduler | 任务出队 | task_id, user_id, queue_wait_ms |
| Watchdog | 卡死任务 | task_id, segment_id, reason |
| Auth | 登录成功/失败 | user_id, ip |

## 13.9 排错常用查询

### 13.9.1 找最近失败的任务

```sql
SELECT id, user_id, title, error_msg, retry_count, updated_at
FROM tasks 
WHERE status = 'failed' 
ORDER BY updated_at DESC 
LIMIT 20;
```

### 13.9.2 看某任务的所有 LLM 调用

```sql
SELECT 
    payload->>'phase' as phase,
    payload->>'model' as model,
    payload->>'tokens_total' as tokens,
    payload->>'elapsed_ms' as ms,
    payload->>'finish_reason' as finish,
    created_at
FROM task_events
WHERE task_id = $1 
  AND event_type = 'llm_call'
ORDER BY created_at;
```

### 13.9.3 看某用户的当日活动

```sql
SELECT event_type, COUNT(*) 
FROM task_events 
WHERE actor = 'user:5' 
  AND created_at > NOW() - INTERVAL '1 day'
GROUP BY event_type;
```

### 13.9.4 卡死段落

```sql
SELECT s.id, s.task_id, s.index, s.status, s.updated_at, t.title, t.user_id
FROM segments s
JOIN tasks t ON t.id = s.task_id
WHERE s.status IN ('generating', 'needs_continuation')
  AND s.updated_at < NOW() - INTERVAL '5 minutes'
ORDER BY s.updated_at ASC;
```
