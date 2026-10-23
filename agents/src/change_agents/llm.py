"""The only place that turns a "provider:model" setting into a chat model."""

from functools import lru_cache

from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel
from langchain_core.rate_limiters import InMemoryRateLimiter

from change_agents.config import get_settings


@lru_cache
def _rate_limiter() -> InMemoryRateLimiter:
    per_minute = get_settings().llm_requests_per_minute
    return InMemoryRateLimiter(requests_per_second=per_minute / 60, check_every_n_seconds=0.2, max_bucket_size=1)


def chat_model(model: str) -> BaseChatModel:
    """e.g. chat_model("google_genai:gemini-3.5-flash") or chat_model("anthropic:claude-sonnet-5-5").

    The provider's API key comes from its usual environment variable (GOOGLE_API_KEY, ANTHROPIC_API_KEY, ...).
    """
    get_settings()  # loads .env so the provider SDK finds its API key
    return init_chat_model(model, rate_limiter=_rate_limiter(), max_retries=6)
