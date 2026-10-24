from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from change_agents.checkpoints import postgres_checkpointer
from change_agents.config import get_settings
from change_agents.intake.context import load_context
from change_agents.intake.graph import build_intake_graph
from change_agents.intake.runner import IntakeRunner
from change_agents.llm import chat_model


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # One checkpointer (connection pool) and one compiled graph for the whole process.
    with postgres_checkpointer() as checkpointer:
        graph = build_intake_graph(chat_model(get_settings().intake_model), load_context, checkpointer)
        app.state.intake = IntakeRunner(graph)
        yield


app = FastAPI(title="Site Change Agents - agents service", lifespan=lifespan)


# The agents do their work in queue workers (agents-worker). This service is for health checks and debugging.
@app.get("/intake/threads/{thread_id}")
def intake_state(thread_id: str, request: Request) -> dict[str, Any]:
    """Where an intake conversation stands, read from the checkpointer, e.g. /intake/threads/ticket-2-intake-1."""
    runner: IntakeRunner = request.app.state.intake
    try:
        return runner.result(thread_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


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
