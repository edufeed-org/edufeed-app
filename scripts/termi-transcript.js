#!/usr/bin/env node
/**
 * Reads Termi transcripts written by the dev-only sink (`TERMI_TRANSCRIPT_DIR`,
 * see src/lib/server/termi/transcript.js) and prints them as a readable log:
 * one block per request with the user's last message, the tools called (name,
 * input, how many items came back), timings and the answer.
 *
 *   node scripts/termi-transcript.js <file.jsonl | dir> [--last N] [--task lesson|ask]
 *                                    [--full] [--json]
 *
 * `--last N` keeps the newest N entries (default 20), `--task` filters,
 * `--full` prints the whole answer text instead of the first 600 chars,
 * `--json` prints the selected entries as JSON (for a fixture or a diff).
 * Reads local files only; prints what the developer typed into their own
 * dev instance.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (!args[0] || args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: node scripts/termi-transcript.js <file.jsonl | dir> [--last N] [--task lesson|ask] [--full] [--json]'
  );
  process.exit(args[0] ? 0 : 2);
}
const target = args[0];
const flag = (/** @type {string} */ name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const last = Number(flag('--last') ?? 20);
const task = flag('--task');
const full = args.includes('--full');
const asJson = args.includes('--json');

const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => /^termi-.*\.jsonl$/.test(f))
      .sort()
      .map((f) => path.join(target, f))
  : [target];

/** @type {any[]} */
let entries = [];
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* a half-written line */
    }
  }
}
if (task) entries = entries.filter((e) => e.task === task);
entries = entries.slice(-last);

if (asJson) {
  console.log(JSON.stringify(entries, null, 2));
  process.exit(0);
}

/** @param {any} m */
const textOf = (m) =>
  (Array.isArray(m?.parts) ? m.parts : [])
    .filter((/** @type {any} */ p) => p?.type === 'text')
    .map((/** @type {any} */ p) => p.text)
    .join(' ');
/** @param {string} s @param {number} n */
const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
/** @param {any} out */
const itemCount = (out) => {
  if (typeof out === 'string') return 'clipped';
  const n = out?.items?.length ?? out?.competences?.length ?? out?.curricula?.length;
  return n === undefined ? '' : `${n} items`;
};

for (const e of entries) {
  const lastUser = [...(e.messages ?? [])].reverse().find((m) => m.role === 'user');
  const phase = e.lesson?.phase ? ` · phase ${e.lesson.phase}` : '';
  console.log(
    `\n=== ${e.ts}  ${e.task}${phase}  ${e.durationMs} ms (first chunk ${e.firstChunkMs ?? '–'} ms)  ${e.finishReason ?? ''}`
  );
  if (e.materials?.length)
    console.log(
      `  materials: ${e.materials.map((/** @type {any} */ m) => `${m.name} (${m.chars})`).join(', ')}`
    );
  console.log(`  user: ${cut(textOf(lastUser) || '(none)', 300)}`);
  for (const t of e.tools ?? []) {
    const input = cut(JSON.stringify(t.input ?? {}), 160);
    const outcome = t.error ? `ERROR ${t.error}` : itemCount(t.output);
    console.log(`  tool ${t.name} @${t.at} ms ${input} → ${outcome}`);
  }
  if (e.errors?.length) console.log(`  errors: ${e.errors.join(' | ')}`);
  console.log(`  answer: ${full ? e.text : cut(e.text ?? '', 600)}`);
}
console.log(`\n${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
