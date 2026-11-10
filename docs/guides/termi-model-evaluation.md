# Evaluating SAIA models for Termi's lesson assistant

Termi's `lesson` task (the Unterrichtsreihen planner, `docs/superpowers/specs/2026-11-10-termi-lesson-series-design.md`) is the harder of its two tasks: it must ask before searching, cite competences only from MEM, write mandatory differentiation into every lesson, and keep its German natural and age-appropriate. The default model stays `glm-5.3` (TERMI_LLM_MODEL) until a candidate shows a clear win on this family — see "Model" in the spec.

## The eval family

`scripts/fixtures/termi-questions.json` carries the `q20` family: seven fixtures (`q20`, `q20-b`, `q20-b-nomem`, `q20-c`, `q20-d`, `q20-e`, `q20-f`) that each send `task: 'lesson'` plus, from `q20-c` onward, a `lesson` phase state (phase 2 through 6) straight to `/api/termi/chat` — one turn per phase, not a live multi-turn conversation. `q20-b-nomem` additionally sets `requires: 'MEM_MCP_URL=none'`: it only runs when you pass `--assume 'MEM_MCP_URL=none'` to a server actually started that way, otherwise it is skipped (`notRun`, reason `requires`).

Run just this family against a running dev server:

```bash
TERMI_EVAL_NSEC=<an eligible test nsec> \
  node scripts/termi-eval-ask.js --tier2 --base http://localhost:5183 \
  --only q20,q20-b,q20-b-nomem,q20-c,q20-d,q20-e,q20-f --out scratch/eval-lesson.json
```

(`--tier2` is required: every fixture in this family is `tier2Only`, and tier 1 has no concept of the `lesson` task.) The tier 2 summary prints a `family q20: N steps total` line — the whole family's step budget as a whole, in addition to each case's own `maxSteps`/`maxMs`.

## Comparing several models

`scripts/termi-eval-models.sh` loops this family over a list of `TERMI_LLM_MODEL` candidates. It never starts or restarts the dev server — restart it yourself between models:

```bash
TERMI_EVAL_NSEC=<nsec> scripts/termi-eval-models.sh \
  --base http://localhost:5183 \
  glm-5.3 glm-5.3-flash qwen-3.6 qwen-3.8 gemma-4 mistral-large-4 eurollm
```

For each model it prints a prompt and waits for Enter (pass `--no-pause` to skip the wait, e.g. when the server is already looping through models itself); meanwhile you restart the dev server with `TERMI_LLM_MODEL=<model>` set, then press Enter to run the family against `--base`. Each run's cases land in `scratch/eval-<model>.json` (gitignored), and once every model has a result file the script prints a hit/steps/median-ms comparison table.

`--assume <requires>` forwards to the eval so `q20-b-nomem` runs too, for one pass against a server started with `MEM_MCP_URL=none`.

## The human rubric

A hit rate and a step count catch regressions, not writing quality. For each model, read at least three transcripts (`answer` field in the JSON, `q20-c`/`q20-d`/`q20-f` are the most informative) and judge against the four rules from the spec's "Model" section:

1. **Asks before searching.** Phase 1 (`q20`) must ask for the missing frame, never guess class/grade/duration.
2. **Competences only from MEM.** No competence label or URI should appear that the tool output didn't provide; when MEM returns nothing (`q20-b-nomem`), the model must say so and ask for learning goals instead of inventing one.
3. **Differentiation in every lesson.** Each elaborated lesson (`q20-d`) names at least one differentiation measure per phase (Niveaustufen, Hilfekarten, Legematerial, Sprachhilfen, …), not just once for the whole series.
4. **German quality.** Natural du-form German, age-appropriate wording in `summary`/`module` parts, no stray English or robotic phrasing.

Only switch the default model on a clear win across hit rate, step count and this rubric together — a model that is faster but drifts on rule 2 or 3 is not a win. The task table (`TERMI_TASKS` in `src/lib/server/termi/tasks.js`) can carry a per-task model later if one model turns out better at planning and another at search; that split is not implemented yet.

## Where results go

Evaluation reports for the SAIA model comparisons live in laoc's own KI-NOPE research notes (`~/coding/edufeed/research/ki-nope/`), not in this repo — this guide only covers how to produce the raw numbers.
