# 07 任务调度与并发

定义任务在 worker 池中如何排队、分发、并发执行，以及暂停/继续/取消的协作式控制机制。

## 7.1 容量规划回顾

**预期负载：**

| 维度 | 数值 |
|---|---|
| 用户数 | 40 |
| 高峰任务量 | 400 任务/晚（每人 10 个）|
| 单任务平均耗时 | 12 分钟 |
| 总工作量 | 4800 任务·分钟 |
| 时间窗口 | 18:00 → 09:00 (15 小时) |
| 期望跑完时长 | < 4 小时（凌晨 2 点前） |

**配置：**

| 项 | 数值 | 说明 |
|---|---|---|
| Worker 容器数 | 2 | 分散负载、便于滚动重启 |
| 每容器并发 | 15 (gevent 协程) | 协程开销小，IO 密集 |
| **总并发任务** | **30** | 4800 / 30 ≈ 160 分钟（2.7 小时）|
| 每用户并发上限 | 5 | 防止单用户 key 被打爆 |

实际运行时 LLM 调用大部分时间在等响应，gevent 协程池能轻松撑 30 并发，CPU 占用低。

## 7.2 公平用户队列调度

### 7.2.1 问题

Celery 默认 FIFO 队列：

```
17:55 老王刷的提了 50 个任务 → task_1..task_50 进队
18:00 老李提了 10 个                → task_51..task_60 进队
```

worker 拉到的顺序就是 task_1, task_2, ..., task_50, task_51, ...

老李得等老王的 50 个全跑完才轮到，体验糟糕。

### 7.2.2 解决方案：用户级公平轮询

不直接把任务进 Celery 默认队列，而是先进入"用户分片"队列，调度器按用户轮询取任务。

```
Redis 数据结构：
  user_queue:{user_id}  (LIST) → [task_id_1, task_id_2, ...]
  active_users          (SET)   → 当前有任务待跑的用户 id 集合
  rr_cursor             (STRING)→ 轮询游标
```

### 7.2.3 调度逻辑

```python
# app/scheduler/fair_user_queue.py

class FairUserQueue:
    def __init__(self, redis: Redis):
        self.redis = redis
    
    async def enqueue(self, user_id: int, task_id: int):
        """提交任务"""
        async with self.redis.pipeline() as p:
            p.rpush(f"user_queue:{user_id}", task_id)
            p.sadd("active_users", user_id)
            await p.execute()
    
    async def dequeue(self) -> Optional[Tuple[int, int]]:
        """worker 取下一个任务，返回 (user_id, task_id) 或 None"""
        active_users = await self.redis.smembers("active_users")
        if not active_users:
            return None
        
        # 排序保证顺序确定
        users = sorted(int(u) for u in active_users)
        
        # 读游标：上次轮到谁了
        cursor = int(await self.redis.get("rr_cursor") or 0)
        
        # 从游标位置开始扫一圈
        n = len(users)
        for i in range(n):
            idx = (cursor + i) % n
            user_id = users[idx]
            
            task_id = await self.redis.lpop(f"user_queue:{user_id}")
            if task_id:
                # 更新游标到下一位
                await self.redis.set("rr_cursor", (idx + 1) % n)
                
                # 如果该用户队列空了，移出 active_users
                remaining = await self.redis.llen(f"user_queue:{user_id}")
                if remaining == 0:
                    await self.redis.srem("active_users", user_id)
                
                return (user_id, int(task_id))
        
        return None
```

### 7.2.4 与 Celery 集成

不直接用 Celery 默认队列触发，而是：

```python
# 提交任务（API 端）
@router.post("/api/tasks/batch")
async def submit_batch(payload, user, db, scheduler):
    task_ids = []
    for title in payload.titles:
        task = Task(user_id=user.id, title=title, status='queued', ...)
        db.add(task)
        await db.flush()
        await scheduler.enqueue(user.id, task.id)
        task_ids.append(task.id)
    
    await db.commit()
    return {"task_ids": task_ids}


# Worker 入口（一个常驻拉取协程）
@celery_app.task(bind=True)
def dispatcher(self):
    """常驻调度器，从公平队列取任务后启动子任务"""
    while True:
        result = await scheduler.dequeue()
        if not result:
            await asyncio.sleep(1)
            continue
        user_id, task_id = result
        
        # 实际执行用 Celery 子任务（享受 Celery 的重试机制）
        run_story.delay(task_id)
```

或更简单的实现：**每个 worker 进程内开一个调度协程**：

```python
# worker.py 启动时
async def main():
    scheduler = FairUserQueue(redis)
    semaphore = asyncio.Semaphore(15)   # 并发上限
    
    async def run_one(user_id, task_id):
        async with semaphore:
            try:
                await StoryOrchestrator(...).run(task_id)
            except Exception as e:
                logger.exception(f"Task {task_id} failed")
    
    while True:
        result = await scheduler.dequeue()
        if not result:
            await asyncio.sleep(0.5)
            continue
        user_id, task_id = result
        asyncio.create_task(run_one(user_id, task_id))
```

这种模式跳过了 Celery 任务队列，直接用 Redis 列表，简单直接。重试逻辑由 orchestrator 内部处理。

**取舍：**

| 模式 | 优点 | 缺点 |
|---|---|---|
| Celery + 调度器 task | 享受 Celery 完整重试、监控（Flower）| 多一层间接 |
| 直接 Redis + asyncio | 简单、无中间层 | 重试要自己实现 |

**推荐 MVP 用 Celery 模式**，因为：
- 重试机制成熟
- Flower 监控免费
- 出错可见性高

## 7.3 单用户并发限制

每个用户的 LLM key 通常有并发限制（中转站常见 5-10）。需要在 worker 内做限流。

### 7.3.1 信号量池

```python
# app/scheduler/user_limiter.py

class UserConcurrencyLimiter:
    """每个用户独立的信号量，防止某用户的 key 被打爆"""
    
    def __init__(self, redis: Redis):
        self.redis = redis
        self._local_semaphores = {}  # 本进程内缓存
    
    async def acquire(self, user_id: int, limit: int = 5):
        """获取一个并发槽，超过 limit 时阻塞等待"""
        key = f"user_concurrency:{user_id}"
        
        # 尝试自增；如超限则等待
        while True:
            current = await self.redis.incr(key)
            await self.redis.expire(key, 600)  # 10min TTL 防泄漏
            
            if current <= limit:
                return  # 成功获取
            
            # 超限，回退并等待
            await self.redis.decr(key)
            await asyncio.sleep(2)
    
    async def release(self, user_id: int):
        await self.redis.decr(f"user_concurrency:{user_id}")
```

实际中用 Redis 实现的滑动窗口限流器更精细，但本场景用计数器就够了。

### 7.3.2 在 orchestrator 中应用

```python
async def run_one(user_id, task_id):
    async with semaphore:                          # worker 全局并发
        await user_limiter.acquire(user_id, limit=user.key_concurrency_limit)
        try:
            await StoryOrchestrator(...).run(task_id)
        finally:
            await user_limiter.release(user_id)
```

效果：
- 老王同时被分到 8 个任务，但他的 key 限制 5 → 5 个跑、3 个等
- 等待时不阻塞 worker，worker 让出协程跑别人的任务（asyncio 天然支持）

## 7.4 暂停 / 继续 / 取消

详细机制见 [03-workflow-state-machine.md §3.3](./03-workflow-state-machine.md)，本节补充实现细节。

### 7.4.1 API 端处理

```python
@router.post("/api/tasks/{task_id}/pause")
async def pause_task(task_id, user, db, redis):
    task = await db.get_task(task_id)
    # 鉴权
    if task.user_id != user.id and user.role != 'admin':
        raise HTTPException(403)
    
    if task.status not in ('outlining', 'writing'):
        raise HTTPException(400, "当前状态不可暂停")
    
    # 设置控制信号
    await redis.set(f"task:{task_id}:control", "pause", ex=86400)
    
    # 立即返回（不等 worker 真正停下）
    return {"status": "pausing", "message": "暂停指令已发送，将在数秒内生效"}


@router.post("/api/tasks/{task_id}/resume")
async def resume_task(task_id, user, db, redis, scheduler):
    task = await db.get_task(task_id)
    if task.user_id != user.id and user.role != 'admin':
        raise HTTPException(403)
    
    if task.status != 'paused':
        raise HTTPException(400, "任务未处于暂停状态")
    
    # 清除控制信号
    await redis.delete(f"task:{task_id}:control")
    
    # 重新进队
    task.status = 'queued'
    await db.commit()
    await scheduler.enqueue(task.user_id, task.id)
    
    return {"status": "resumed"}


@router.post("/api/tasks/{task_id}/cancel")
async def cancel_task(task_id, user, db, redis):
    task = await db.get_task(task_id)
    if task.user_id != user.id and user.role != 'admin':
        raise HTTPException(403)
    
    if task.status in ('approved', 'cancelled', 'failed'):
        raise HTTPException(400, "任务已结束")
    
    # 如果还在跑，先发取消信号
    if task.status in ('outlining', 'writing'):
        await redis.set(f"task:{task_id}:control", "cancel", ex=86400)
        # 不在这里改状态，等 worker 检测到信号后改
    elif task.status in ('queued', 'paused', 'outline_review'):
        # 不在跑，直接改状态
        task.status = 'cancelled'
        await db.commit()
        # 从公平队列里删除（如果还在）
        await scheduler.remove(task.user_id, task.id)
    
    return {"status": "cancelling"}
```

### 7.4.2 Worker 端检查

worker 在 orchestrator 中按 [04-story-orchestration.md §4.4.3](./04-story-orchestration.md) 的逻辑每 50 token 检查一次信号。**不要用 Celery 的 revoke**，因为：
- revoke 只能在任务还没开始时取消
- 强杀已运行任务会留脏数据（半成品段落、孤立的 LLM 流）
- 协作式停止能让 worker 优雅清理

### 7.4.3 队列清理

任务被取消时，需要从 Redis 公平队列里清掉（如果它还没被 dequeue）：

```python
async def remove(self, user_id: int, task_id: int):
    """从队列里移除指定任务"""
    await self.redis.lrem(f"user_queue:{user_id}", 0, task_id)
    # 如果队列空了，从 active_users 移除
    remaining = await self.redis.llen(f"user_queue:{user_id}")
    if remaining == 0:
        await self.redis.srem("active_users", user_id)
```

## 7.5 任务超时

为防止单任务无限挂起（如 LLM 中转站僵死无响应），设置硬超时。

### 7.5.1 超时阈值

```python
TASK_TIMEOUT_SECONDS = 30 * 60        # 单任务总执行时间 30 分钟
LLM_CALL_TIMEOUT_SECONDS = 5 * 60     # 单次 LLM 调用 5 分钟
SEGMENT_INACTIVITY_SECONDS = 3 * 60   # 段落 3 分钟无进度判定为卡死
```

### 7.5.2 实现

**任务级超时**：用 `asyncio.wait_for`：

```python
try:
    await asyncio.wait_for(
        StoryOrchestrator(...).run(task_id),
        timeout=TASK_TIMEOUT_SECONDS
    )
except asyncio.TimeoutError:
    task.status = 'failed'
    task.error_msg = f'任务执行超过 {TASK_TIMEOUT_SECONDS}s 超时'
    await db.commit()
```

**LLM 调用级超时**：在 OpenAI SDK 调用时传：

```python
client = AsyncOpenAI(timeout=LLM_CALL_TIMEOUT_SECONDS, max_retries=0)
# 重试由我们的代码控制，不依赖 SDK
```

**段落无进度检测**：定时任务巡检：

```python
@celery_app.task
def watchdog():
    """每 1 分钟跑一次，检查卡死的段落"""
    stuck = await db.query(
        Segment,
        status='generating',
        updated_at__lt=now() - timedelta(seconds=SEGMENT_INACTIVITY_SECONDS)
    )
    for seg in stuck:
        # 强制标记需要续写，让 worker 下次拉到时重启
        seg.status = 'needs_continuation'
        seg.task.status = 'queued'  # 重新进队
        await scheduler.enqueue(seg.task.user_id, seg.task.id)
        logger.warning(f"Watchdog detected stuck segment {seg.id}, requeued")
```

## 7.6 凌晨巡检

每天凌晨 5 点定时任务，检查队列健康并发告警：

```python
@celery_app.task
def nightly_health_check():
    stats = {
        'in_progress': await db.count(Task, status__in=['outlining', 'writing']),
        'queued': await db.count(Task, status='queued'),
        'failed_today': await db.count(Task, status='failed', updated_at__gte=today_start()),
        'approved_today': await db.count(Task, status='approved', updated_at__gte=today_start()),
    }
    
    if stats['in_progress'] + stats['queued'] > 0:
        send_alert(
            "AI-StoryFlow 凌晨巡检",
            f"早上 5 点仍有 {stats['in_progress'] + stats['queued']} 个任务未完成，请查看后台",
            channel='admin_email'  # 或企微 webhook
        )
    
    if stats['failed_today'] > 10:
        send_alert(
            "AI-StoryFlow 失败任务过多",
            f"今日失败任务 {stats['failed_today']} 个，请人工排查",
        )
```

详见 [13-monitoring.md](./13-monitoring.md)。

## 7.7 配置项总结

```yaml
# config.yaml 或环境变量
scheduler:
  worker_replicas: 2              # docker-compose replicas
  worker_concurrency: 15          # 每进程协程数
  user_concurrency_default: 5     # 每用户默认并发
  fair_queue_poll_interval: 0.5   # 调度轮询间隔（秒）

timeouts:
  task_total: 1800                # 30 分钟
  llm_call: 300                   # 5 分钟
  segment_inactivity: 180         # 3 分钟

retries:
  max_task_retries: 3
  max_segment_retries: 5
  max_continuations: 5
  backoff_base: 10
  backoff_factor: 3
  backoff_max: 600
```
