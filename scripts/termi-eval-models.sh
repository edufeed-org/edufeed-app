#!/usr/bin/env bash
# Model runbook for the Termi lesson assistant: re-runs the q20 lesson-eval
# family (scripts/fixtures/termi-questions.json) against several
# TERMI_LLM_MODEL candidates and prints a hit/steps/median-ms comparison.
#
# This script never starts or restarts the dev server — the OPERATOR
# restarts it with TERMI_LLM_MODEL=<model> between runs (see
# docs/guides/termi-model-evaluation.md). It only paces the eval runs and
# collects their output.
#
# Usage:
#   scripts/termi-eval-models.sh [--base <url>] [--no-pause] [--assume <requires>] <model> [<model> ...]
#
# For each <model>: unless --no-pause, pauses for Enter so the operator can
# restart the dev server with that TERMI_LLM_MODEL, then runs
# `node scripts/termi-eval-ask.js --tier2 --only <q20 family> --base <url>
# --out scratch/eval-<model>.json` (requires TERMI_EVAL_NSEC in the
# environment, same as the eval script itself; q20-b-nomem is never part of
# this pass — it needs a server started with MEM_MCP_URL=none, a different
# precondition than every other case here). When `--assume <requires>` is
# given, an extra pass runs q20-b-nomem alone against that same server
# (which the operator must actually have started with MEM_MCP_URL=none) and
# writes it to its own scratch/eval-<model>-nomem.json, kept apart from the
# model comparison table — it is a different configuration, not a sixth data
# point for the same one. After every model's main pass has a result file,
# prints the comparison table.
#
# Requires: TERMI_EVAL_NSEC set, a dev server reachable at --base.

set -euo pipefail

BASE="${TERMI_EVAL_BASE_URL:-http://localhost:5183}"
PAUSE=1
ASSUME=""
MODELS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --base)
      BASE="$2"
      shift 2
      ;;
    --no-pause)
      PAUSE=0
      shift
      ;;
    --assume)
      ASSUME="$2"
      shift 2
      ;;
    -h | --help)
      echo "Usage: $0 [--base <url>] [--no-pause] [--assume <requires>] <model> [<model> ...]"
      exit 0
      ;;
    *)
      MODELS+=("$1")
      shift
      ;;
  esac
done

if [ ${#MODELS[@]} -eq 0 ]; then
  echo "Usage: $0 [--base <url>] [--no-pause] [--assume <requires>] <model> [<model> ...]" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
mkdir -p scratch

FAMILY="q20,q20-b,q20-c,q20-d,q20-e,q20-f"
OUT_FILES=()

for MODEL in "${MODELS[@]}"; do
  if [ "$PAUSE" -eq 1 ]; then
    echo
    echo "Restart the dev server with TERMI_LLM_MODEL=${MODEL}, then press Enter to run the q20 family against ${BASE}..."
    read -r _
  fi
  OUT="scratch/eval-${MODEL}.json"
  echo "=== ${MODEL} -> ${OUT} ==="
  node scripts/termi-eval-ask.js --tier2 --only "$FAMILY" --base "$BASE" --out "$OUT"
  OUT_FILES+=("$OUT")

  if [ -n "$ASSUME" ]; then
    NOMEM_OUT="scratch/eval-${MODEL}-nomem.json"
    echo "=== ${MODEL} (q20-b-nomem, MEM off) -> ${NOMEM_OUT} ==="
    node scripts/termi-eval-ask.js --tier2 --only q20-b-nomem --base "$BASE" --out "$NOMEM_OUT" \
      --assume "$ASSUME"
  fi
done

echo
echo "=== model comparison (q20 lesson family) ==="
node -e '
const fs = require("fs");
const files = process.argv.slice(1);
const rows = files.map((f) => {
  const model = f.replace(/^scratch\/eval-/, "").replace(/\.json$/, "");
  const data = JSON.parse(fs.readFileSync(f, "utf-8"));
  const ran = data.cases.filter((c) => !c.notRun);
  const hits = ran.filter((c) => c.hit).length;
  const steps = ran.reduce((s, c) => s + (c.steps ?? 0), 0);
  const msSorted = ran.map((c) => c.ms).sort((a, b) => a - b);
  const mid = Math.floor(msSorted.length / 2);
  const medianMs = msSorted.length
    ? msSorted.length % 2
      ? msSorted[mid]
      : Math.round((msSorted[mid - 1] + msSorted[mid]) / 2)
    : 0;
  return { model, hits, ran: ran.length, steps, medianMs };
});
const w = Math.max(5, ...rows.map((r) => r.model.length));
console.log(`${"model".padEnd(w)}  hit      steps  median ms`);
for (const r of rows) {
  const hit = `${r.hits}/${r.ran}`;
  console.log(`${r.model.padEnd(w)}  ${hit.padEnd(7)}  ${String(r.steps).padStart(5)}  ${String(r.medianMs).padStart(9)}`);
}
' "${OUT_FILES[@]}"
