"""rag-eval: measures how often search finds the right file, for every chunking strategy and search mode.

recall@k: share of questions whose correct file appears in the top k results.
MRR:      mean of 1/rank of the first correct result (1.0 = always first, 0.5 = usually second).
"""

import argparse
import json
from pathlib import Path

from change_agents.rag.embeddings import get_embedder
from change_agents.rag.search import search_code

DATASET = Path(__file__).resolve().parents[3] / "evals" / "retrieval.jsonl"
STRATEGIES = ["contextual", "component", "fixed"]
MODES = ["vector", "text", "hybrid"]
KS = [1, 3, 5]
DEPTH = 10


def first_correct_rank(files: list[str], expected: list[str]) -> int | None:
    return next((rank for rank, path in enumerate(files, start=1) if path in expected), None)


def main() -> None:
    parser = argparse.ArgumentParser(description="Retrieval eval: recall@k and MRR per strategy and mode.")
    parser.add_argument("--dataset", type=Path, default=DATASET)
    args = parser.parse_args()

    cases = [json.loads(line) for line in args.dataset.read_text().splitlines() if line.strip()]
    # One batched call embeds every question once; all 9 combinations reuse the vectors.
    vectors = get_embedder().embed_queries([case["query"] for case in cases])

    print(f"{len(cases)} questions\n")
    print(f"{'strategy':11} {'mode':7} " + " ".join(f"recall@{k}" for k in KS) + "    MRR")
    misses: list[str] = []
    for strategy in STRATEGIES:
        for mode in MODES:
            ranks = []
            for case, vector in zip(cases, vectors, strict=True):
                hits = search_code(case["site"], case["query"], DEPTH, mode, strategy, query_vector=vector)
                rank = first_correct_rank([hit.file_path for hit in hits], case["expected"])
                ranks.append(rank)
                if strategy == "contextual" and mode == "hybrid" and (rank is None or rank > 3):
                    top = ", ".join(hit.file_path.removeprefix("src/") for hit in hits[:3])
                    misses.append(f'  [{case["site"]}] "{case["query"]}" -> rank {rank}; top 3: {top}')
            recalls = [sum(1 for r in ranks if r is not None and r <= k) / len(cases) for k in KS]
            mrr = sum(1 / r for r in ranks if r is not None) / len(cases)
            print(f"{strategy:11} {mode:7} " + " ".join(f"{value:8.0%}" for value in recalls) + f"   {mrr:.2f}")
        print()

    print("Questions not in the top 3 with contextual + hybrid:")
    print("\n".join(misses) if misses else "  none")
