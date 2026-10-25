"""Starts and resumes Intake conversations. Each conversation is one LangGraph thread.

The thread id is the key of the saved state. Start and resume can run in different processes,
or days apart: everything the graph needs is loaded from the checkpointer.

Both calls are safe to repeat, because queue jobs are retried after failures: a repeated call
continues from the last checkpoint instead of starting over or answering twice.
"""

from collections.abc import Callable
from typing import Any

from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from change_agents.intake.graph import initial_state

OnUpdate = Callable[[str, dict[str, Any]], None]


class NotWaitingForAnswer(Exception):
    pass


class IntakeRunner:
    def __init__(self, graph: CompiledStateGraph, on_update: OnUpdate | None = None) -> None:
        self.graph = graph
        self.on_update = on_update

    def start(self, thread_id: str, site_id: str, request: str, callbacks: list | None = None) -> dict[str, Any]:
        snapshot = self.graph.get_state(_config(thread_id))
        if not snapshot.values:
            self._run(initial_state(site_id, request), thread_id, callbacks)
        elif snapshot.next and not snapshot.interrupts:
            # A previous attempt crashed mid-way: input None means "continue from the last checkpoint".
            self._run(None, thread_id, callbacks)
        return self.result(thread_id)

    def resume(
        self, thread_id: str, answer: str, question_number: int | None = None, callbacks: list | None = None
    ) -> dict[str, Any]:
        snapshot = self.graph.get_state(_config(thread_id))
        if snapshot.interrupts:
            pending = snapshot.interrupts[0].value["number"]
            if question_number is not None and pending != question_number:
                # This answer was already used and the graph has asked something else since.
                return self.result(thread_id)
            # Command(resume=...) becomes the return value of the interrupt() call that paused the graph.
            self._run(Command(resume=answer), thread_id, callbacks)
        elif snapshot.next:
            self._run(None, thread_id, callbacks)  # the answer was taken in by an attempt that crashed afterwards
        elif not snapshot.values:
            raise NotWaitingForAnswer(f"Thread {thread_id} is not waiting for an answer.")
        return self.result(thread_id)

    def result(self, thread_id: str) -> dict[str, Any]:
        """Where the conversation stands: a pending question, or the final outcome."""
        snapshot = self.graph.get_state(_config(thread_id))
        values = snapshot.values
        if not values:
            raise KeyError(f"Unknown intake thread {thread_id}.")
        shared = {"qa": values["qa"], "usage": values["usage"]}
        if snapshot.interrupts:
            return {"status": "question", **snapshot.interrupts[0].value, **shared}
        return {**values["outcome"], **shared}

    def _run(self, graph_input: Any, thread_id: str, callbacks: list | None = None) -> None:
        config = {**_config(thread_id), "callbacks": callbacks or []}
        for update in self.graph.stream(graph_input, config, stream_mode="updates"):
            for node, output in update.items():
                if self.on_update and node != "__interrupt__":
                    self.on_update(node, output or {})


def _config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}
