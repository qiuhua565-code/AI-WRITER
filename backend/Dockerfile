FROM python:3.12-slim

WORKDIR /app

# 国内访问 deb.debian.org 常极慢或超时，构建前换成阿里云镜像（海外构建可注释本段）
RUN set -eux; \
    for f in /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list; do \
      [ -f "$f" ] && sed -i 's/deb.debian.org/mirrors.aliyun.com/g; s/security.debian.org/mirrors.aliyun.com/g' "$f" || true; \
    done

# Install build essentials for potential native deps (libffi: cryptography 等)
RUN apt-get update && apt-get install -y --no-install-recommends gcc libffi-dev && rm -rf /var/lib/apt/lists/*

# 国内 PyPI 加速（海外构建可注释）
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

# 必须先复制源码，再 editable install，否则 setuptools 找不到 app 包
COPY pyproject.toml .
COPY app/ ./app/
RUN pip install --upgrade pip setuptools wheel && pip install --no-cache-dir -e .

COPY alembic/ ./alembic/
COPY alembic.ini ./alembic.ini
COPY scripts/ ./scripts/

EXPOSE 8000
# Default command (overridden per service in docker-compose)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4", "--loop", "asyncio"]
