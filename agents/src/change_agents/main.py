from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from change_agents.checkpoints import postgres_checkpointer
from change_agents.config import get_settings
from change_agents.intake.context import load_context
from change_agents.intake.graph import build_intake_graph
from change_agents.intake.runner import IntakeRunner, NotWaitingForAnswer, ticket_thread
from change_agents.llm import chat_model


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # One checkpointer (connection pool) and one compiled graph for the whole process.
    with postgres_checkpointer() as checkpointer:
        graph = build_intake_graph(chat_model(get_settings().intake_model), load_context, checkpointer)
        app.state.intake = IntakeRunner(graph)
        yield


app = FastAPI(title="Site Change Agents - agents service", lifespan=lifespan)


class StartIntake(BaseModel):
    site_id: str
    request: str = Field(min_length=1, max_length=4000)


class Answer(BaseModel):
    answer: str = Field(min_length=1, max_length=1000)


# Plain `def` endpoints: FastAPI runs them in a thread pool, so a slow model call doesn't block other requests.
# The API calls these directly in Phase 3; from Phase 4 a BullMQ worker calls the same runner.
@app.post("/intake/{ticket_id}/start")
def start_intake(ticket_id: int, body: StartIntake, request: Request) -> dict[str, Any]:
    runner: IntakeRunner = request.app.state.intake
    return runner.start(ticket_thread(ticket_id), body.site_id, body.request)


@app.post("/intake/{ticket_id}/answer")
def answer_intake(ticket_id: int, body: Answer, request: Request) -> dict[str, Any]:
    runner: IntakeRunner = request.app.state.intake
    try:
        return runner.resume(ticket_thread(ticket_id), body.answer)
    except NotWaitingForAnswer as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/intake/{ticket_id}")
def intake_state(ticket_id: int, request: Request) -> dict[str, Any]:
    """Where a ticket's intake conversation stands, read from the checkpointer. Handy for debugging."""
    runner: IntakeRunner = request.app.state.intake
    try:
        return runner.result(ticket_thread(ticket_id))
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
