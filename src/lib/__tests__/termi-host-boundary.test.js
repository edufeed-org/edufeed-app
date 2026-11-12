/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const LIB = path.resolve(__dirname, '..');
const HOST_FREE = ['termi/', 'server/termi/', 'components/assistant/'];

// Every non-test file under termi/ plus files that are host-free today.
// Left out: nothing at the moment; add a file here only after checking its imports.
const PINNED = [
  'components/assistant/cards/links.js',
  'components/assistant/cards/quote.js',
  'components/assistant/history/conversation-codec.js',
  'components/assistant/termi-chat.svelte.js',
  'components/assistant/import/extract-request.js',
  'components/assistant/import/publish-imported.js',
  ...['llm', 'items', 'knowledge-tools', 'transcript', 'quota', 'prompts', 'didactics'].map(
    (n) => `server/termi/${n}.js`
  ),
  ...['router-index', 'compact-history', 'tasks'].map((n) => `server/termi/${n}.js`)
];

const own = fs
  .readdirSync(path.join(LIB, 'termi'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `termi/${f}`);

/** Module specifiers of static imports and re-exports. @param {string} src */
const specifiers = (src) =>
  [
    ...src.matchAll(
      /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
    )
  ].map((m) => m[1] ?? m[2]);

/** @param {string} file @param {string} spec */
function allowed(file, spec) {
  if (spec.startsWith('$app/') || spec.startsWith('$env/')) return true;
  let rel;
  if (spec.startsWith('$lib/')) rel = spec.slice(5);
  else if (spec.startsWith('.'))
    rel = path.relative(LIB, path.resolve(LIB, path.dirname(file), spec));
  else return true; // npm package or node: builtin
  return HOST_FREE.some((d) => rel.startsWith(d));
}

describe('Termi host boundary', () => {
  for (const file of [...own, ...PINNED]) {
    it(`${file} imports nothing from the host`, () => {
      const src = fs.readFileSync(path.join(LIB, file), 'utf8');
      const bad = specifiers(src).filter((s) => !allowed(file, s));
      expect(bad).toEqual([]);
    });
  }
});
