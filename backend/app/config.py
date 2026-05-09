from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_NAME: str = "疯狂爆单AI"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/aistoryflow"
    # FastAPI 进程连接池（多 worker 时每进程一套池；总连接 ≈ workers × (DB_POOL_SIZE + DB_MAX_OVERFLOW)）
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # LLM
    LLM_BASE_URL: str = "https://api.anthropic.com/v1"
    LLM_DEFAULT_MODEL: str = "claude-sonnet-4-6"
    LLM_FALLBACK_MODEL: str = "claude-sonnet-4-5-20251001"
    # 对话页 SSE：单次助手回复 max_tokens；过长续写可调大（受模型/中转上限约束）
    LLM_CHAT_MAX_OUTPUT_TOKENS: int = 16384
    # 单次助手气泡：最多几段流式拼接（中转单次约 4k token 触顶时自动续写）
    LLM_CHAT_MAX_SEGMENTS: int = 8
    LLM_CHAT_CONTINUE_PROMPT: str = (
        "上文可能因单次回复长度达到上限而暂停。请从上一段末尾无缝续写，不要重复已写过的段落，"
        "保持人设、语气与叙事连贯；若故事已自然结束请直接收束，勿赘述。"
    )
    # 字数控制策略（可选配置）
    # LLM_CHAT_QUALITY_FIRST: bool = False  # True=质量优先，允许字数略少
    # LLM_CHAT_WORD_COUNT_TOLERANCE: float = 0.95  # 质量优先模式下的容忍度（0.95=95%）

    # Encryption (AES-GCM for API keys)
    ENCRYPTION_KEY: str = ""  # 32-byte hex, generate with: python -c "import secrets; print(secrets.token_hex(32))"

    # Celery
    CELERY_WORKER_CONCURRENCY: int = 15


settings = Settings()
