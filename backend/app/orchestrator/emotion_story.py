import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.segment import Segment
from app.models.task import Task
from app.models.task_event import TaskEvent
from app.prompts import render_prompt
from app.redis_client import get_redis
from app.services.llm import LLMClient, llm_client
from app.services.key_pool import acquire_task_llm_key, release_key, key_heartbeat
from app.utils.task_control import get_task_control

logger = logging.getLogger(__name__)

MAX_CONTINUATIONS = 3
BATCH_DB_TOKENS = 50
DEFAULT_TARGET_WORDS = 18000
MIN_TARGET_WORDS = 10000
MAX_TARGET_WORDS = 25000


class EmotionStoryOrchestrator:
    """
    章节化生成 pipeline：
      Plan → Chapter 1-12 → Epilogue → Assemble
    每章独立调用 LLM，通过上章尾部 + 全局大纲保证连贯性。
    """

    SEGMENTS = [
        # (index, segment_type, target_words, display_title)
        (1,  "chapter_1",  1500, "第一章"),
        (2,  "chapter_2",  1500, "第二章"),
        (3,  "chapter_3",  1500, "第三章"),
        (4,  "chapter_4",  1800, "第四章"),
        (5,  "chapter_5",  2000, "第五章"),
        (6,  "chapter_6",  1800, "第六章"),
        (7,  "chapter_7",  1800, "第七章"),
        (8,  "chapter_8",  2000, "第八章"),
        (9,  "chapter_9",  2000, "第九章"),
        (10, "chapter_10", 2000, "第十章"),
        (11, "chapter_11", 1800, "第十一章"),
        (12, "chapter_12", 1500, "第十二章"),
        (13, "epilogue",   1000, "尾声"),
    ]

    def __init__(self, task_id: int):
        self.task_id = task_id
        self.llm: LLMClient = llm_client

    # ─────────────────────────────────────────────────────────────────────
    # Entry point
    # ─────────────────────────────────────────────────────────────────────

    async def run(self):
        async with AsyncSessionLocal() as db:
            redis = await get_redis()
            result = await db.execute(
                select(Task).where(Task.id == self.task_id).options(selectinload(Task.segments))
            )
            task = result.scalar_one_or_none()
            if not task:
                logger.error("Task %s not found", self.task_id)
                return

            uses_system_pool, key_id, api_key = await acquire_task_llm_key(redis, db, task.user_id)
            heartbeat = asyncio.create_task(key_heartbeat(redis, key_id)) if uses_system_pool and key_id is not None else None
            try:
                await self._run_pipeline(task, db, redis, api_key)
            except Exception as exc:
                # 网络/超时类错误：不标 failed，让 Celery 层 retry
                import httpx
                from anthropic import APITimeoutError, APIConnectionError
                is_retryable = isinstance(exc, (
                    httpx.ConnectTimeout,
                    httpx.ReadTimeout,
                    httpx.ConnectError,
                    httpx.RemoteProtocolError,
                    httpx.ReadError,
                    httpx.TimeoutException,
                    APITimeoutError,
                    APIConnectionError,
                    ConnectionError,
                    TimeoutError,
                ))
                if is_retryable:
                    logger.warning("Task %s retryable network error: %s", self.task_id, exc)
                    raise  # 让外层 Celery retry 处理
                # 真正的业务错误才标 failed
                logger.exception("Task %s fatal error", self.task_id)
                task.status = "failed"
                task.error_msg = str(exc)
                await db.commit()
                await self._push_stream(redis, {"type": "task_failed", "error": str(exc)})
            finally:
                if heartbeat:
                    heartbeat.cancel()
                if uses_system_pool and key_id is not None:
                    await release_key(redis, key_id)

    async def _run_pipeline(self, task: Task, db: AsyncSession, redis, api_key: str):
        if task.status in ("cancelled", "failed"):
            return

        cfg = task.config or {}

        # ── Stage 1: Plan ────────────────────────────────────────────────
        if not task.outline:
            await self._generate_plan(task, db, redis, api_key, cfg)

            if cfg.get("need_plan_review", False):
                task.status = "plan_review"
                await db.commit()
                await self._push_stream(redis, {"type": "task_status", "status": "plan_review"})
                return

        await self._ensure_segments(task, db)

        from app.utils.task_messages import is_key_queue_waiting_message

        if is_key_queue_waiting_message(task.warning_msg):
            task.warning_msg = None

        task.status = "writing"
        task.started_at = task.started_at or datetime.now(timezone.utc)
        await db.commit()
        await self._push_stream(redis, {"type": "task_status", "status": "writing"})

        # ── Stages 2–9: write each chapter ──────────────────────────────
        for seg_index, _type, _words, _title in self.SEGMENTS:
            seg = await self._load_segment(db, seg_index)
            if seg.status == "completed":
                continue

            signal = await get_task_control(redis, self.task_id)
            if signal == "cancel":
                task.status = "cancelled"
                await db.commit()
                return
            if signal == "pause":
                task.status = "paused"
                await db.commit()
                return

            await db.refresh(task, attribute_names=["segments"])
            await self._write_segment(task, seg, db, redis, api_key, cfg)

            if task.status in ("cancelled", "paused", "failed"):
                return

        # ── Assemble ─────────────────────────────────────────────────────
        await db.refresh(task, attribute_names=["segments"])
        await self._assemble(task, db, redis)

    # ─────────────────────────────────────────────────────────────────────
    # Stage 1 – Plan
    # ─────────────────────────────────────────────────────────────────────

    async def _generate_plan(self, task: Task, db: AsyncSession, redis, api_key: str, cfg: dict):
        await self._push_stream(redis, {"type": "stage", "stage": "plan"})

        system = render_prompt("emotion_story/system.j2")
        tw = self._resolve_target_words(cfg)
        user = render_prompt(
            "emotion_story/plan.j2",
            title=task.title,
            instruction_doc=(cfg.get("instruction_doc_text") or "").strip(),
            instruction_doc_filename=(cfg.get("instruction_doc_filename") or "").strip(),
            batch_prompt=(cfg.get("batch_prompt") or "").strip(),
            target_words=tw,
        )
        messages: list[dict] = [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ]

        model = cfg.get("plan_model") or cfg.get("writing_model") or settings.LLM_DEFAULT_MODEL
        plan_dict = None
        last_err: str = ""
        rate_limit_hits = 0

        from anthropic import RateLimitError
        for attempt in range(5):
            try:
                result = await self.llm.complete(
                    api_key=api_key,
                    messages=messages,
                    model=model,
                    max_tokens=8000,
                    temperature=0.75,
                )
            except RateLimitError:
                rate_limit_hits += 1
                if rate_limit_hits > 5:
                    raise
                logger.warning("Rate limit hit during plan generation, waiting 65s (hit #%d)", rate_limit_hits)
                await asyncio.sleep(65)
                continue

            raw = result.content.strip()
            if raw.startswith("```"):
                parts = raw.split("```")
                raw = parts[1].lstrip("json").strip() if len(parts) >= 2 else raw
            try:
                plan_dict = json.loads(raw)
                break
            except json.JSONDecodeError as exc:
                last_err = str(exc)
                logger.warning("Plan JSON parse failed attempt %d: %s", attempt + 1, exc)
                messages.append({"role": "assistant", "content": result.content})
                messages.append({
                    "role": "user",
                    "content": (
                        f"上述输出无法解析为合法 JSON。错误信息：{exc}\n"
                        "请重新输出完整合法 JSON，注意：\n"
                        "- 不要使用 markdown 代码块包裹\n"
                        "- 字符串内的引号需转义（用 \\\"）\n"
                        "- 不要有多余的逗号\n"
                        "- 整体必须是单个 JSON object"
                    ),
                })

        if plan_dict is None:
            err_detail = f"规划生成 5 次均无法解析 JSON: {last_err}"
            logger.error("Task %s plan generation failed: %s", self.task_id, err_detail)
            raise RuntimeError(err_detail)

        task.outline = plan_dict
        task.total_llm_calls += 1
        task.progress = 5   # 规划完成 = 5%
        await db.commit()

        await self._push_stream(redis, {
            "type": "plan_ready",
            "content": json.dumps(plan_dict, ensure_ascii=False),
        })
        await self._push_stream(redis, {"type": "progress", "progress": "5"})
        await self._log_event(db, task.id, "llm_call", {"stage": "plan", "model": result.model})

    # ─────────────────────────────────────────────────────────────────────
    # Segment management
    # ─────────────────────────────────────────────────────────────────────

    def _resolve_target_words(self, cfg: dict) -> int:
        raw = cfg.get("target_words")
        if raw is None:
            return DEFAULT_TARGET_WORDS
        try:
            n = int(raw)
        except (TypeError, ValueError):
            return DEFAULT_TARGET_WORDS
        return max(MIN_TARGET_WORDS, min(MAX_TARGET_WORDS, n))

    def _allocate_segment_word_targets(self, total: int) -> dict[int, int]:
        """按 SEGMENTS 权重将 total 拆成各章目标字数，总和严格等于 total（整数最大余额法）。"""
        weights = [s[2] for s in self.SEGMENTS]
        n = len(weights)
        wsum = sum(weights)
        raw = [total * weights[i] for i in range(n)]
        floors = [raw[i] // wsum for i in range(n)]
        remainder = total - sum(floors)
        frac_order = sorted(range(n), key=lambda i: raw[i] % wsum, reverse=True)
        for k in range(remainder):
            floors[frac_order[k]] += 1
        return {self.SEGMENTS[i][0]: floors[i] for i in range(n)}

    async def _ensure_segments(self, task: Task, db: AsyncSession):
        cfg = task.config or {}
        total = self._resolve_target_words(cfg)
        index_to_target = self._allocate_segment_word_targets(total)
        existing_indices = {s.index for s in task.segments}

        for seg in task.segments:
            new_t = index_to_target.get(seg.index)
            if new_t is not None and seg.status == "pending":
                seg.target_word_count = new_t

        for seg_index, seg_type, _base_w, title in self.SEGMENTS:
            if seg_index not in existing_indices:
                db.add(Segment(
                    task_id=task.id,
                    index=seg_index,
                    title=title,
                    segment_type=seg_type,
                    target_word_count=index_to_target[seg_index],
                    status="pending",
                ))
        await db.commit()
        await db.refresh(task, attribute_names=["segments"])

    async def _load_segment(self, db: AsyncSession, index: int) -> Segment:
        result = await db.execute(
            select(Segment).where(Segment.task_id == self.task_id, Segment.index == index)
        )
        return result.scalar_one()

    # ─────────────────────────────────────────────────────────────────────
    # Write one segment (with continuation loop)
    # ─────────────────────────────────────────────────────────────────────

    async def _write_segment(self, task: Task, seg: Segment, db: AsyncSession, redis, api_key: str, cfg: dict):
        from anthropic import RateLimitError
        rate_limit_hits = 0

        while seg.status not in ("completed", "failed", "partial_failed", "cancelled"):
            is_cont = seg.status == "needs_continuation"

            if is_cont and seg.retry_count >= MAX_CONTINUATIONS:
                seg.status = "partial_failed"
                task.warning_msg = f"{seg.title} 未达目标字数，已停止续写"
                await db.commit()
                break

            try:
                await self._stream_segment(task, seg, db, redis, api_key, cfg, is_continuation=is_cont)
            except RateLimitError:
                rate_limit_hits += 1
                if rate_limit_hits > 5:
                    raise
                wait = 65
                logger.warning("Rate limit hit for task %s segment %s, waiting %ds (hit #%d)",
                               self.task_id, seg.index, wait, rate_limit_hits)
                await self._push_stream(redis, {"type": "rate_limit_wait", "wait_seconds": str(wait)})
                await asyncio.sleep(wait)
                continue

            signal = await get_task_control(redis, self.task_id)
            if signal == "cancel":
                seg.status = "cancelled"
                task.status = "cancelled"
                await db.commit()
                return
            if signal == "pause":
                task.status = "paused"
                await db.commit()
                return

    async def _stream_segment(self, task: Task, seg: Segment, db: AsyncSession, redis, api_key: str, cfg: dict, is_continuation: bool):
        seg.status = "generating"
        seg.started_at = seg.started_at or datetime.now(timezone.utc)
        if is_continuation:
            seg.retry_count += 1
        await db.commit()

        messages = self._build_messages(task, seg, cfg, is_continuation)
        model = cfg.get("writing_model") or settings.LLM_DEFAULT_MODEL
        temperature = float(cfg.get("temperature", 0.85))

        await self._push_stream(redis, {
            "type": "stage",
            "stage": seg.segment_type,
            "segment_id": str(seg.id),
            "is_continuation": "1" if is_continuation else "0",
        })

        buf: list[str] = []
        buf_tokens = 0
        finish_reason: str | None = None
        used_model: str | None = model

        try:
            async for chunk in self.llm.stream(
                api_key=api_key,
                messages=messages,
                model=model,
                max_tokens=8000,
                temperature=temperature,
            ):
                if chunk.content:
                    buf.append(chunk.content)
                    buf_tokens += 1
                    used_model = chunk.model or used_model

                    await redis.xadd(
                        f"task:{self.task_id}:stream",
                        {"type": "token", "segment_id": str(seg.id), "content": chunk.content},
                    )

                    if buf_tokens >= BATCH_DB_TOKENS:
                        seg.content = (seg.content or "") + "".join(buf)
                        seg.word_count = len(seg.content)
                        buf = []
                        buf_tokens = 0
                        await db.commit()

                        signal = await get_task_control(redis, self.task_id)
                        if signal in ("pause", "cancel"):
                            break

                if chunk.finish_reason:
                    finish_reason = chunk.finish_reason

        except Exception as exc:
            import httpx
            is_network_err = isinstance(exc, (
                httpx.RemoteProtocolError,
                httpx.ReadError,
                httpx.ConnectError,
                httpx.TimeoutException,
            ))
            if not is_network_err:
                raise
            if buf:
                seg.content = (seg.content or "") + "".join(buf)
                seg.word_count = len(seg.content)
            seg.status = "needs_continuation"
            seg.model_used = used_model
            task.total_llm_calls += 1
            await db.commit()
            logger.warning("Stream connection dropped for task %s segment %s (%s), will retry",
                           self.task_id, seg.index, exc)
            return

        if buf:
            seg.content = (seg.content or "") + "".join(buf)
            seg.word_count = len(seg.content)

        seg.finish_reason = finish_reason
        seg.model_used = used_model
        task.total_llm_calls += 1

        threshold = seg.target_word_count * 0.7
        if finish_reason == "stop" and seg.word_count >= threshold:
            seg.status = "completed"
            seg.completed_at = datetime.now(timezone.utc)
        elif finish_reason == "length" or seg.word_count < threshold:
            seg.status = "needs_continuation"
        elif finish_reason is None:
            seg.status = "needs_continuation"
        else:
            seg.status = "completed"

        await db.commit()

        # 更新任务进度：规划占 5%，13 个 segment 各占 ~7.3%，合计 95%
        completed_count = sum(1 for s in task.segments if s.status in ("completed", "partial_failed"))
        task.progress = min(5 + round(95 / len(self.SEGMENTS) * completed_count), 99)
        await db.commit()

        await self._push_stream(redis, {
            "type": "segment_status",
            "segment_id": str(seg.id),
            "status": seg.status,
            "word_count": str(seg.word_count),
            "progress": str(task.progress),
        })
        await self._log_event(db, task.id, "llm_call", {
            "stage": seg.segment_type,
            "segment_id": seg.id,
            "model": used_model,
            "is_continuation": is_continuation,
            "finish_reason": finish_reason,
            "word_count": seg.word_count,
        })

    # ─────────────────────────────────────────────────────────────────────
    # Prompt construction
    # ─────────────────────────────────────────────────────────────────────

    def _batch_instruction_prefix(self, cfg: dict) -> str:
        blocks: list[str] = []
        doc = (cfg.get("instruction_doc_text") or "").strip()
        fn = (cfg.get("instruction_doc_filename") or "").strip()
        if doc:
            header = f"【基础指令文档】（{fn}）\n" if fn else "【基础指令文档】\n"
            blocks.append(header + doc)
        p = (cfg.get("batch_prompt") or "").strip()
        if p:
            blocks.append("【用户补充提示】\n" + p)
        tw = self._resolve_target_words(cfg)
        blocks.append(
            f"【目标总字数】全文成稿目标约 {tw} 汉字（按章节拆解生成）；"
            "若与其它说明中的字数要求冲突，以本目标为准。"
        )
        if not blocks:
            return ""
        return "\n\n".join(blocks) + "\n\n---\n\n"

    def _build_messages(self, task: Task, seg: Segment, cfg: dict, is_continuation: bool) -> list[dict]:
        system = render_prompt("emotion_story/system.j2")
        user = self._build_user_prompt(task, seg, cfg, is_continuation)
        return [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ]

    def _build_user_prompt(self, task: Task, seg: Segment, cfg: dict, is_continuation: bool) -> str:
        prefix = self._batch_instruction_prefix(cfg)
        plan = task.outline or {}
        stype = seg.segment_type

        # ── Continuation (any chapter) ────────────────────────────────
        if is_continuation:
            chapter_info = self._chapter_info(plan, seg.index)
            body = render_prompt(
                "emotion_story/chapter_continuation.j2",
                title=task.title,
                chapter_index=seg.index,
                chapter_goal=chapter_info.get("goal", ""),
                what_to_hide=chapter_info.get("what_to_hide", ""),
                tail_text=(seg.content or "")[-800:],
                current_words=seg.word_count,
                remaining_words=max(seg.target_word_count - seg.word_count, 300),
                target_words=seg.target_word_count,
            )
            return prefix + body

        # ── Chapter 1 ─────────────────────────────────────────────────
        if stype == "chapter_1":
            chapter_info = self._chapter_info(plan, 1)
            body = render_prompt(
                "emotion_story/chapter_1.j2",
                title=task.title,
                plan=plan,
                chapter=chapter_info,
                target_words=seg.target_word_count,
            )
            return prefix + body

        # ── Epilogue ──────────────────────────────────────────────────
        if stype == "epilogue":
            chapter_info = self._chapter_info(plan, seg.index)  # 动态取 plan 里对应 index（当前为 13）
            prev_tail = self._prev_chapter_tail(task, seg.index)
            body = render_prompt(
                "emotion_story/epilogue.j2",
                title=task.title,
                plan=plan,
                chapter=chapter_info,
                prev_tail=prev_tail,
                target_words=seg.target_word_count,
            )
            return prefix + body

        # ── Chapters 2-12 ────────────────────────────────────────────
        chapter_info = self._chapter_info(plan, seg.index)
        prev_tail = self._prev_chapter_tail(task, seg.index)
        body = render_prompt(
            "emotion_story/chapter.j2",
            title=task.title,
            plan=plan,
            chapter=chapter_info,
            prev_tail=prev_tail,
            target_words=seg.target_word_count,
        )
        return prefix + body

    def _chapter_info(self, plan: dict, index: int) -> dict:
        """Extract chapter plan for the given 1-based index."""
        chapters = plan.get("chapters", [])
        for ch in chapters:
            if ch.get("index") == index:
                return ch
        return {
            "index": index,
            "goal": f"继续推进第{index}章情节",
            "key_scenes": [],
            "what_to_hide": "",
            "end_hook": "",
        }

    def _prev_chapter_tail(self, task: Task, current_index: int) -> str:
        """Return the last 1000 chars of the previous chapter's content."""
        for seg in task.segments:
            if seg.index == current_index - 1:
                return (seg.content or "")[-1000:]
        return ""

    # ─────────────────────────────────────────────────────────────────────
    # Assemble
    # ─────────────────────────────────────────────────────────────────────

    async def _assemble(self, task: Task, db: AsyncSession, redis):
        await self._push_stream(redis, {"type": "stage", "stage": "assemble"})

        segs = sorted(task.segments, key=lambda s: s.index)

        chapter_titles = {
            "chapter_1":  "第一章",
            "chapter_2":  "第二章",
            "chapter_3":  "第三章",
            "chapter_4":  "第四章",
            "chapter_5":  "第五章",
            "chapter_6":  "第六章",
            "chapter_7":  "第七章",
            "chapter_8":  "第八章",
            "chapter_9":  "第九章",
            "chapter_10": "第十章",
            "chapter_11": "第十一章",
            "chapter_12": "第十二章",
            "epilogue":   "尾声",
        }

        declaration = "本文根据真实社会事件改编，人物均已化名处理，如有雷同纯属巧合。"
        parts = [f"《{task.title}》\n\n【声明】\n{declaration}\n"]

        for seg in segs:
            if not seg.content:
                continue
            title = chapter_titles.get(seg.segment_type, seg.title or "")
            parts.append(f"\n\n{'━' * 20} {title} {'━' * 20}\n\n{seg.content}")

        task.content = "".join(parts)
        task.word_count = sum(s.word_count or 0 for s in segs)
        task.status = "review"
        task.completed_at = datetime.now(timezone.utc)
        task.progress = 100

        target = self._resolve_target_words(task.config or {})
        if task.word_count < target * 0.6:
            task.warning_msg = f"字数偏少（{task.word_count} / {target}），建议审核时关注"

        await db.commit()

        await self._push_stream(redis, {
            "type": "task_status",
            "status": "review",
            "word_count": str(task.word_count),
        })
        await self._log_event(db, task.id, "status_changed", {
            "from": "writing",
            "to": "review",
            "word_count": task.word_count,
        })

    # ─────────────────────────────────────────────────────────────────────
    # Utilities
    # ─────────────────────────────────────────────────────────────────────

    STREAM_TTL = 7 * 24 * 3600   # stream key 保留 7 天后自动清理

    async def _push_stream(self, redis, payload: dict):
        stream_key = f"task:{self.task_id}:stream"
        await redis.xadd(
            stream_key,
            {k: str(v) for k, v in payload.items()},
            maxlen=2000,        # 最多保留 2000 条，防止单任务撑爆内存
            approximate=True,   # 近似裁剪，性能更好
        )
        # 每次写入都刷新 TTL，确保 stream 在最后一次写入后 7 天自动过期
        await redis.expire(stream_key, self.STREAM_TTL)

    async def _log_event(self, db: AsyncSession, task_id: int, event_type: str, payload: dict):
        db.add(TaskEvent(
            task_id=task_id,
            event_type=event_type,
            actor="worker",
            payload=payload,
        ))
        await db.commit()
