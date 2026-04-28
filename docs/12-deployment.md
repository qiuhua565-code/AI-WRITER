# 12 部署方案

## 12.1 部署形态总览

**目标**：内网单机自建，docker-compose 编排。

```
单台 Linux 服务器（推荐 Ubuntu 22.04 / Debian 12）
├── Docker + docker-compose
├── 6 个容器服务
│   ├── frontend       (Next.js)
│   ├── api            (FastAPI)
│   ├── worker         (Celery x2)
│   ├── beat           (Celery 定时器)
│   ├── postgres       (16)
│   └── redis          (7)
├── nginx (可选反代)
└── 备份脚本 + cron
```

**最小硬件配置：**

| 资源 | 推荐 | 最小 |
|---|---|---|
| CPU | 4 核 | 2 核 |
| 内存 | 8 GB | 4 GB |
| 磁盘 | 100 GB SSD | 50 GB |
| 网络 | 100 Mbps 出口 | 50 Mbps |

## 12.2 项目目录结构（仓库根）

```
ai-writer/
├── docs/                     ← 当前文档
├── frontend/                 ← Next.js 项目（前称 b_w588zzviay7 改造）
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── package.json
│   ├── Dockerfile
│   └── ...
├── backend/                  ← FastAPI 项目
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── core/             ← 配置、安全、日志
│   │   ├── db/               ← models、session
│   │   ├── orchestrator/
│   │   ├── scheduler/
│   │   ├── services/
│   │   ├── tasks/            ← Celery tasks
│   │   └── workers/
│   ├── migrations/           ← Alembic
│   ├── tests/
│   ├── pyproject.toml
│   ├── Dockerfile
│   └── celery_worker.py
├── deploy/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── nginx.conf            ← 反代配置（可选）
│   ├── .env.example
│   ├── backup.sh
│   └── init/
│       └── init-db.sql       ← 首次启动建表
└── README.md
```

## 12.3 docker-compose 配置

### 12.3.1 主 compose 文件

```yaml
# deploy/docker-compose.yml
version: '3.9'

x-app-env: &app-env
  DATABASE_URL: postgresql+asyncpg://aiwriter:${POSTGRES_PASSWORD}@postgres:5432/aiwriter
  REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
  CELERY_BROKER_URL: redis://:${REDIS_PASSWORD}@redis:6379/1
  CELERY_RESULT_BACKEND: redis://:${REDIS_PASSWORD}@redis:6379/2
  LLM_BASE_URL: ${LLM_BASE_URL}
  LLM_DEFAULT_MODEL_PRIMARY: ${LLM_DEFAULT_MODEL_PRIMARY:-claude-3-5-sonnet-20241022}
  LLM_DEFAULT_MODEL_FALLBACK: ${LLM_DEFAULT_MODEL_FALLBACK:-claude-3-5-haiku-20241022}
  LLM_TIMEOUT_SECONDS: ${LLM_TIMEOUT_SECONDS:-300}
  CRYPTO_MASTER_KEY: ${CRYPTO_MASTER_KEY}
  JWT_SECRET: ${JWT_SECRET}
  JWT_EXPIRE_HOURS: ${JWT_EXPIRE_HOURS:-24}
  LOG_LEVEL: ${LOG_LEVEL:-INFO}
  TZ: Asia/Shanghai

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: aiwriter
      POSTGRES_USER: aiwriter
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      TZ: Asia/Shanghai
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aiwriter"]
      interval: 10s
      timeout: 5s
      retries: 5
    # 不暴露端口到宿主机，仅内网访问
    expose:
      - 5432
  
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes --maxmemory 1gb --maxmemory-policy allkeys-lru
    volumes:
      - redisdata:/data
    expose:
      - 6379
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
  
  api:
    build:
      context: ../backend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      <<: *app-env
      ROLE: api
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
    expose:
      - 8000
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
  
  worker:
    build:
      context: ../backend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      <<: *app-env
      ROLE: worker
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: celery -A app.celery_app worker --pool=gevent --concurrency=15 --loglevel=info -Q default,stories
    deploy:
      replicas: 2
  
  beat:
    build:
      context: ../backend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      <<: *app-env
      ROLE: beat
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: celery -A app.celery_app beat --loglevel=info
  
  frontend:
    build:
      context: ../frontend
      dockerfile: Dockerfile
      args:
        BACKEND_URL: http://api:8000
    restart: unless-stopped
    environment:
      BACKEND_URL: http://api:8000
      NODE_ENV: production
      TZ: Asia/Shanghai
    expose:
      - 3000
    depends_on:
      - api
  
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - api
      - frontend

volumes:
  pgdata:
  redisdata:
```

### 12.3.2 .env 示例

```bash
# deploy/.env.example  (实际部署时复制为 .env 并填写)

# ============= 数据库 =============
POSTGRES_PASSWORD=please-change-me-strong-password

# ============= Redis =============
REDIS_PASSWORD=please-change-me-strong-password

# ============= LLM 中转站 =============
LLM_BASE_URL=https://your-aggregator.com/v1
LLM_DEFAULT_MODEL_PRIMARY=claude-3-5-sonnet-20241022
LLM_DEFAULT_MODEL_FALLBACK=claude-3-5-haiku-20241022
LLM_TIMEOUT_SECONDS=300

# 系统级监控用 key（用于 health check，可与某管理员 key 复用）
SYSTEM_HEALTH_CHECK_KEY=sk-system-health-key

# ============= 加密 =============
# 生成方法: python -c "import os; print(os.urandom(32).hex())"
CRYPTO_MASTER_KEY=64位hex字符串

# ============= JWT =============
# 生成方法: python -c "import secrets; print(secrets.token_urlsafe(64))"
JWT_SECRET=随机字符串
JWT_EXPIRE_HOURS=24

# ============= 日志 =============
LOG_LEVEL=INFO

# ============= 域名（如果用 nginx）=============
DOMAIN=storyflow.studio.local
```

### 12.3.3 backend Dockerfile

```dockerfile
# backend/Dockerfile
FROM python:3.12-slim

WORKDIR /app

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖（用 uv 加速，可选）
COPY pyproject.toml uv.lock* ./
RUN pip install --no-cache-dir -e .

# 应用代码
COPY app/ ./app/
COPY migrations/ ./migrations/
COPY alembic.ini ./

# 入口
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# CMD 由 docker-compose 覆盖
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 12.3.4 frontend Dockerfile

```dockerfile
# frontend/Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL
RUN corepack enable && pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
```

## 12.4 nginx 反代配置

```nginx
# deploy/nginx.conf
events { worker_connections 1024; }

http {
    upstream api_upstream { server api:8000; }
    upstream frontend_upstream { server frontend:3000; }
    
    # 通用配置
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # 客户端最大上传（导入标题文件等）
    client_max_body_size 10M;
    
    server {
        listen 80;
        server_name storyflow.studio.local;
        
        # ==== 关键: SSE 端点必须关闭缓冲 ====
        location ~ ^/api/v1/.*/stream {
            proxy_pass http://api_upstream;
            proxy_buffering off;                ← 关键
            proxy_cache off;
            proxy_set_header X-Accel-Buffering no;
            proxy_read_timeout 24h;             ← SSE 长连接
            proxy_send_timeout 24h;
            chunked_transfer_encoding off;
        }
        
        # API
        location /api/ {
            proxy_pass http://api_upstream;
            proxy_read_timeout 600s;
        }
        
        # 前端
        location / {
            proxy_pass http://frontend_upstream;
            proxy_read_timeout 60s;
        }
    }
    
    # HTTPS（如有证书）
    # server {
    #     listen 443 ssl http2;
    #     server_name storyflow.studio.com;
    #     ssl_certificate /etc/nginx/certs/cert.pem;
    #     ssl_certificate_key /etc/nginx/certs/key.pem;
    #     ... 同上 ...
    # }
}
```

## 12.5 首次部署步骤

```bash
# 1. 克隆代码
git clone <repo> ai-writer
cd ai-writer/deploy

# 2. 配置环境变量
cp .env.example .env
vim .env   # 填写所有 password/secret/key

# 3. 启动基础服务（先启 db/redis）
docker-compose up -d postgres redis

# 4. 等数据库就绪后跑迁移
docker-compose run --rm api alembic upgrade head

# 5. 创建首个管理员账号
docker-compose run --rm api python -m app.scripts.create_admin \
    --email admin@studio.com \
    --name "管理员" \
    --password "InitialPwd123"

# 6. 启动其余服务
docker-compose up -d

# 7. 验证
curl http://localhost/api/v1/health
# {"status":"ok","db":"ok","redis":"ok","llm":"ok"}

# 8. 浏览器访问 http://localhost 登录
```

## 12.6 升级流程

```bash
# 1. 备份
docker-compose exec postgres pg_dump -U aiwriter aiwriter | gzip > backup-$(date +%F).sql.gz

# 2. 拉新代码
git pull

# 3. 重新构建
docker-compose build api worker beat frontend

# 4. 跑迁移
docker-compose run --rm api alembic upgrade head

# 5. 滚动重启（worker 优先重启，避免任务被打断）
docker-compose up -d --no-deps --force-recreate worker
docker-compose up -d --no-deps --force-recreate api
docker-compose up -d --no-deps --force-recreate frontend

# 6. 检查
docker-compose ps
docker-compose logs -f --tail=100 api worker
```

**对运行中的任务的影响：**
- API 重启：用户在线请求会重试一次（前端有错误处理），SSE 自动重连
- Worker 重启：当前正在跑的任务会触发"协作式停止"机制（需在 worker 端实现 SIGTERM 处理）

```python
# worker 优雅停止
import signal

shutdown_event = asyncio.Event()

def handle_sigterm(*args):
    shutdown_event.set()

signal.signal(signal.SIGTERM, handle_sigterm)

# 编排引擎里定期检查
async def run(task_id):
    ...
    while not shutdown_event.is_set():
        ...
    if shutdown_event.is_set():
        # 保存当前状态为 paused，让任务下次重新拉起
        task.status = 'paused'
        await db.commit()
```

## 12.7 备份策略

### 12.7.1 数据库每日备份

```bash
# deploy/backup.sh
#!/bin/bash
set -e

BACKUP_DIR="/var/backups/ai-writer"
DATE=$(date +%F)
mkdir -p $BACKUP_DIR

# pg_dump
docker-compose exec -T postgres pg_dump -U aiwriter aiwriter | gzip > $BACKUP_DIR/db-$DATE.sql.gz

# 删除 7 天前的日备
find $BACKUP_DIR -name "db-*.sql.gz" -mtime +7 -delete

# 月度备份（每月 1 号保留一年）
if [ $(date +%d) = "01" ]; then
    cp $BACKUP_DIR/db-$DATE.sql.gz $BACKUP_DIR/monthly/db-$(date +%Y-%m).sql.gz
fi

# 删 1 年前的月备
find $BACKUP_DIR/monthly -name "db-*.sql.gz" -mtime +365 -delete
```

```bash
# 加入 cron
0 2 * * * /path/to/ai-writer/deploy/backup.sh >> /var/log/ai-writer-backup.log 2>&1
```

### 12.7.2 .env 备份

`.env` 含 `CRYPTO_MASTER_KEY`，**丢失后所有用户的 LLM key 无法解密**。务必：

- `.env` 加 `.gitignore`
- 把 `.env` 复制一份存到运维保险柜（如 1Password、Bitwarden）
- 部署机做磁盘镜像或 RAID

### 12.7.3 恢复演练

每季度演练一次：

```bash
# 在测试机上
docker-compose down -v   # 清空 volume
docker-compose up -d postgres redis
gunzip < /backup/db-2026-04-28.sql.gz | docker-compose exec -T postgres psql -U aiwriter aiwriter
docker-compose up -d
# 验证能登录、能看任务、能跑新任务
```

## 12.8 监控（v2 增强）

### 12.8.1 MVP 阶段：日志 + 文件

- 所有服务用 structlog 输出 JSON 格式日志
- docker-compose logs 直接看
- 重要错误通过钉钉/企微 webhook 推送（在 worker 内调用）

```python
# 简单告警
async def send_alert(title: str, message: str):
    if WEBHOOK_URL := os.environ.get('ALERT_WEBHOOK_URL'):
        await httpx.post(WEBHOOK_URL, json={
            "msgtype": "text",
            "text": {"content": f"[StoryFlow] {title}\n{message}"}
        })
```

### 12.8.2 v2 增强：Prometheus + Grafana + Sentry

- API/Worker 暴露 `/metrics`（FastAPI 用 `prometheus-fastapi-instrumentator`）
- 加 Grafana 看板
- Sentry 收集异常

不在 MVP 范围。详见 [13-monitoring.md](./13-monitoring.md)。

## 12.9 安全配置清单

- [ ] `.env` 文件权限 600，仅 root/部署用户可读
- [ ] PostgreSQL/Redis 不暴露宿主机端口（仅 expose 不 ports）
- [ ] PostgreSQL 强密码 + 仅内网访问
- [ ] Redis 设置 `requirepass` + 不暴露
- [ ] JWT secret 至少 64 字符随机
- [ ] CRYPTO_MASTER_KEY 32 字节随机 hex
- [ ] HTTPS（如外网可达）
- [ ] nginx 限流（防止暴力登录）
- [ ] 所有用户密码 bcrypt 加盐 hash
- [ ] 用户 LLM key AES-GCM 加密存储
- [ ] CORS 仅允许已知 origin（如 nginx 前置则同源不需要）
- [ ] 后端日志不打印密码、key 明文
- [ ] 定期更新基础镜像（nginx/postgres/redis）

## 12.10 故障排查脚本

```bash
# scripts/diagnose.sh
#!/bin/bash
echo "=== Containers ==="
docker-compose ps

echo "=== API Health ==="
curl -s http://localhost:8000/api/v1/health | jq

echo "=== Redis ==="
docker-compose exec redis redis-cli -a $REDIS_PASSWORD INFO | head -20
echo "活跃任务用户数:"
docker-compose exec redis redis-cli -a $REDIS_PASSWORD SCARD active_users

echo "=== Postgres ==="
docker-compose exec postgres psql -U aiwriter aiwriter -c "
  SELECT status, COUNT(*) FROM tasks GROUP BY status;
"

echo "=== Worker logs (最近 50 行) ==="
docker-compose logs --tail=50 worker
```
