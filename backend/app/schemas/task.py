from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class EmotionStoryConfig(BaseModel):
    template: str = "emotion_story"
    # 未传则按 18000；传了则 10000–25000（成稿总目标，章节字数按比例分配）
    target_words: Optional[int] = Field(default=None, ge=10000, le=25000)
    writing_model: str = "claude-sonnet-4-6"
    need_plan_review: bool = False
    # 从文件导入的基础指令（长模板），与短提示分开存
    instruction_doc_text: str = ""
    instruction_doc_filename: str = ""
    # 用户手写的补充提示（短）
    batch_prompt: str = ""


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
    progress: int = 0
    word_count: int | None
    total_tokens_in: int = 0
    total_tokens_out: int = 0
    total_llm_calls: int = 0
    error_msg: str | None = None
    warning_msg: str | None = None
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
    progress: int = 0
    total_tokens_in: int = 0
    total_tokens_out: int = 0
    total_llm_calls: int = 0
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


class ArticleCheckResponse(BaseModel):
    report: str
    model_used: str


class ExtractEditPatchRequest(BaseModel):
    user_message: str
    assistant_reply: str
    segment_type: str | None = None


class ExtractEditPatchResponse(BaseModel):
    old_text: str
    new_text: str
    notes: str = ""
    confidence: str = "low"
