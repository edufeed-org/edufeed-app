/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const LIB = path.resolve(__dirname, '..');

// Every non-test file under termi/ plus files that are host-free today.
// Add a file here only after checking its imports; unpinned files are listed below with their tie.
const PINNED = [
  'termi/model-id.js',
  'components/assistant/cards/links.js',
  'components/assistant/cards/quote.js',
  'components/assistant/history/conversation-codec.js',
  // left out: termi-chat.svelte.js, NIP-98 request signing via termi-chat-request.js (Nostr sign-in stays a host concern, D7)
  // left out: import/extract-request.js, NIP-98 request signing via termi-chat-request.js (Nostr sign-in stays a host concern, D7)
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

/** Module specifiers of static and dynamic imports and re-exports; comments (JSDoc type imports) don't count. @param {string} src */
const specifiers = (src) =>
  [
    ...src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .matchAll(
        /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/g
      )
  ].map((m) => m[1] ?? m[2] ?? m[3]);

/** An assistant file is a legal target only when it is pinned itself. @param {string} file @param {string} spec */
function allowed(file, spec) {
  if (spec.startsWith('$app/') || spec.startsWith('$env/')) return true;
  let rel;
  if (spec.startsWith('$lib/')) rel = spec.slice(5);
  else if (spec.startsWith('.'))
    rel = path.relative(LIB, path.resolve(LIB, path.dirname(file), spec));
  else return true; // npm package or node: builtin
  if (rel.startsWith('termi/') || rel.startsWith('server/termi/')) return true;
  return PINNED.includes(rel);
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
