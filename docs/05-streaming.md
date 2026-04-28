# 05 流式输出机制

实现 Cherry Studio 同等流畅度的逐字流式输出，且支持断线重连、多端同步、关浏览器再开。这是前端体验的关键，也是技术实现上最有讲究的部分。

## 5.1 三段式流通道总览

```
┌─────────────────┐
│  外部 LLM 中转站 │
└────────┬────────┘
         │ Server-Sent Events (OpenAI 协议)
         │ data: {"choices":[{"delta":{"content":"他"}}]}
         ▼
┌─────────────────────────────────────────┐
│  Worker (Celery 内)                     │
│                                         │
│  - 收到 token 立即两件事:                │
│    1. 累积到 segment.content (PG 落库)  │
│    2. xadd 到 Redis Stream             │
└────────┬────────────────────────────────┘
         │ Redis XADD task:{id}:stream
         ▼
┌─────────────────────────────────────────┐
│  Redis Streams (持久化 pub/sub)         │
│                                         │
│  Key: task:{task_id}:stream             │
│  Type: STREAM                           │
│  保留窗口: 1000 entries 或 24h          │
└────────┬────────────────────────────────┘
         │ XREAD BLOCK (订阅) 或 XRANGE (回放)
         ▼
┌─────────────────────────────────────────┐
│  FastAPI SSE 端点                       │
│  GET /api/tasks/{id}/stream             │
│                                         │
│  - 先 XRANGE 补齐 since=<lastEventId>   │
│  - 再 XREAD 实时订阅新 entries          │
│  - 包装成 SSE event 推给浏览器          │
└────────┬────────────────────────────────┘
         │ SSE: text/event-stream
         │ event: token
         │ data: {"content":"他","seg":12}
         │ id: 1234567890-0
         ▼
┌─────────────────────────────────────────┐
│  浏览器 EventSource                     │
│                                         │
│  - 自动重连（带 Last-Event-ID）         │
│  - 用 rAF 批合并 setState              │
│  - 增量 markdown 渲染                  │
└─────────────────────────────────────────┘
```

## 5.2 Redis Stream 设计

### 5.2.1 Key 规范

| Key 模式 | 用途 | TTL |
|---|---|---|
| `task:{task_id}:stream` | 任务的 token 流 + 状态事件 | 24 小时 |
| `task:{task_id}:control` | 控制信号（pause/cancel）| 24 小时 |
| `user:{user_id}:tasks_changed` | 任务列表的状态变化广播 | 1 小时 |

### 5.2.2 Stream 消息格式

每条 entry 是一个 hash，字段如下：

```python
# Worker 写入
await redis.xadd(
    stream_key,
    {
        "type": "token",          # token | outline_token | segment_status | task_status | error
        "segment_id": "12",       # 该 token 属于哪个 segment（type=token 时必填）
        "content": "他",          # token 内容（type=*_token 时必填）
        "seq": "1234"             # worker 内部序号（用于客户端去重）
    },
    maxlen=("~", 5000),           # 软上限 5000 条，自动 trim
)
```

### 5.2.3 消息类型

| type | 含义 | 关键字段 |
|---|---|---|
| `outline_token` | 大纲生成的 token | `content` |
| `outline_complete` | 大纲生成完毕 | `outline` (完整 JSON) |
| `token` | 章节正文 token | `segment_id`, `content` |
| `segment_status` | 段落状态变更 | `segment_id`, `status`, `word_count` |
| `task_status` | 任务状态变更 | `from`, `to` |
| `progress` | 进度更新 | `progress`, `current_chapter`, `word_count` |
| `error` | 错误事件（不致命）| `message`, `recoverable` |
| `done` | 任务执行结束（成功或失败）| `final_status` |

### 5.2.4 持久化与回放

- `maxlen=("~", 5000)`：保留最近 5000 条 entry，约够 1 万字流式记录
- 章节完成后**不立即删除流**，保留 24 小时（用 `EXPIRE`）
- 用户如果在任务结束 24 小时内重新打开页面，仍能从历史 stream "回放"完整生成过程
- 24 小时后流过期，前端从 `tasks.content` 直接读最终结果（无回放，但内容完整）

## 5.3 SSE 端点实现

### 5.3.1 路由定义

```python
# app/api/routes/tasks_stream.py

from fastapi import APIRouter, Depends, Header, Request
from sse_starlette.sse import EventSourceResponse

router = APIRouter()

@router.get("/api/tasks/{task_id}/stream")
async def task_stream(
    task_id: int,
    request: Request,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    since: str | None = None,           # 可选 query 参数，覆盖 header
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    # 鉴权：只有任务的拥有者或管理员能订阅
    task = await db.get_task(task_id)
    if not task or (task.user_id != user.id and user.role != 'admin'):
        raise HTTPException(403)
    
    start_id = since or last_event_id or "0"  # 默认从头读
    
    return EventSourceResponse(
        _stream_generator(redis, task_id, start_id, request),
        ping=15,  # 每 15s 发心跳防止代理超时
    )


async def _stream_generator(redis, task_id, start_id, request):
    stream_key = f"task:{task_id}:stream"
    
    # Phase 1: 补齐历史
    history = await redis.xrange(stream_key, min=start_id, max="+", count=1000)
    for entry_id, fields in history:
        if await request.is_disconnected():
            return
        yield {
            "id": entry_id,
            "event": fields.get("type", "message"),
            "data": json.dumps({k: v for k, v in fields.items() if k != "type"}),
        }
        start_id = entry_id
    
    # Phase 2: 实时订阅
    while not await request.is_disconnected():
        # XREAD BLOCK 5000ms STREAMS task:xx:stream <last_id>
        result = await redis.xread({stream_key: start_id}, count=100, block=5000)
        if not result:
            continue  # 超时无新消息，循环再读
        
        for _stream, entries in result:
            for entry_id, fields in entries:
                yield {
                    "id": entry_id,
                    "event": fields.get("type", "message"),
                    "data": json.dumps({k: v for k, v in fields.items() if k != "type"}),
                }
                start_id = entry_id
                
                # 任务结束就关闭流
                if fields.get("type") == "done":
                    return
```

### 5.3.2 SSE 响应格式

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no    ← 关键! nginx 反代时禁用缓冲

id: 1700000000000-0
event: token
data: {"content":"他","segment_id":"12","seq":"1"}

id: 1700000000001-0
event: token
data: {"content":"望","segment_id":"12","seq":"2"}

: heartbeat              ← 每 15s 一个注释行作为心跳

id: 1700000000050-0
event: segment_status
data: {"segment_id":"12","status":"completed","word_count":2450}

id: 1700000000051-0
event: done
data: {"final_status":"review"}
```

## 5.4 前端 SSE 消费

### 5.4.1 选用方案

不用 Vercel AI SDK 的 `useChat`，因为我们后端是 Python，且需要更精细的多种 event 处理。直接用：

- 浏览器原生 `EventSource`（基础场景）
- 或 `@microsoft/fetch-event-source`（推荐，支持自定义 headers / fetch 拦截）

```typescript
// lib/sse-client.ts
import { fetchEventSource } from '@microsoft/fetch-event-source';

interface StreamOptions {
  taskId: number;
  since?: string;
  onToken: (data: { segmentId: string; content: string }) => void;
  onStatus: (data: { from: string; to: string }) => void;
  onProgress: (data: { progress: number; currentChapter: number }) => void;
  onDone: (data: { finalStatus: string }) => void;
  onError: (err: Error) => void;
}

export async function subscribeTaskStream(opts: StreamOptions, signal: AbortSignal) {
  let lastEventId = opts.since || '';
  
  await fetchEventSource(`/api/tasks/${opts.taskId}/stream`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
    },
    signal,
    
    onmessage(ev) {
      lastEventId = ev.id;
      const data = JSON.parse(ev.data);
      
      switch (ev.event) {
        case 'token':
        case 'outline_token':
          opts.onToken(data);
          break;
        case 'task_status':
          opts.onStatus(data);
          break;
        case 'progress':
          opts.onProgress(data);
          break;
        case 'done':
          opts.onDone(data);
          break;
      }
    },
    
    onerror(err) {
      opts.onError(err);
      // 自动重连：fetchEventSource 默认会重试，带上 lastEventId
      throw err;  // throw 让其退避重试（默认 1s, 2s, 4s...）
    },
  });
}
```

### 5.4.2 渲染优化（核心）

**问题**：1-2 万字逐 token 渲染，如果每个 token 都 `setState`，React 会触发上千次 re-render，浏览器卡死。

**方案**：用 `requestAnimationFrame` 批合并 + 章节级局部更新。

```typescript
// hooks/useStreamingText.ts
import { useState, useRef, useCallback, useEffect } from 'react';

export function useStreamingText() {
  // 每段独立 state（章节切换时只动当前章）
  const [segments, setSegments] = useState<Map<string, string>>(new Map());
  const pendingTokens = useRef<Map<string, string[]>>(new Map());
  const rafScheduled = useRef(false);
  
  const flush = useCallback(() => {
    rafScheduled.current = false;
    if (pendingTokens.current.size === 0) return;
    
    setSegments(prev => {
      const next = new Map(prev);
      for (const [segId, tokens] of pendingTokens.current) {
        const old = next.get(segId) || '';
        next.set(segId, old + tokens.join(''));
      }
      return next;
    });
    
    pendingTokens.current.clear();
  }, []);
  
  const appendToken = useCallback((segId: string, content: string) => {
    const arr = pendingTokens.current.get(segId) || [];
    arr.push(content);
    pendingTokens.current.set(segId, arr);
    
    if (!rafScheduled.current) {
      rafScheduled.current = true;
      requestAnimationFrame(flush);
    }
  }, [flush]);
  
  return { segments, appendToken };
}
```

**效果**：每帧最多 1 次 `setState`，60fps 下流式输出顺滑无卡顿。即使 LLM 一秒吐 100 个 token，浏览器也只需 60 次合并更新。

### 5.4.3 增量 Markdown 渲染

流式输出过程中，markdown 经常处于"半边语法"状态（如 `**未闭合的粗体`），直接渲染会乱。

**方案**：用 `streaming-markdown` 或 `markdown-it` 配合"安全模式"——遇到不闭合的 token 不抛错，渲染成纯文本。

```typescript
// components/StreamingMarkdown.tsx
import MarkdownIt from 'markdown-it';
import { useMemo } from 'react';

const md = MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

export function StreamingMarkdown({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      return md.render(text);
    } catch {
      return text;  // 解析失败回退到纯文本
    }
  }, [text]);
  
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
```

如果文章特别长（>5万字）需要更激进的优化，可上 `react-virtuoso` 做章节级虚拟滚动，但 1-2 万字的故事不需要。

### 5.4.4 自动滚动（"sticky bottom"）

```typescript
// hooks/useStickyBottom.ts
export function useStickyBottom(containerRef: RefObject<HTMLElement>, dep: any) {
  const userScrolledUp = useRef(false);
  
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUp.current = distanceFromBottom > 50;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef]);
  
  useEffect(() => {
    const el = containerRef.current;
    if (!el || userScrolledUp.current) return;  // 用户上滑，不打扰
    el.scrollTop = el.scrollHeight;
  }, [dep, containerRef]);
}
```

用法：

```typescript
const containerRef = useRef<HTMLDivElement>(null);
useStickyBottom(containerRef, segments);  // segments 变化时自动滚到底
```

## 5.5 任务列表的实时状态更新

任务列表页 (`/dashboard`) 不需要订阅 token 流，只需要任务状态、进度的变化。用一个独立的轻量 SSE 通道：

```python
# 端点
GET /api/tasks/stream?user_id=me

# Worker 在状态变化时
await redis.xadd(
    f"user:{user_id}:tasks_changed",
    {
        "task_id": str(task_id),
        "status": "writing",
        "progress": 45,
        "current_chapter": 3,
        "word_count": 4200,
    }
)
```

前端在任务列表页订阅这个流，收到事件后局部更新对应卡片。**不要重新拉整个列表**。

```typescript
useEffect(() => {
  const ctrl = new AbortController();
  fetchEventSource('/api/tasks/stream', {
    signal: ctrl.signal,
    onmessage(ev) {
      const data = JSON.parse(ev.data);
      setTasks(prev => prev.map(t => 
        t.id === data.task_id 
          ? { ...t, status: data.status, progress: data.progress, ... }
          : t
      ));
    },
  });
  return () => ctrl.abort();
}, []);
```

## 5.6 多端同步与断线重连

### 5.6.1 关浏览器再开

1. 任务详情页 mount 时先 `GET /api/tasks/{id}/full` 一次性拿当前完整状态（含已生成的全部内容）
2. 用 response 的 `last_event_id` 字段订阅 SSE
3. SSE 端会先 XRANGE 补齐漏掉的 token，再切到实时
4. **总耗时**：约 1-2 秒就能恢复到当前状态

### 5.6.2 多端同时打开

1. 所有端订阅同一个 `task:{id}:stream`，Redis Streams 天然支持多消费者扇出
2. 每端独立维护自己的 `lastEventId`，互不干扰
3. 编辑操作（PATCH）会通过乐观锁版本号互斥（详见 06）

### 5.6.3 网络抖动

- `fetchEventSource` 自带指数退避重连（1s → 2s → 4s → 8s，封顶）
- 重连时带上最后收到的 `Last-Event-ID`，服务端从断点继续
- 用户感知最多 1-2 秒空白

## 5.7 性能与限制

| 项 | 数值 |
|---|---|
| 单流并发订阅上限 | 不限（Redis Streams 扩展性强）|
| 每秒推送 token 数 | 50-200（LLM 实际速度）|
| 浏览器渲染峰值 | rAF 批合并后 60fps 流畅 |
| Redis Stream 内存 | 每任务 ~500KB（5000 entry × 100 字节）|
| SSE 心跳 | 每 15s 发一次，防代理超时 |
| 端点重连退避 | 1s → 2s → 4s → 8s（封顶 30s）|

## 5.8 nginx 反代配置（关键）

如果前置 nginx，**必须**关闭对 SSE 端点的缓冲，否则 token 会被攒到一定大小才推送，前端看起来一卡一卡的：

```nginx
location /api/tasks/ {
    proxy_pass http://api:8000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;             # 关键！
    proxy_read_timeout 24h;          # SSE 长连接，避免 60s 超时
    proxy_set_header X-Accel-Buffering no;
}
```
