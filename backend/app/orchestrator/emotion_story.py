import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.segment import Segment
from app.models.task import Task
from app.models.task_event import TaskEvent
from app.prompts import render_prompt
from app.redis_client import get_redis
from app.services.llm import LLMClient, llm_client
from app.utils.task_control import get_task_control

logger = logging.getLogger(__name__)

MAX_CONTINUATIONS = 3
BATCH_DB_TOKENS = 50  # flush to DB every N tokens


class EmotionStoryOrchestrator:
    """
    Drives the emotion-story 5-stage pipeline:
      Plan → Intro → Free → Paywall → Paid → Assemble
    """

    SEGMENTS = [
        # (index, segment_type, target_words, display_title)
        (1, "intro",    200,  "引子"),
        (2, "free",    3000,  "免费部分"),
        (3, "paywall",  120,  "卡点"),
        (4, "paid",    2000,  "付费部分"),
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

            task = await db.get(Task, self.task_id)
            if not task:
                logger.error("Task %s not found", self.task_id)
                return

            try:
                await self._run_pipeline(task, db, redis)
            except Exception as exc:
                logger.exception("Task %s fatal error", self.task_id)
                task.status = "failed"
                task.error_msg = str(exc)
                await db.commit()
                await self._push_stream(redis, {"type": "task_failed", "error": str(exc)})

    async def _run_pipeline(self, task: Task, db: AsyncSession, redis):
        api_key = await self._resolve_api_key(task, db)
        cfg = task.config or {}

        # ── Stage 1: Story Plan ──────────────────────────────────────────
        if not task.outline:
            await self._generate_plan(task, db, redis, api_key, cfg)

            if cfg.get("need_plan_review", False):
                task.status = "plan_review"
                await db.commit()
                await self._push_stream(redis, {"type": "task_status", "status": "plan_review"})
                return  # wait for user to resume via /control approve_plan

        # ── Ensure segment rows exist ────────────────────────────────────
        await self._ensure_segments(task, db)

        task.status = "writing"
        task.started_at = task.started_at or datetime.now(timezone.utc)
        await db.commit()
        await self._push_stream(redis, {"type": "task_status", "status": "writing"})

        # ── Stages 2–5: generate each segment ───────────────────────────
        for seg_index, _type, _words, _title in self.SEGMENTS:
            # Reload segment to get fresh state (handles resume after pause)
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

            # Reload task.segments so prompt builder can read earlier content
            await db.refresh(task)

            await self._write_segment(task, seg, db, redis, api_key, cfg)

            if task.status in ("cancelled", "paused", "failed"):
                return

        # ── Stage 6: Assemble ────────────────────────────────────────────
        await db.refresh(task)
        await self._assemble(task, db, redis)

    # ─────────────────────────────────────────────────────────────────────
    # Stage 1 – Plan
    # ─────────────────────────────────────────────────────────────────────

    async def _generate_plan(
        self, task: Task, db: AsyncSession, redis, api_key: str, cfg: dict
    ):
        await self._push_stream(redis, {"type": "stage", "stage": "plan"})

        system = render_prompt("emotion_story/system.j2")
        user   = render_prompt("emotion_story/plan.j2", title=task.title)
        messages: list[dict] = [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ]

        model = cfg.get("plan_model") or cfg.get("writing_model")
        plan_dict = None
        last_err: str = ""

        for attempt in range(3):
            result = await self.llm.complete(
                api_key=api_key,
                messages=messages,
                model=model,
                max_tokens=1400,
                temperature=0.75,
            )
            raw = result.content.strip()
            # Strip markdown fences if present
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
            raise RuntimeError(f"规划生成 3 次均无法解析 JSON: {last_err}")

        task.outline = plan_dict
        task.total_llm_calls += 1
        await db.commit()

        await self._push_stream(redis, {
            "type": "plan_ready",
            "content": json.dumps(plan_dict, ensure_ascii=False),
        })
        await self._log_event(db, task.id, "llm_call", {
            "stage": "plan",
            "model": result.model,
        })

    # ─────────────────────────────────────────────────────────────────────
    # Segment management helpers
    # ─────────────────────────────────────────────────────────────────────

    async def _ensure_segments(self, task: Task, db: AsyncSession):
        existing_indices = {s.index for s in task.segments}
        for seg_index, seg_type, target_words, title in self.SEGMENTS:
            if seg_index not in existing_indices:
                db.add(Segment(
                    task_id=task.id,
                    index=seg_index,
                    title=title,
                    segment_type=seg_type,
                    target_word_count=target_words,
                    status="pending",
                ))
        await db.commit()
        await db.refresh(task)

    async def _load_segment(self, db: AsyncSession, index: int) -> Segment:
        result = await db.execute(
            select(Segment).where(
                Segment.task_id == self.task_id,
                Segment.index == index,
            )
        )
        return result.scalar_one()

    # ─────────────────────────────────────────────────────────────────────
    # Stages 2-5 – Write one segment (with continuation loop)
    # ─────────────────────────────────────────────────────────────────────

    async def _write_segment(
        self,
        task: Task,
        seg: Segment,
        db: AsyncSession,
        redis,
        api_key: str,
        cfg: dict,
    ):
        while seg.status not in ("completed", "failed", "partial_failed", "cancelled"):
            is_cont = seg.status == "needs_continuation"

            if is_cont and seg.retry_count >= MAX_CONTINUATIONS:
                seg.status = "partial_failed"
                task.warning_msg = f"段落 {seg.index}（{seg.segment_type}）未达目标字数，已停止续写"
                await db.commit()
                break

            await self._stream_segment(task, seg, db, redis, api_key, cfg, is_continuation=is_cont)

            # Re-check control after each streaming pass
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

    async def _stream_segment(
        self,
        task: Task,
        seg: Segment,
        db: AsyncSession,
        redis,
        api_key: str,
        cfg: dict,
        is_continuation: bool,
    ):
        seg.status = "generating"
        seg.started_at = seg.started_at or datetime.now(timezone.utc)
        if is_continuation:
            seg.retry_count += 1
        await db.commit()

        messages = self._build_messages(task, seg, cfg, is_continuation)
        model = cfg.get("writing_model")
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

        async for chunk in self.llm.stream(
            api_key=api_key,
            messages=messages,
            model=model,
            max_tokens=self._max_tokens_for(seg.segment_type),
            temperature=temperature,
        ):
            if chunk.content:
                buf.append(chunk.content)
                buf_tokens += 1
                used_model = chunk.model or used_model

                # Real-time token push for frontend streaming
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

                    # Honour pause/cancel mid-stream
                    signal = await get_task_control(redis, self.task_id)
                    if signal in ("pause", "cancel"):
                        break

            if chunk.finish_reason:
                finish_reason = chunk.finish_reason

        # Flush remainder
        if buf:
            seg.content = (seg.content or "") + "".join(buf)
            seg.word_count = len(seg.content)

        seg.finish_reason = finish_reason
        seg.model_used = used_model
        task.total_llm_calls += 1

        # Decide next status
        threshold = seg.target_word_count * 0.7
        if finish_reason == "stop" and seg.word_count >= threshold:
            seg.status = "completed"
            seg.completed_at = datetime.now(timezone.utc)
        elif finish_reason == "length" or seg.word_count < threshold:
            seg.status = "needs_continuation"
        elif finish_reason is None:
            # Interrupted by signal
            seg.status = "needs_continuation"
        else:
            seg.status = "completed"

        await db.commit()

        await self._push_stream(redis, {
            "type": "segment_status",
            "segment_id": str(seg.id),
            "status": seg.status,
            "word_count": str(seg.word_count),
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

    def _build_messages(
        self,
        task: Task,
        seg: Segment,
        cfg: dict,
        is_continuation: bool,
    ) -> list[dict]:
        system = render_prompt("emotion_story/system.j2")
        user = self._build_user_prompt(task, seg, cfg, is_continuation)
        return [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ]

    def _build_user_prompt(
        self,
        task: Task,
        seg: Segment,
        cfg: dict,
        is_continuation: bool,
    ) -> str:
        plan = task.outline or {}
        title = task.title
        stype = seg.segment_type

        if is_continuation:
            tail = (seg.content or "")[-800:]
            remaining = max(seg.target_word_count - seg.word_count, 300)
            tpl = f"emotion_story/{stype}_continuation.j2"
            # paywall has no separate continuation template; reuse free_continuation
            if stype == "paywall":
                tpl = "emotion_story/free_continuation.j2"
            return render_prompt(
                tpl,
                title=title,
                plan=plan,
                tail_text=tail,
                current_words=seg.word_count,
                remaining_words=remaining,
            )

        if stype == "intro":
            return render_prompt("emotion_story/intro.j2", title=title, plan=plan)

        if stype == "free":
            return render_prompt(
                "emotion_story/free.j2",
                title=title,
                plan=plan,
                intro_text=self._seg_content(task, 1),
                target_words=seg.target_word_count,
            )

        if stype == "paywall":
            free_text = self._seg_content(task, 2)
            return render_prompt(
                "emotion_story/paywall.j2",
                title=title,
                plan=plan,
                intro_text=self._seg_content(task, 1),
                free_tail=(free_text or "")[-400:],
            )

        if stype == "paid":
            free_text = self._seg_content(task, 2) or ""
            return render_prompt(
                "emotion_story/paid.j2",
                title=title,
                plan=plan,
                intro_text=self._seg_content(task, 1),
                free_summary=free_text[:500] + ("…" if len(free_text) > 500 else ""),
                paywall_text=self._seg_content(task, 3),
            )

        raise ValueError(f"Unknown segment_type: {stype}")

    def _seg_content(self, task: Task, index: int) -> str:
        for s in task.segments:
            if s.index == index:
                return s.content or ""
        return ""

    def _max_tokens_for(self, stype: str) -> int:
        return {"intro": 500, "free": 6000, "paywall": 300, "paid": 4000}.get(stype, 4000)

    # ─────────────────────────────────────────────────────────────────────
    # Stage 6 – Assemble
    # ─────────────────────────────────────────────────────────────────────

    async def _assemble(self, task: Task, db: AsyncSession, redis):
        segs = sorted(task.segments, key=lambda s: s.index)

        def _content(stype: str) -> str:
            return next((s.content or "" for s in segs if s.segment_type == stype), "")

        divider = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        declaration = "本文根据真实社会事件改编，人物均已化名处理，如有雷同纯属巧合。"

        task.content = (
            f"回顾：{task.title}\n\n"
            f"[声明]\n{declaration}\n\n"
            f"{_content('intro')}\n\n"
            f"{_content('free')}\n\n"
            f"{divider}\n\n"
            f"{_content('paywall')}\n\n"
            "[付费解锁]\n\n"
            f"{divider}\n\n"
            f"{_content('paid')}"
        )

        task.word_count = sum(s.word_count or 0 for s in segs)
        task.status = "review"
        task.completed_at = datetime.now(timezone.utc)
        task.progress = 100

        target = (task.config or {}).get("target_words", 4500)
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
    # Utility helpers
    # ─────────────────────────────────────────────────────────────────────

    async def _resolve_api_key(self, task: Task, db: AsyncSession) -> str:
        result = await db.execute(
            select(Task).where(Task.id == task.id).options(selectinload(Task.user))
        )
        t = result.scalar_one()
        user = t.user
        if not user:
            raise RuntimeError("任务未关联用户")
        if not user.llm_api_key_encrypted:
            raise RuntimeError(f"用户 {user.id} 未配置 API Key，请先在设置页配置")
        from app.utils.security import decrypt_api_key
        return decrypt_api_key(user.llm_api_key_encrypted)

    async def _push_stream(self, redis, payload: dict):
        await redis.xadd(
            f"task:{self.task_id}:stream",
            {k: str(v) for k, v in payload.items()},
        )

    async def _log_event(
        self, db: AsyncSession, task_id: int, event_type: str, payload: dict
    ):
        db.add(TaskEvent(
            task_id=task_id,
            event_type=event_type,
            actor="worker",
            payload=payload,
        ))
        await db.commit()
