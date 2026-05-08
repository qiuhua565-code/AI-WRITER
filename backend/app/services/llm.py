import logging
from dataclasses import dataclass
from typing import AsyncGenerator

import anthropic
import httpx
from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class StreamChunk:
    content: str = ""
    finish_reason: str | None = None
    model: str | None = None
    usage_input_tokens: int | None = None
    usage_output_tokens: int | None = None


@dataclass
class CompletionResult:
    content: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0


def _split_messages(messages: list[dict]) -> tuple[str | None, list[dict]]:
    """Extract system message from messages list (Anthropic requires it as separate param)."""
    system = None
    rest = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            rest.append(m)
    return system, rest


# Streaming：长文多轮续写时静默时间可能较长；读超时放宽，避免 ~5min 内被切断。
# Non-streaming complete(): full response can take >60s on proxy; use 300s.
_STREAM_TIMEOUT = httpx.Timeout(connect=30.0, read=300.0, write=60.0, pool=30.0)
_COMPLETE_TIMEOUT = httpx.Timeout(connect=60.0, read=300.0, write=60.0, pool=60.0)


class LLMClient:
    def __init__(self, base_url: str | None = None):
        self.base_url = base_url or settings.LLM_BASE_URL

    def _client(self, api_key: str, timeout: httpx.Timeout = _STREAM_TIMEOUT) -> anthropic.AsyncAnthropic:
        # trust_env=False：禁止 httpx 读取系统 HTTP_PROXY/HTTPS_PROXY 环境变量，
        # 避免请求被意外转发到系统代理而无法连接中转站。
        logger.warning(
            "🔑 LLM Client Config | base_url=%s | api_key=%s...%s",
            self.base_url,
            api_key[:12] if len(api_key) > 12 else api_key[:4],
            api_key[-6:] if len(api_key) > 12 else ""
        )
        http_client = httpx.AsyncClient(timeout=timeout, trust_env=False)
        return anthropic.AsyncAnthropic(
            api_key=api_key,
            base_url=self.base_url,
            http_client=http_client,
        )

    async def stream(
        self,
        *,
        api_key: str,
        messages: list[dict],
        model: str | None = None,
        fallback_model: str | None = None,
        max_tokens: int = 8000,
        temperature: float = 0.85,
        response_format: dict | None = None,
        request_tag: str | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        use_model = model or settings.LLM_DEFAULT_MODEL
        logger.warning(
            "📤 LLM Stream Request | model=%s | max_tokens=%d | temp=%.2f | msg_count=%d | tag=%s",
            use_model, max_tokens, temperature, len(messages), request_tag or "-",
        )
        system, chat_messages = _split_messages(messages)

        # 按需打印 messages 摘要（每条 role + 前 200 字），便于排查
        # 「LLM 不按用户标题写 / 多次输出几乎一致」之类问题——日志里能直接核对
        # 实际送到 LLM 的 prompt 是否每次都不同。
        if logger.isEnabledFor(logging.INFO):
            for idx, m in enumerate(chat_messages):
                content = m.get("content", "")
                preview = ""
                if isinstance(content, str):
                    preview = content
                elif isinstance(content, list):
                    for blk in content:
                        if isinstance(blk, dict) and blk.get("type") == "text":
                            preview = blk.get("text", "")
                            break
                preview = (preview or "").replace("\n", " ")[:200]
                logger.info(
                    "📨 LLM msg[%d] role=%s len=%d preview=%s",
                    idx, m.get("role"), len(preview), preview,
                )
            if system:
                sys_preview = system.replace("\n", " ")[:200] if isinstance(system, str) else str(system)[:200]
                logger.info("📨 LLM system len=%d preview=%s", len(system) if isinstance(system, str) else 0, sys_preview)

        client = self._client(api_key, _STREAM_TIMEOUT)

        kwargs = dict(
            model=use_model,
            messages=chat_messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        if system:
            kwargs["system"] = system

        # 给 Anthropic 透传 metadata，让中转站/上游看到的 user_id 每次都不同，
        # 防止只按 messages 哈希做 prompt-cache 的中转站把不同会话当成同一请求复用旧响应。
        if request_tag:
            kwargs["metadata"] = {"user_id": request_tag}

        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield StreamChunk(content=text, model=use_model)
            final = await stream.get_final_message()
            ut = final.usage
            yield StreamChunk(
                content="",
                finish_reason=final.stop_reason,
                model=use_model,
                usage_input_tokens=ut.input_tokens if ut else None,
                usage_output_tokens=ut.output_tokens if ut else None,
            )

    async def complete(
        self,
        *,
        api_key: str,
        messages: list[dict],
        model: str | None = None,
        max_tokens: int = 2000,
        temperature: float = 0.3,
        response_format: dict | None = None,
        read_timeout: float | None = None,
    ) -> CompletionResult:
        use_model = model or settings.LLM_DEFAULT_MODEL
        logger.info(
            "📤 LLM Complete Request | model=%s | max_tokens=%d | temp=%.2f | msg_count=%d",
            use_model, max_tokens, temperature, len(messages)
        )
        system, chat_messages = _split_messages(messages)
        timeout = (
            httpx.Timeout(connect=60.0, read=read_timeout, write=120.0, pool=60.0)
            if read_timeout is not None
            else _COMPLETE_TIMEOUT
        )
        client = self._client(api_key, timeout)

        kwargs = dict(
            model=use_model,
            messages=chat_messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        if system:
            kwargs["system"] = system

        resp = await client.messages.create(**kwargs)
        content = resp.content[0].text if resp.content else ""
        return CompletionResult(
            content=content,
            model=use_model,
            tokens_in=resp.usage.input_tokens,
            tokens_out=resp.usage.output_tokens,
        )


llm_client = LLMClient()
