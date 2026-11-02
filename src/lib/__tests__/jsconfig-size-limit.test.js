/**
 * svelte-check runs the TypeScript language service, which drops into a
 * "reduced mode" once the project's non-TS files (.js + .svelte) pass 20 MB:
 * it then type-checks almost nothing and still reports "0 errors" — the
 * pre-push hook and CI pass blind. This all-JS codebase crossed the limit in
 * 2026-11 (92 instead of ~9.8k files checked). `disableSizeLimit` keeps the
 * full program.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

describe('jsconfig.json', () => {
  it('disables the language-service size limit so svelte-check checks every file', () => {
    const text = readFileSync(new URL('../../../jsconfig.json', import.meta.url), 'utf-8');
    const { config, error } = ts.parseConfigFileTextToJson('jsconfig.json', text);
    expect(error).toBeUndefined();
    expect(config.compilerOptions.disableSizeLimit).toBe(true);
  });
});
