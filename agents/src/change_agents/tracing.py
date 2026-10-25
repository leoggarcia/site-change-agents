"""Langfuse tracing for the agents. Optional: without keys, every function here does nothing.

One trace per agent run (intake turn, coding, review). All the traces of a ticket share a session,
"ticket-<id>", so Langfuse shows a ticket's whole journey in one place. Inside a trace, the LangChain
callback records every graph node, model call (prompt, response, tokens, latency) and tool call.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

from change_agents.config import get_settings


@lru_cache
def _client():  # noqa: ANN202
    from langfuse import Langfuse

    settings = get_settings()
    return Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        base_url=settings.langfuse_base_url or settings.langfuse_host or None,
        environment=settings.langfuse_tracing_environment,
    )


@dataclass
class Trace:
    callbacks: list[BaseCallbackHandler] = field(default_factory=list)
    _span: Any = None

    def output(self, value: Any) -> None:
        """What the agent run produced, shown as the trace's output."""
        if self._span is not None:
            self._span.update(output=value)


@contextmanager
def trace(agent: str, ticket_id: int | str, site_id: str, input: Any = None) -> Iterator[Trace]:
    """Pass `trace.callbacks` in the graph's config: `{"callbacks": trace.callbacks}`."""
    if not get_settings().tracing_enabled:
        yield Trace()
        return

    from langfuse import propagate_attributes
    from langfuse.langchain import CallbackHandler

    with _client().start_as_current_observation(name=agent, as_type="agent", input=input) as span:
        with propagate_attributes(
            session_id=f"ticket-{ticket_id}",
            trace_name=f"{agent} · ticket {ticket_id}",
            tags=[agent, site_id],
            metadata={"ticket_id": str(ticket_id), "site_id": site_id},
        ):
            yield Trace([CallbackHandler(public_key=get_settings().langfuse_public_key)], span)


def flush() -> None:
    """Sends buffered traces now. The SDK batches them in the background; call this before a process exits."""
    if get_settings().tracing_enabled:
        _client().flush()
