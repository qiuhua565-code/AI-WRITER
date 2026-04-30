from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers.auth import router as auth_router
from app.routers.tasks import router as tasks_router
from app.routers.stream import router as stream_router

app = FastAPI(
    title="AI-StoryFlow API",
    version="0.1.0",
    docs_url="/docs" if settings.DEBUG else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(tasks_router)
app.include_router(stream_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
