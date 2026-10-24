"""The only place that turns a "provider:model" setting into a chat model."""

from functools import lru_cache

from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.rate_limiters import InMemoryRateLimiter

from change_agents.config import get_settings


@lru_cache
def _rate_limiter(model: str) -> InMemoryRateLimiter:
    """One limiter per model, shared by every agent in the process that uses that model."""
    settings = get_settings()
    per_minute = settings.llm_rpm_overrides.get(model, settings.llm_requests_per_minute)
    return InMemoryRateLimiter(requests_per_second=per_minute / 60, check_every_n_seconds=0.2, max_bucket_size=1)


def chat_model(model: str) -> BaseChatModel:
    """e.g. chat_model("google_genai:gemini-3.5-flash") or chat_model("anthropic:claude-sonnet-5-5").

    The provider's API key comes from its usual environment variable (GOOGLE_API_KEY, ANTHROPIC_API_KEY, ...).
    """
    get_settings()  # loads .env so the provider SDK finds its API key
    return init_chat_model(model, rate_limiter=_rate_limiter(model), max_retries=6)


def add_usage(usage: dict[str, int], message: AIMessage | None) -> dict[str, int]:
    """Adds one model call's token counts to a running total (kept in each agent's graph state)."""
    meta = (message.usage_metadata if message else None) or {}
    return {
        "input_tokens": usage.get("input_tokens", 0) + meta.get("input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0) + meta.get("output_tokens", 0),
        "model_calls": usage.get("model_calls", 0) + 1,
    }


def is_daily_quota_error(error: BaseException) -> bool:
    """True when the provider says the quota for the day is used up. Retrying minutes later can't help.

    Providers word this differently; these are Gemini's (quotaId "...PerDay...") and OpenAI's markers.
    """
    text = str(error)
    return ("RESOURCE_EXHAUSTED" in text and "PerDay" in text) or "insufficient_quota" in text
