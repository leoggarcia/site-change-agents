# Evals

Measure the agents on fixed datasets, so a prompt, schema or model change can be judged by numbers.

| File | What it is |
|---|---|
| `golden.jsonl` | 36 client requests over the three test sites, each with the expected outcome, whether the agent should ask, the values the ticket must contain, and the client's answers. 11 also have a reference ticket and checks on the built HTML, for the coder. |
| `review_cases.json` | 13 planted changes (3 good, 10 bad) for the checks and the Reviewer Agent. |
| `retrieval.jsonl` | 26 "where is…" questions for the RAG search (Phase 2.5, `rag-eval`). |
| `fixtures/intake_contexts.json` | What retrieval returned for each golden case, frozen, so the intake eval can run without the database. |
| `results/` | One JSON per run: the metrics and every case. Compare runs by their labels. |

## Running

```bash
cd agents
uv run evals/run.py intake --label my-change   # 36 cases, ~50 model calls, ~5 min (needs Postgres with the indexes)
uv run evals/run.py coder --label my-change    # 11 tickets, ~55 calls, ~6 min (needs Node 24: run `nvm use` first)
uv run evals/run.py reviewer                   # 13 planted changes, ~9 calls, ~2 min
uv run evals/run.py all                        # the three, then a summary
uv run evals/run.py intake --ci                # 12 cases on frozen contexts, no database; fails below the thresholds
uv run evals/run.py freeze                     # re-save the frozen contexts after changing the sites or the RAG
```

Options: `--only CASE ...`, `--site SITE`, `--model provider:model` (compare models), `--label NAME`.

## Metrics

**Intake:** `pass_rate` (every check of a case holds), `out_of_scope_recall` (refuses what the plan excludes)
and `out_of_scope_precision` (doesn't refuse what it includes), `asks_when_needed`, `no_needless_questions`,
`ticket_values_correct` (the exact numbers, prices and names reach the ticket), and cost per case.

**Coder:** `success_rate` (built, committed and every check on the built HTML holds), `first_build_passed`,
files changed and cost per ticket.

**Reviewer:** `bad_caught` (split into caught by the checks and by the model) and `good_approved`.

## Reading the results

Models are not deterministic: the same code can pass 32 cases one run and 33 the next, with different
cases failing. Run twice before and after a change and compare the averages; trust a change that removes a
whole kind of failure more than a one-point move.

Measured improvement (Phase 8): intake pass rate from 89% / 89% to 94% / 97%, by turning `target.page` into
an enum of the site's real pages (constrained decoding: Flash Lite used to write values like `"./"` or `"ρο"`
and repeat them through every retry) and stating in the prompt that scope comes from the plan alone.
