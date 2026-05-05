from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers.auth import router as auth_router
from app.routers.tasks import router as tasks_router
from app.routers.stream import router as stream_router
from app.routers.admin import router as admin_router
from app.routers.admin_api_keys import router as admin_api_keys_router
from app.routers.api_keys import router as api_keys_router
from app.routers.chat import router as chat_router

app = FastAPI(
    title="AI-StoryFlow API",
    version="0.1.0",
    docs_url="/docs" if settings.DEBUG else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(tasks_router)
app.include_router(stream_router)
app.include_router(admin_router)
app.include_router(admin_api_keys_router)
app.include_router(api_keys_router)
app.include_router(chat_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
