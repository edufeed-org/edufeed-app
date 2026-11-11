#!/usr/bin/env node
// Regenerate the reviewed prompt fixtures after a DELIBERATE prompt change:
//   node scripts/termi-prompt-fixtures.mjs
// then read `git diff src/lib/__tests__/fixtures/termi/` — every changed line is
// a prompt change the commit message should name.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { composePrompt } = await import('../src/lib/server/termi/tasks.js');
const dir = fileURLToPath(new URL('../src/lib/__tests__/fixtures/termi/', import.meta.url));
for (const task of ['ask', 'lesson']) {
  const text = composePrompt(task, { appName: 'Edufeed' });
  writeFileSync(`${dir}${task}-prompt.txt`, text);
  console.log(`${task}-prompt.txt: ${text.length} chars`);
}
