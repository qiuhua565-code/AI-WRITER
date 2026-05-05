from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool
from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    # NullPool: 不缓存连接，每次用完立即关闭。
    # Celery 里每个任务都调用 asyncio.run()，会创建并销毁独立的事件循环；
    # 连接池里的旧连接绑定的是已关闭的循环，下一个任务复用时就会报
    # "Event loop is closed"。NullPool 让每次都建立新连接，完全规避此问题。
    poolclass=NullPool,
    echo=settings.DEBUG,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
