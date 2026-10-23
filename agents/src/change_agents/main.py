from fastapi import FastAPI

from change_agents.config import get_settings

app = FastAPI(title="Site Change Agents - agents service")


@app.get("/health")
def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": "agents",
        "models": {
            "intake": settings.intake_model,
            "coder": settings.coder_model,
            "reviewer": settings.reviewer_model,
            "indexer": settings.indexer_model,
            "embedding": settings.embedding_model,
        },
    }
