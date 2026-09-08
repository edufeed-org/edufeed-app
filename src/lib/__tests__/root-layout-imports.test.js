/**
 * Root layout static-import budget.
 *
 * Everything `src/routes/+layout.svelte` imports statically is preloaded on
 * every first visit (SvelteKit emits modulepreload hints for the route's whole
 * static graph). Heavy chrome that only some surfaces need must therefore be
 * loaded via `lazyComponent(() => import(...))` instead — see the issue
 * "Landing page statically pulls 290 chunks / 2.7MB of JS through the root
 * layout".
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import layoutSource from '../../routes/+layout.svelte?raw';

/** @type {string[]} */
const staticImports = layoutSource
  .split('\n')
  .filter((line) => /^\s*import\s/.test(line))
  .flatMap((line) => {
    const spec = line.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? line.match(/['"]([^'"]+)['"]/)?.[1];
    return spec ? [spec] : [];
  });

describe('root layout static imports', () => {
  it.each([
    'assistant/TermiAssistant.svelte',
    'community/layout/CommunitySidebar.svelte',
    'community/layout/ContentNavSidebar.svelte'
  ])('does not statically import %s', (needle) => {
    expect(staticImports.filter((s) => s.endsWith(needle))).toEqual([]);
  });
});
