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
    # Examples: "google_genai:gemini-3.5-flash-lite", "anthropic:claude-sonnet-5-5", "openai:gpt-5".
    # Free-tier defaults: each Gemini model has its own daily quota, so the reviewer uses a different
    # model than the coder and they don't compete for it.
    intake_model: str = "google_genai:gemini-3.5-flash-lite"
    coder_model: str = "google_genai:gemini-3.5-flash-lite"
    reviewer_model: str = "google_genai:gemini-3.1-flash-lite"
    indexer_model: str = "google_genai:gemini-3.5-flash-lite"

    # Changing the embedding model or its dimension means re-indexing every site.
    embedding_model: str = "google_genai:gemini-embedding-001"
    embedding_dimensions: int = 1536
    # Gemini's free tier counts every text in a batch as one request (100 per minute).
    embedding_texts_per_minute: int = 90

    # Free tiers allow few requests per minute; every model call waits for its turn. Each model gets its
    # own limiter: the default below, or its entry in llm_rpm_overrides (env: a JSON object).
    # Gemini free tier (Oct 2026): Flash Lite 15 per minute (500 per day), Flash 5 per minute (20 per day).
    llm_requests_per_minute: int = 12
    llm_rpm_overrides: dict[str, int] = {
        "google_genai:gemini-3.5-flash": 4,
        "google_genai:gemini-3.6-flash": 4,
        "google_genai:gemini-3.8-flash": 4,
    }

    # Folder with one checkout per site, named by site id (e.g. test-sites/luna-cafe).
    sites_repos_dir: Path = PROJECT_ROOT / "test-sites"

    # Client knowledge for RAG: brand guides, plans and past tickets, one folder per site id.
    knowledge_dir: Path = PROJECT_ROOT / "knowledge"

    # Where the Coder Agent clones a site for each ticket, and the npm cache shared by those clones.
    workspaces_dir: Path = PROJECT_ROOT / "data" / "workspaces"
    npm_cache_dir: Path = PROJECT_ROOT / "data" / "npm-cache"

    # GitHub (Phase 7). With both set, sites are cloned from and pushed to github.com/<org>/<site id>,
    # and each change becomes a pull request. Without them, everything stays in local folders.
    github_org: str = ""
    github_token: str = ""
    # Local copies of each site's main branch, kept up to date from GitHub, for indexing.
    mirrors_dir: Path = PROJECT_ROOT / "data" / "mirrors"
    # Where the deploy workflow publishes the sites (the SITES_BASE_URL variable of the site repos).
    sites_base_url: str = ""
    # The folder the web server serves the sites from. Delivery jobs download each build there:
    # <sites_dir>/<site id>/ for production and <sites_dir>/previews/<site id>/pr-<n>/ for previews.
    sites_dir: Path = PROJECT_ROOT / "data" / "sites"

    @property
    def github_enabled(self) -> bool:
        return bool(self.github_org and self.github_token)

    @field_validator("sites_repos_dir", "knowledge_dir", "workspaces_dir", "npm_cache_dir", "mirrors_dir", "sites_dir")
    @classmethod
    def _relative_to_project_root(cls, path: Path) -> Path:
        return path if path.is_absolute() else (PROJECT_ROOT / path).resolve()


@lru_cache
def get_settings() -> Settings:
    load_dotenv(PROJECT_ROOT / ".env")
    return Settings()
