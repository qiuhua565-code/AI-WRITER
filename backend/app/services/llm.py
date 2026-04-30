import asyncio
import logging
from dataclasses import dataclass
from typing import AsyncGenerator
from openai import AsyncOpenAI, RateLimitError, APIStatusError, APIConnectionError, APITimeoutError
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from app.config import settings

logger = logging.getLogger(__name__)

@dataclass
class StreamChunk:
    content: str = ""
    finish_reason: str | None = None
    model: str | None = None

@dataclass
class CompletionResult:
    content: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0

# 可重试的异常类型
RETRYABLE = (RateLimitError, APIStatusError, APIConnectionError, APITimeoutError)

class LLMClient:
    def __init__(self, base_url: str | None = None):
        self.base_url = base_url or settings.LLM_BASE_URL

    def _client(self, api_key: str) -> AsyncOpenAI:
        return AsyncOpenAI(
            api_key=api_key,
            base_url=self.base_url,
            timeout=120.0,
            max_retries=0,  # 我们自己用 tenacity 重试
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
    ) -> AsyncGenerator[StreamChunk, None]:
        """流式生成，yield StreamChunk，最后一个 chunk 含 finish_reason。"""
        primary = model or settings.LLM_DEFAULT_MODEL
        fallback = fallback_model or settings.LLM_FALLBACK_MODEL

        for attempt_model in [primary, fallback]:
            try:
                async for chunk in self._stream_once(
                    api_key=api_key,
                    messages=messages,
                    model=attempt_model,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    response_format=response_format,
                ):
                    yield chunk
                return  # 成功
            except RateLimitError as e:
                logger.warning(f"Model {attempt_model} rate limited, trying fallback. err={e}")
                if attempt_model == fallback:
                    raise
            except APIStatusError as e:
                if e.status_code >= 500:
                    logger.warning(f"Model {attempt_model} 5xx, trying fallback. status={e.status_code}")
                    if attempt_model == fallback:
                        raise
                else:
                    raise  # 4xx 不降级

    async def _stream_once(
        self,
        *,
        api_key: str,
        messages: list[dict],
        model: str,
        max_tokens: int,
        temperature: float,
        response_format: dict | None,
    ) -> AsyncGenerator[StreamChunk, None]:
        client = self._client(api_key)
        kwargs = dict(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
        )
        if response_format:
            kwargs["response_format"] = response_format

        # 用 tenacity 对单次调用做重试
        @retry(
            retry=retry_if_exception_type(RETRYABLE),
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=2, min=5, max=60),
            reraise=True,
        )
        async def _call():
            return await client.chat.completions.create(**kwargs)

        stream = await _call()
        async for event in stream:
            delta = event.choices[0].delta if event.choices else None
            if delta and delta.content:
                yield StreamChunk(content=delta.content, model=model)
            if event.choices and event.choices[0].finish_reason:
                yield StreamChunk(
                    content="",
                    finish_reason=event.choices[0].finish_reason,
                    model=model,
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
    ) -> CompletionResult:
        """非流式，等待完整响应。用于摘要、规划等短任务。"""
        use_model = model or settings.LLM_DEFAULT_MODEL
        client = self._client(api_key)
        kwargs = dict(
            model=use_model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        if response_format:
            kwargs["response_format"] = response_format

        @retry(
            retry=retry_if_exception_type(RETRYABLE),
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=2, min=5, max=60),
            reraise=True,
        )
        async def _call():
            return await client.chat.completions.create(**kwargs)

        resp = await _call()
        content = resp.choices[0].message.content or ""
        usage = resp.usage
        return CompletionResult(
            content=content,
            model=use_model,
            tokens_in=usage.prompt_tokens if usage else 0,
            tokens_out=usage.completion_tokens if usage else 0,
        )


# 全局单例
llm_client = LLMClient()
