# 02 总体架构

## 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│  浏览器 (Next.js 16 前端)                                        │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ 任务列表页    │  │ 批量提交页    │  │ 文章编辑/审核页         │ │
│  │ (SSE+轮询)   │  │              │  │ (TipTap+SSE流式)       │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ 大纲审核页    │  │ 个人设置     │  │ 管理后台               │ │
│  │              │  │ (Key配置)    │  │ (用户/统计/任务监控)    │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS (REST + SSE)
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  FastAPI 网关层 (api/)                                           │
│                                                                  │
│  ┌─────────────────┐ ┌─────────────────┐ ┌──────────────────┐  │
│  │ Auth Middleware │ │  REST Routers   │ │  SSE Endpoints   │  │
│  │ (JWT)           │ │  /tasks /users  │ │  /tasks/{id}/    │  │
│  │                 │ │  /admin /export │ │   stream         │  │
│  └─────────────────┘ └─────────────────┘ └──────────────────┘  │
└────────┬────────────────────────────────────────────┬───────────┘
         │ 提交任务/查状态                            │ 订阅事件
         ▼                                            ▼
   ┌─────────────┐                         ┌──────────────────┐
   │ PostgreSQL  │                         │  Redis           │
   │             │                         │                  │
   │ - users     │                         │ - Celery 队列    │
   │ - tasks     │◄────────write data──────│ - Streams (token)│
   │ - segments  │                         │ - 控制信号       │
   │ - segment_  │                         │ - Key 池信号量   │
   │   versions  │                         │ - 限流计数       │
   │ - messages  │                         └──────┬───────────┘
   │ - events    │                                │
   └──────▲──────┘                                │ 取任务/订阅
          │                                       ▼
          │ ORM (SQLAlchemy async)        ┌──────────────────────────┐
          │                               │  Celery Worker 集群       │
          │                               │  (gevent pool)            │
          │                               │                           │
          └───────────────────────────────┤  ┌─────────────────────┐  │
                                          │  │ 故事编排引擎         │  │
                                          │  │ StoryOrchestrator   │  │
                                          │  │                     │  │
                                          │  │  ├ OutlineGenerator │  │
                                          │  │  ├ ChapterWriter    │  │
                                          │  │  ├ Continuator      │  │
                                          │  │  ├ Validator        │  │
                                          │  │  └ Assembler        │  │
                                          │  └──────────┬──────────┘  │
                                          │             │             │
                                          │  ┌──────────▼──────────┐  │
                                          │  │ 公平用户队列调度器   │  │
                                          │  │ FairUserScheduler   │  │
                                          │  └──────────┬──────────┘  │
                                          │             │             │
                                          │  ┌──────────▼──────────┐  │
                                          │  │ LLM Client          │  │
                                          │  │ (OpenAI SDK 兼容)   │  │
                                          │  │                     │  │
                                          │  │  ├ Key 池管理        │  │
                                          │  │  ├ 模型降级链        │  │
                                          │  │  ├ 重试 / 退避       │  │
                                          │  │  └ Token 计量        │  │
                                          │  └──────────┬──────────┘  │
                                          └─────────────┼─────────────┘
                                                        │
                                                        ▼
                                          ┌─────────────────────────┐
                                          │  外部 LLM 中转站         │
                                          │  (OpenAI 兼容协议)       │
                                          │                         │
                                          │  Claude 3.5 Sonnet 主力 │
                                          │  Claude 3.5 Haiku 降级  │
                                          └─────────────────────────┘
```

## 2.2 模块清单

| 层 | 模块 | 技术栈 | 职责 |
|---|---|---|---|
| 前端 | Web UI | Next.js 16 + React 19 + Tailwind 4 + shadcn/ui | 页面、SSE 消费、流式渲染 |
| 前端 | Editor | TipTap v2 | 富文本编辑，章节块感知 |
| 网关 | API | FastAPI + Pydantic v2 + SQLAlchemy 2 (async) | REST/SSE、鉴权、业务编排 |
| 网关 | Auth | python-jose (JWT) + passlib (bcrypt) | 登录、Token、RBAC |
| 队列 | Broker | Redis 7 | Celery 队列存储 |
| 队列 | Worker | Celery 5 + gevent pool | 任务执行容器 |
| 业务 | Orchestrator | 自研 Python 模块 | 故事生成状态机 |
| 业务 | LLM Client | openai SDK + tenacity | 中转站调用、降级、重试 |
| 业务 | Scheduler | 自研 Redis-based | 公平用户队列 |
| 数据 | RDBMS | PostgreSQL 16 | 业务数据持久化 |
| 数据 | Cache/Queue | Redis 7 | 队列、Stream、信号量 |
| 数据 | Object Storage | （MVP 不需要） | 大文件可选，目前不用 |
| 导出 | Word | python-docx | docx 生成 |
| 监控 | Logs | structlog + 文件/stdout | 结构化日志 |
| 监控 | Metrics | （MVP 简单）/ 后续 Prometheus | 指标 |
| 部署 | Container | Docker + docker-compose | 单机编排 |

## 2.3 关键技术选型理由

### FastAPI vs Django/Flask

- **选 FastAPI**：原生 async、Pydantic 强类型、SSE 支持简单、OpenAPI 文档自动生成
- 不选 Django：太重，本项目不需要 admin/ORM/template
- 不选 Flask：需要自己拼装 async/校验/文档

### Celery + gevent pool

- **选 gevent**：本场景 90% 时间在等 LLM 流式输出（IO 密集），gevent 协程一进程能撑 50+ 并发
- 不选 prefork（默认）：太浪费内存，每任务启 8 个进程不必要
- 不选 eventlet：维护活跃度不如 gevent

### TipTap vs Lexical/CodeMirror

- **选 TipTap**：基于 ProseMirror，支持 Markdown 输入输出、自定义节点（章节块）、AI 集成现成
- 不选 Lexical：Meta 出品但生态较小，文档不够友好
- 不选 CodeMirror：偏代码编辑器，富文本不够好

### openai SDK vs LiteLLM

- **选 openai SDK**：中转站走 OpenAI 协议，原生 SDK 最稳，包括流式、超时、重试
- 不选 LiteLLM：之前提过，但既然只接一个中转站，多一层抽象反而徒增复杂度

### PostgreSQL vs MySQL

- **选 PG**：JSONB 强、未来 pgvector 免费、MVCC 友好、Python 生态默认
- MySQL 不是不行，但本项目 JSONB 用得多，PG 更顺

## 2.4 数据流（端到端时序）

### 提交任务

```
用户在前端点"提交"
  │
  ▼
POST /api/tasks/batch  (FastAPI)
  │
  ├─► 写 PostgreSQL: INSERT INTO tasks (status='queued')
  │
  ├─► celery_app.send_task('run_story', task_id)
  │     └─► Redis 队列 (按用户分片)
  │
  └─► 返回 { task_ids: [...] }
        前端立即收到响应，显示"已加入队列"
```

### Worker 执行

```
Celery Worker (常驻)
  │
  ▼
FairUserScheduler.next() → 拿到 task_id
  │
  ▼
StoryOrchestrator.run(task)
  │
  ├─► [Step 1] 大纲生成
  │     ├─ 构建 prompt
  │     ├─ openai.chat.completions.create(stream=True, key=task.user.api_key)
  │     ├─ 流式 token 同时:
  │     │    ├─ 写 PostgreSQL.tasks.outline_buffer
  │     │    └─ Redis.xadd("task:{id}:stream", token)
  │     └─ 校验 JSON, 落库 tasks.outline
  │
  ├─► [可选 Gate] 如 need_outline_review:
  │     └─ status='outline_review' → 退出 worker, 等用户操作
  │
  ├─► [Step 2] 章节循环
  │     for chapter in outline.chapters:
  │        ├─ 构建 prompt (大纲 + 前章摘要 + 当前章梗概)
  │        ├─ stream LLM
  │        ├─ 持久化 + Redis Stream 推送
  │        ├─ 检测 finish_reason==length → 自动续写
  │        └─ 写章节摘要（小调用，便宜模型）
  │
  ├─► [Step 3] 组装 + 整体校验
  │     ├─ tasks.content = 拼接所有 segments
  │     ├─ word_count 统计
  │     └─ status='review'
  │
  └─► 期间任意位置检查控制信号:
        if redis.get("task:{id}:control") == "pause":
           → 落盘当前状态, status='paused', 退出
        if signal == "cancel":
           → status='cancelled', 退出
```

### 浏览器订阅流式

```
用户打开任务详情页
  │
  ▼
GET /api/tasks/{id}/stream?since=<lastEventId>  (SSE)
  │
  ├─► 服务端先读 Redis Stream 历史: XRANGE task:xx:stream <since> +
  │     一次性补齐用户漏掉的 token
  │
  └─► 切到实时订阅: XREAD BLOCK 0 STREAMS task:xx:stream $
        持续推送新 token
        浏览器用 rAF 批量渲染
```

### 审核期编辑

```
用户在编辑器选中文字 + 输入指令
  │
  ▼
POST /api/tasks/{id}/ai-edit  (短任务，同步处理)
  │
  ├─► 直接调 LLM (不走 Celery，因为是短交互)
  │     传入: 选中文字 + 上下文 + 用户指令
  │
  ├─► 流式返回建议 (SSE)
  │
  └─► 前端展示 diff, 用户点"接受" →
        PATCH /api/tasks/{id}/segments/{segId}
          (带 version 做乐观锁)
```

## 2.5 容器拓扑（部署形态）

```
docker-compose 起 6 个服务:

  ┌───────────────────┐  ┌───────────────────┐
  │  frontend         │  │  api              │
  │  Next.js          │  │  FastAPI + uvicorn│
  │  port 3000        │  │  port 8000        │
  │  replicas: 1      │  │  replicas: 1-2    │
  └─────────┬─────────┘  └─────────┬─────────┘
            │                      │
            └──────► nginx ◄───────┘  (可选反代)
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
            ▼                     ▼                     ▼
  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
  │  worker           │  │  beat             │  │  postgres         │
  │  Celery + gevent  │  │  Celery 定时器     │  │  pg 16            │
  │  concurrency: 15  │  │  (重试/清理/巡检) │  │  port 5432        │
  │  replicas: 2      │  │  replicas: 1      │  │  volume: pgdata   │
  └─────────┬─────────┘  └─────────┬─────────┘  └───────────────────┘
            │                      │
            └──────────┬───────────┘
                       ▼
            ┌───────────────────┐
            │  redis            │
            │  redis 7          │
            │  port 6379        │
            │  volume: redisdata│
            │  config: AOF on   │
            └───────────────────┘
```

最小硬件需求：4 CPU + 8 GB 内存 + 50 GB SSD（单机部署 40 人足够）。

## 2.6 安全边界

- 内网部署，外部不直接暴露
- 如需外网访问，前置 nginx + HTTPS（自签或 Let's Encrypt）
- 所有 API 强制 JWT 鉴权（除登录、健康检查）
- 用户的 LLM API Key **加密存储**（AES-GCM，密钥在环境变量）
- 数据库连接走内网，不暴露 5432 端口
- Redis 走内网，开启 `requirepass`
- 详见 [12-deployment.md](./12-deployment.md) 安全配置章节
