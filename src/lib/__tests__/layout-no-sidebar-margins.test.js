/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve } from 'node:path';

// Guards against re-introduction of the margin-compensation pattern that was
// removed when sidebars became flex siblings. The intent is "never anywhere
// in src/", not just a hardcoded allowlist of the original offenders.
const FILES_TO_SCAN = globSync('src/**/*.svelte', {
  cwd: process.cwd()
});

describe('flex-sibling sidebars: no leftover lg:ml-(--sidebar-*) offsets', () => {
  test('found .svelte files to scan', () => {
    expect(FILES_TO_SCAN.length).toBeGreaterThan(0);
  });

  test.each(FILES_TO_SCAN)('%s does not use lg:ml-(--sidebar-*)', (file) => {
    const content = readFileSync(resolve(process.cwd(), file), 'utf-8');
    expect(content).not.toMatch(/lg:ml-\(--sidebar-/);
  });
});
