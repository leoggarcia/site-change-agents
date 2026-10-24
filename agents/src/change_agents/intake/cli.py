"""Usage: intake-chat <site-id> "<request>"

Talks to the Intake Agent in the terminal, playing the client. Prints each step of the graph,
and pauses on the agent's questions exactly as the panel does.
"""

import argparse
import json
import sys
import uuid
from typing import Any

from change_agents.checkpoints import postgres_checkpointer
from change_agents.config import get_settings
from change_agents.indexer.store import site_exists
from change_agents.intake.context import load_context
from change_agents.intake.graph import build_intake_graph
from change_agents.intake.runner import IntakeRunner
from change_agents.llm import chat_model


def _print_update(node: str, output: dict[str, Any]) -> None:
    if node == "retrieve":
        print("[retrieve] project summary + client knowledge + site search loaded")
    elif node == "decide":
        if output.get("error"):
            print(f"[decide]   attempt {output['attempts']}: invalid reply, sending the error back: {output['error']}")
        else:
            decision = output["decision"]
            print(f"[decide]   action: {decision['action']}  ({decision['reasoning']})")
    elif node == "ask_client":
        print("[ask_client] answer received, resuming")


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat with the Intake Agent as a client.")
    parser.add_argument("site_id")
    parser.add_argument("request")
    args = parser.parse_args()

    settings = get_settings()
    if not site_exists(args.site_id):
        sys.exit(f'Unknown site "{args.site_id}". Seed the database first (api: npm run seed).')

    thread_id = f"cli-{uuid.uuid4().hex[:8]}"
    print(f"Intake with {settings.intake_model}, thread {thread_id}\n")
    try:
        with postgres_checkpointer() as checkpointer:
            graph = build_intake_graph(chat_model(settings.intake_model), load_context, checkpointer)
            runner = IntakeRunner(graph, on_update=_print_update)
            result = runner.start(thread_id, args.site_id, args.request)
            while result["status"] == "question":
                print(f"\nAgent (question {result['number']} of {result['max']}): {result['question']}")
                print(f"           [graph paused; its state is saved in Postgres under thread {thread_id}]")
                result = runner.resume(thread_id, input("You: "))
    except (KeyboardInterrupt, EOFError):
        sys.exit(f"\nStopped. The paused conversation stays saved as thread {thread_id}.")
    except Exception as error:  # provider errors (quota, billing, bad key) are long; show the useful part
        sys.exit(f"\nThe intake stopped: {type(error).__name__}: {error}")

    print(f"\nOutcome: {result['status']}")
    for key in ("message", "ticket", "sources"):
        if result.get(key):
            print(f"{key}: {json.dumps(result[key], indent=2, ensure_ascii=False)}")
    print(f"usage: {result['usage']}")
