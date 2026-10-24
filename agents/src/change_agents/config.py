from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings

# Local runs read the project's root .env (API keys, model names). In Docker, compose passes the same values.
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Runtime settings, read from environment variables."""

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
    # Gemini's free tier counts every text in a batch as one request (100 per minute).
    embedding_texts_per_minute: int = 90

    # Free tiers allow few requests per minute; every model call waits for its turn.
    llm_requests_per_minute: int = 5

    # Share of stub coding/review jobs that fail on purpose (0 to 1), to see retries working. Phase 4 only.
    stub_failure_rate: float = 0.0

    # Folder with one checkout per site, named by site id (e.g. test-sites/luna-cafe).
    sites_repos_dir: Path = PROJECT_ROOT / "test-sites"

    # Client knowledge for RAG: brand guides, plans and past tickets, one folder per site id.
    knowledge_dir: Path = PROJECT_ROOT / "knowledge"

    @field_validator("sites_repos_dir", "knowledge_dir")
    @classmethod
    def _relative_to_project_root(cls, path: Path) -> Path:
        return path if path.is_absolute() else (PROJECT_ROOT / path).resolve()


@lru_cache
def get_settings() -> Settings:
    load_dotenv(PROJECT_ROOT / ".env")
    return Settings()
