from datetime import datetime
from pydantic import BaseModel, Field


class EmotionStoryConfig(BaseModel):
    template: str = "emotion_story"
    target_words: int = Field(default=4500, ge=4000, le=5500)
    writing_model: str = "claude-3-5-sonnet-20241022"
    need_plan_review: bool = False


class BatchCreateRequest(BaseModel):
    titles: list[str] = Field(min_length=1, max_length=100)
    config: EmotionStoryConfig = EmotionStoryConfig()


class TaskControlRequest(BaseModel):
    action: str  # pause | resume | cancel | approve (approve 用于 review 状态)


class SegmentResponse(BaseModel):
    id: int
    index: int
    segment_type: str
    title: str | None
    content: str | None
    summary: str | None
    word_count: int
    target_word_count: int
    status: str
    model_config = {"from_attributes": True}


class TaskListItem(BaseModel):
    id: int
    title: str
    status: str
    word_count: int | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    config: dict
    model_config = {"from_attributes": True}


class TaskListResponse(BaseModel):
    items: list[TaskListItem]
    total: int
    page: int
    page_size: int


class TaskDetailResponse(BaseModel):
    id: int
    title: str
    status: str
    config: dict
    outline: dict | None  # 对应 Task.outline 字段（模型中实际字段名为 outline）
    content: str | None
    word_count: int | None
    error_msg: str | None
    warning_msg: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    segments: list[SegmentResponse]
    model_config = {"from_attributes": True}


class BatchCreateResponse(BaseModel):
    queued_count: int
    task_ids: list[int]
