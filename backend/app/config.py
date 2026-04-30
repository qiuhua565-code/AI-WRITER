from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_NAME: str = "AI-StoryFlow"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/aistoryflow"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # LLM
    LLM_BASE_URL: str = "https://api.anthropic.com/v1"
    LLM_DEFAULT_MODEL: str = "claude-3-5-sonnet-20241022"
    LLM_FALLBACK_MODEL: str = "claude-3-5-haiku-20241022"

    # Encryption (AES-GCM for API keys)
    ENCRYPTION_KEY: str = ""  # 32-byte hex, generate with: python -c "import secrets; print(secrets.token_hex(32))"

    # Celery
    CELERY_WORKER_CONCURRENCY: int = 15


settings = Settings()
