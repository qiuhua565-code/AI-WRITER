# 04 故事生成编排引擎

这是整个项目最核心的业务逻辑。本文档详细规定 worker 内部如何把"标题"逐步变成"完整故事"，包括上下文管理、续写策略、容错降级。

## 4.1 总体生成流程

```
[输入] task: { title, genre, target_words, style?, ...config }
   │
   ▼
┌─────────────────────────────────────────────┐
│ Step 1: 生成大纲                             │
│   Input:  title + genre + target_words      │
│   Output: outline JSON (含若干章节)          │
│   Calls:  1 次 LLM                          │
└─────────────────────────────────────────────┘
   │
   ├──→ [Gate] need_outline_review = true → 暂停等待用户
   │
   ▼
┌─────────────────────────────────────────────┐
│ Step 2: 逐章生成正文                         │
│   for each chapter in outline.chapters:     │
│     - 构建上下文 (大纲+前章摘要+本章梗概)    │
│     - 调 LLM 流式生成                        │
│     - 检测截断 → 自动续写                    │
│     - 章节结尾生成 200 字摘要                │
│   Calls: ~6-15 次 LLM (取决于章数+续写)      │
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│ Step 3: 组装与校验                           │
│   - 拼接所有 segment 为 tasks.content        │
│   - 计算总字数                               │
│   - 一致性自检（可选）                       │
│   - status = 'review'                        │
└─────────────────────────────────────────────┘
```

## 4.2 编排引擎核心代码骨架

```python
# app/orchestrator/story_orchestrator.py

class StoryOrchestrator:
    def __init__(self, llm_client: LLMClient, db: AsyncSession, redis: Redis):
        self.llm = llm_client
        self.db = db
        self.redis = redis
    
    async def run(self, task_id: int):
        task = await self.db.get_task(task_id)
        
        try:
            # Step 1: 大纲
            if not task.outline:
                await self._generate_outline(task)
                
                if task.need_outline_review:
                    task.status = 'outline_review'
                    await self.db.commit()
                    return  # 等待用户操作后再次触发
            
            # Step 2: 章节
            task.status = 'writing'
            await self.db.commit()
            
            for chapter_def in task.outline['chapters']:
                if await self._check_signal(task_id):
                    return  # 暂停/取消
                
                seg = await self._get_or_create_segment(task, chapter_def)
                if seg.status == 'completed':
                    continue
                
                await self._write_chapter(task, seg)
            
            # Step 3: 组装
            await self._assemble(task)
            task.status = 'review'
            task.completed_at = datetime.utcnow()
            await self.db.commit()
            
        except RecoverableError as e:
            # 可重试错误 → 让 Celery 重试
            raise self.celery_task.retry(exc=e, countdown=backoff(e))
        except FatalError as e:
            task.status = 'failed'
            task.error_msg = str(e)
            await self.db.commit()
            await self._emit_event(task_id, 'failed', {'error': str(e)})
```

## 4.3 大纲生成（Step 1）

### 4.3.1 大纲 JSON Schema

强制约束 LLM 输出结构化 JSON，便于校验和后续使用。

```python
# pydantic 模型
class Character(BaseModel):
    name: str
    role: str           # 主角/配角/反派
    description: str    # 100 字内描述

class Chapter(BaseModel):
    index: int                  # 1-based
    title: str
    summary: str                # 200-500 字章节梗概
    key_events: list[str]       # 3-7 个关键情节点
    target_word_count: int      # 该章目标字数

class Outline(BaseModel):
    title: str
    genre: str
    target_word_count: int
    main_characters: list[Character]
    world_setting: str          # 世界观/背景设定，500 字内
    theme: str                  # 主题/核心冲突
    chapters: list[Chapter]     # 5-10 章
    
    @validator('chapters')
    def chapters_word_count_consistent(cls, v, values):
        total = sum(c.target_word_count for c in v)
        target = values.get('target_word_count', 0)
        # 允许 ±20% 偏差
        if not 0.8 * target <= total <= 1.2 * target:
            raise ValueError(f"章节字数总和 {total} 与目标 {target} 偏差过大")
        return v
```

### 4.3.2 大纲生成 Prompt

详见 [appendix/prompts.md](./appendix/prompts.md)，骨架：

```python
OUTLINE_SYSTEM_PROMPT = """你是一位经验丰富的小说编剧，擅长根据标题构建引人入胜的故事大纲。

请严格按照 JSON 格式输出，不要包含任何解释、注释或 markdown 标记。
JSON 必须能被 json.loads() 直接解析。"""

OUTLINE_USER_PROMPT_TEMPLATE = """请为以下故事创作大纲：

标题：{title}
题材：{genre}
目标字数：约 {target_words} 字
{style_section}

要求：
1. 创建 5-10 个章节，章节字数总和约等于目标字数
2. 每个章节有清晰的情节推进
3. 设计 2-5 个主要人物
4. 输出严格的 JSON 格式，符合以下 schema：

{schema_json}

直接输出 JSON，不要任何其他文字。
"""
```

### 4.3.3 调用与校验

```python
async def _generate_outline(self, task: Task):
    prompt = build_outline_prompt(task)
    
    # 调用配置：使用 JSON mode（中转站需支持）
    response_text = ""
    async for chunk in self.llm.stream(
        api_key=task.user.api_key,
        messages=prompt,
        model=task.config.get('outline_model', 'claude-3-5-sonnet-20241022'),
        response_format={"type": "json_object"},
        max_tokens=4000,
        temperature=0.8,
    ):
        response_text += chunk.content
        # 大纲生成阶段也推流式 token，前端能看到
        await self.redis.xadd(
            f"task:{task.id}:stream",
            {"type": "outline_token", "content": chunk.content}
        )
    
    # 校验 JSON
    for attempt in range(3):
        try:
            outline_dict = json.loads(response_text)
            outline = Outline.model_validate(outline_dict)
            break
        except (json.JSONDecodeError, ValidationError) as e:
            if attempt == 2:
                raise FatalError(f"大纲生成 3 次都无法解析: {e}")
            # 重试，加上"修正"指令
            prompt.append({
                "role": "user",
                "content": f"上述输出无法解析。错误：{e}\n请重新输出完整的合法 JSON。"
            })
            response_text = ""
            async for chunk in self.llm.stream(...): response_text += chunk.content
    
    task.outline = outline.model_dump()
    await self.db.commit()
    
    # 创建对应的 segments 占位
    for ch in outline.chapters:
        segment = Segment(
            task_id=task.id,
            index=ch.index,
            title=ch.title,
            target_word_count=ch.target_word_count,
            status='pending',
        )
        self.db.add(segment)
    await self.db.commit()
```

## 4.4 章节生成（Step 2）

### 4.4.1 章节 Prompt 构建

每写一章，给 LLM 的上下文是：

| 部分 | 内容 | Token 预算 |
|---|---|---|
| 系统指令 | 角色设定 + 风格指令 | ~200 |
| 大纲 | 完整 outline JSON（精简版）| ~1500 |
| 已写章节摘要 | 每章 200 字摘要 × 已写章数 | ~200 × N |
| 上一章末尾 | 最后 500 字（衔接文风） | ~500 |
| 当前章任务 | 章节标题 + 梗概 + 关键事件 + 目标字数 | ~500 |
| **合计输入** | | **~3000-5000** |
| 期望输出 | 当前章正文（约 2500 字 ≈ 4000 tokens）| ~4000 |

### 4.4.2 Prompt 模板

```python
CHAPTER_SYSTEM_PROMPT = """你是一位经验丰富的小说作家，正在按章节创作一部完整的故事。

要求：
1. 严格按章节梗概和关键事件展开
2. 与之前章节的风格、人物、情节保持一致
3. 不要重复之前章节的内容
4. 不要在结尾写"未完待续"或类似总结性收尾词，自然停止即可
5. 不要使用 markdown 标题（# 等），章节标题已在外部添加
6. 直接输出正文，不要解释、不要前言、不要省略号"""


CHAPTER_USER_PROMPT_TEMPLATE = """## 故事大纲（参考）

标题：{title}
题材：{genre}
世界观：{world_setting}
主要人物：
{characters_brief}

完整章节列表：
{all_chapters_brief}

## 已写章节摘要

{previous_summaries}

## 上一章结尾片段（保持文风衔接）

{last_chapter_tail}

## 当前任务

请创作【第 {index} 章 {title}】

章节梗概：{summary}

关键事件：
{key_events_bullet}

目标字数：约 {target_words} 字

请直接输出本章正文：
"""
```

特殊情况：
- **第 1 章**：没有"已写摘要"和"上一章结尾"，prompt 中省略对应段落
- **续写场景**：用单独的 `CONTINUATION_PROMPT`（见下文 4.5）

### 4.4.3 流式调用与持久化

```python
async def _write_chapter(self, task: Task, seg: Segment):
    seg.status = 'generating'
    seg.started_at = datetime.utcnow()
    await self.db.commit()
    
    prompt = build_chapter_prompt(task, seg)
    
    accumulated_buffer = []
    token_count_in_batch = 0
    BATCH_SIZE = 50  # 每 50 token 落库一次
    
    async for chunk in self.llm.stream(
        api_key=task.user.api_key,
        messages=prompt,
        model=task.config.get('writing_model', 'claude-3-5-sonnet-20241022'),
        max_tokens=8000,
        temperature=task.config.get('temperature', 0.85),
    ):
        if chunk.content:
            accumulated_buffer.append(chunk.content)
            token_count_in_batch += 1
            
            # 实时推送到 Redis Stream（每个 token 都推，前端要流畅）
            await self.redis.xadd(
                f"task:{task.id}:stream",
                {"type": "token", "segment_id": str(seg.id), "content": chunk.content}
            )
            
            # 批量落库（不要每个 token 写一次 PG）
            if token_count_in_batch >= BATCH_SIZE:
                seg.content = (seg.content or "") + "".join(accumulated_buffer)
                seg.word_count = len(seg.content)
                accumulated_buffer = []
                token_count_in_batch = 0
                await self.db.commit()
                
                # 顺便检查控制信号
                signal = await self._check_signal(task.id)
                if signal == 'pause':
                    seg.status = 'needs_continuation'  # 视为可续写状态
                    task.status = 'paused'
                    await self.db.commit()
                    return
                elif signal == 'cancel':
                    seg.status = 'cancelled'
                    task.status = 'cancelled'
                    await self.db.commit()
                    return
        
        if chunk.finish_reason:
            # 落最后一批
            if accumulated_buffer:
                seg.content = (seg.content or "") + "".join(accumulated_buffer)
                seg.word_count = len(seg.content)
            
            seg.finish_reason = chunk.finish_reason
            seg.tokens_used = chunk.usage.total_tokens if chunk.usage else None
            seg.model_used = chunk.model
            
            if chunk.finish_reason == 'stop' and seg.word_count >= seg.target_word_count * 0.8:
                seg.status = 'completed'
                seg.completed_at = datetime.utcnow()
                # 生成本章摘要（异步小调用，便宜模型）
                await self._generate_chapter_summary(seg)
            elif chunk.finish_reason == 'length':
                seg.status = 'needs_continuation'
            else:
                seg.status = 'failed'
                raise RecoverableError(f"章节生成异常 finish_reason={chunk.finish_reason}")
            
            await self.db.commit()
            
            # 推送章节状态变化事件
            await self.redis.xadd(
                f"task:{task.id}:stream",
                {"type": "segment_status", "segment_id": str(seg.id), "status": seg.status}
            )
```

## 4.5 续写控制（Step 2 内部循环）

### 4.5.1 何时续写

- LLM 返回 `finish_reason='length'`（达到 max_tokens 上限）
- 字数未达到本章目标的 80%
- 重试次数 < 上限（默认 5 次）

```python
async def _write_chapter(self, task: Task, seg: Segment):
    while seg.status not in ('completed', 'failed', 'partial_failed', 'cancelled'):
        if seg.status == 'pending':
            await self._initial_write(task, seg)        # 上文 4.4.3
        elif seg.status == 'needs_continuation':
            await self._continue_write(task, seg)       # 下文 4.5.2
        
        if seg.retry_count >= MAX_CONTINUATIONS:
            seg.status = 'partial_failed'
            await self.db.commit()
            break
```

### 4.5.2 续写 Prompt

```python
CONTINUATION_USER_PROMPT_TEMPLATE = """你之前正在创作【第 {index} 章 {title}】。

章节梗概：{summary}
关键事件：{key_events_bullet}
本章目标字数：约 {target_words} 字（已写 {current_words} 字，还需约 {remaining} 字）

【已写部分的最后片段】
{tail_text}

请直接从上一句之后无缝接着写正文，要求：
1. 不要重复已有内容
2. 保持文风、人物、视角、语气一致
3. 推进剧情，覆盖剩余的关键事件
4. 写满约 {remaining} 字后自然收尾本章

直接续写正文：
"""

async def _continue_write(self, task: Task, seg: Segment):
    seg.retry_count += 1
    
    tail_text = (seg.content or "")[-800:]  # 取末尾 800 字
    remaining = max(seg.target_word_count - seg.word_count, 500)
    
    prompt = build_continuation_prompt(
        task, seg, 
        tail_text=tail_text, 
        remaining=remaining,
    )
    
    # 流式调用同 4.4.3（追加到 seg.content）
    async for chunk in self.llm.stream(...):
        ...
```

### 4.5.3 续写的"接缝"问题

**问题**：续写时 LLM 可能重复一句已写过的话。

**缓解措施**：

1. Prompt 明确要求"不要重复已有内容"
2. 在 prompt 中只给最后 800 字而不是全文（避免误解为"全部重写"）
3. 后处理：续写完成后，检测前 200 字是否与原文末 200 字有大段重复（编辑距离），若有自动修剪

```python
def smooth_continuation(original_tail: str, new_text: str) -> str:
    """检测并修剪续写开头的重复内容"""
    # 简单实现：在 new_text 开头滑动窗口找与 original_tail 末尾的最长公共子串
    for window in range(min(200, len(new_text)), 20, -10):
        prefix = new_text[:window]
        if prefix in original_tail[-300:]:
            return new_text[window:]  # 截掉重复部分
    return new_text
```

## 4.6 章节摘要生成

每章写完后立即生成 200 字摘要，存入 `segment.summary`。后续章节生成时作为上下文。

```python
SUMMARY_PROMPT = """请用 200 字以内总结以下小说章节的关键情节、人物动作、结局状态。
要求精炼，不评论，不重复原文措辞。

【章节内容】
{chapter_content}

【200字摘要】"""

async def _generate_chapter_summary(self, seg: Segment):
    response = await self.llm.complete(  # 非流式，等结果
        api_key=seg.task.user.api_key,
        messages=[
            {"role": "user", "content": SUMMARY_PROMPT.format(chapter_content=seg.content)}
        ],
        model='claude-3-5-haiku-20241022',  # 便宜模型
        max_tokens=300,
        temperature=0.3,
    )
    seg.summary = response.content.strip()
    await self.db.commit()
```

## 4.7 容错与降级

### 4.7.1 错误分类与处理

| 错误类型 | 检测 | 处理 |
|---|---|---|
| 网络超时 | `TimeoutError` / connection error | 退避重试 3 次 |
| 限流 (429) | HTTP 429 / `RateLimitError` | 等 60s 重试，3 次后报警 |
| 5xx 中转站异常 | HTTP 5xx | 同上 |
| Key 无效 (401) | `AuthenticationError` | 立即失败，提示用户更新 key |
| 内容审核 (`content_filter`) | `finish_reason='content_filter'` | 标记 segment failed，跳过该章 |
| JSON 解析失败 | `json.JSONDecodeError` | 重试，prompt 加修正指令 |
| 输出过短 | `word_count < target * 0.5` 且非续写 | 当作 `needs_continuation` |
| 上下文超限 (`context_length_exceeded`) | 错误码 | 不可重试，编排 bug，标记 fatal |

### 4.7.2 模型降级链

```yaml
# 配置
model_chain:
  outline:
    primary:    claude-3-5-sonnet-20241022
    fallback:   claude-3-5-haiku-20241022
  writing:
    primary:    claude-3-5-sonnet-20241022
    fallback:   claude-3-5-haiku-20241022
  summary:
    primary:    claude-3-5-haiku-20241022
    fallback:   claude-3-5-haiku-20241022   # 摘要任务简单，不再降级
```

```python
async def _call_with_fallback(self, *, task_phase: str, **kwargs):
    chain = self.config.model_chain[task_phase]
    
    for model_name in [chain.primary, chain.fallback]:
        try:
            return await self.llm.stream(model=model_name, **kwargs)
        except (RateLimitError, ServerError) as e:
            logger.warning(f"{model_name} failed: {e}, falling back...")
            continue
    
    raise FatalError(f"所有模型均失败")
```

降级触发后**记录在 `task_events`**，前端可见"曾使用降级模型"。

### 4.7.3 重试策略

```python
# Celery 任务装饰器
@celery_app.task(
    bind=True,
    autoretry_for=(RecoverableError,),
    retry_backoff=10,           # 10s 起步
    retry_backoff_max=600,      # 最多 10 分钟
    retry_jitter=True,           # 加随机抖动避免雪崩
    max_retries=3,
)
def run_story(self, task_id: int):
    asyncio.run(StoryOrchestrator(...).run(task_id))
```

## 4.8 最终组装

```python
async def _assemble(self, task: Task):
    segments = await self.db.get_segments_ordered(task.id)
    
    # 拼接 markdown
    parts = []
    for seg in segments:
        parts.append(f"## 第{seg.index}章 {seg.title}\n\n{seg.content}\n")
    
    task.content = "\n".join(parts)
    task.word_count = sum(s.word_count or 0 for s in segments)
    
    # 简单的最终校验
    if task.word_count < task.config['target_words'] * 0.6:
        task.warning_msg = "字数偏少，建议审核时关注"
    
    # 检查是否有 partial_failed 段落
    failed_segs = [s for s in segments if s.status == 'partial_failed']
    if failed_segs:
        task.warning_msg = f"第 {[s.index for s in failed_segs]} 章生成不完整"
    
    await self.db.commit()
```

## 4.9 配置项汇总

`tasks.config` JSONB 字段示例：

```json
{
  "target_words": 12000,
  "genre": "玄幻",
  "style": "古风武侠，文笔典雅",
  "temperature": 0.85,
  "outline_model": "claude-3-5-sonnet-20241022",
  "writing_model": "claude-3-5-sonnet-20241022",
  "summary_model": "claude-3-5-haiku-20241022",
  "max_continuations_per_chapter": 5,
  "need_outline_review": false,
  "auto_consistency_check": false
}
```

---

## 4.10 情感故事模板（emotion_story）

工作室当前主要生产"情感故事/社会事件叙事"类内容，与通用小说结构不同，由 `tasks.config.template = "emotion_story"` 触发独立编排逻辑。

### 4.10.1 与通用小说的核心差异

| 维度 | 通用小说（默认）| 情感故事（emotion_story）|
|---|---|---|
| 生成结构 | 大纲 → N 章（5-10章）| 规划 → 引子 → 免费部分 → 卡点 → 付费部分（固定4段）|
| 总字数 | 1-3 万字 | 4000-5000 字 |
| 目标读者 | 通用 | 40 岁以上，偏好猎奇刺激 |
| 内容性质 | 纯虚构 | 真实事件小说化改编 |
| 输出格式 | 章节 markdown | 标题 + 声明 + 4 个固定分区 |
| 付费分割 | 无 | 有明确的卡点（付费墙）|
| 大纲审核 | 可选（need_outline_review）| 可选（need_plan_review）|

### 4.10.2 情感故事生成流程

```
[输入] task: { title, material?, template="emotion_story", ...config }
   │
   ▼
┌─────────────────────────────────────────┐
│ Step 1: 故事规划                         │
│   Input:  title + material(可选)        │
│   Output: plan JSON                     │
│           { story_type, core_conflict,  │
│             key_characters,             │
│             event_timeline,             │
│             dramatic_scene,             │
│             free_part_beats,            │
│             paywall_hook,               │
│             paid_part_revelation }      │
│   Calls:  1 次 LLM                      │
└─────────────────────────────────────────┘
   │
   ├──→ [Gate] need_plan_review = true → 暂停，用户确认/修改规划
   │
   ▼
┌─────────────────────────────────────────┐
│ Step 2: 生成引子（segment index=1）      │
│   约 200 字，以最戏剧性场景开篇          │
│   Calls: 1 次 LLM                       │
└─────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────┐
│ Step 3: 生成免费部分（segment index=2） │
│   约 3000 字，分段编号，结尾留悬念       │
│   可能触发续写（finish_reason='length'）│
│   Calls: 1-3 次 LLM                     │
└─────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────┐
│ Step 4: 生成卡点（segment index=3）     │
│   约 120 字，付费分割点                  │
│   Calls: 1 次 LLM                       │
└─────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────┐
│ Step 5: 生成付费部分（segment index=4） │
│   约 2000 字，揭示真相和隐藏细节         │
│   可能触发续写                           │
│   Calls: 1-2 次 LLM                     │
└─────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────┐
│ Step 6: 组装                            │
│   按"回顾：标题 + 声明 + 4段"格式拼接  │
│   status = 'review'                     │
└─────────────────────────────────────────┘
```

### 4.10.3 编排器入口判断

```python
async def run(self, task_id: int):
    task = await self.db.get_task(task_id)
    
    template = task.config.get('template', 'fiction')
    
    if template == 'emotion_story':
        await EmotionStoryOrchestrator(self.llm, self.db, self.redis).run(task)
    else:
        await FictionOrchestrator(self.llm, self.db, self.redis).run(task)
```

`EmotionStoryOrchestrator` 与 `FictionOrchestrator` 共享：
- LLM Client（含重试、降级、Key 管理）
- Redis Stream 推送逻辑
- 控制信号检查（pause/cancel）
- 事件记录（task_events）

差异仅在 prompt 选取和 segments 结构。

### 4.10.4 情感故事 Segment 结构

| index | segment_type | 目标字数 | 说明 |
|---|---|---|---|
| 1 | `intro` | 200 | 引子 |
| 2 | `free` | 3000 | 免费部分 |
| 3 | `paywall` | 120 | 卡点 |
| 4 | `paid` | 2000 | 付费部分 |

`segment_type` 字段需在 `segments` 表中新增（见 09-data-model.md 备注）。

### 4.10.5 Prompt 详情

见 [附录 A.10](./appendix/prompts.md#a10-情感故事模板emotion_story)。

部分字段可由用户在批量提交页选择，部分使用系统默认。详见 [appendix/config.md](./appendix/config.md)。
