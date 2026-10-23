from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings, read from environment variables (or a local .env file)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://change_agents:change_agents@localhost:5432/change_agents"
    redis_url: str = "redis://localhost:6379"

    # Every model is a "provider:model" string, so switching providers is a config change.
    # Examples: "google_genai:gemini-3.5-flash", "anthropic:claude-sonnet-5-5", "openai:gpt-5".
    intake_model: str = "google_genai:gemini-3.5-flash"
    coder_model: str = "google_genai:gemini-3.5-flash"
    reviewer_model: str = "google_genai:gemini-3.5-flash"
    indexer_model: str = "google_genai:gemini-3.5-flash"

    # Changing the embedding model or its dimension means re-indexing every site.
    embedding_model: str = "google_genai:gemini-embedding-001"
    embedding_dimensions: int = 1536


@lru_cache
def get_settings() -> Settings:
    return Settings()
