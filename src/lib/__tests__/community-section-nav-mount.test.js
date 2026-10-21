/** @vitest-environment node */
// The phone section row must be able to stick: a sticky box only moves inside
// its containing block, so the mount wrapper must not box it in (display:
// contents), and it must pin below the /c mobile header (4.5rem tall: p-4 +
// a 2.5rem btn), not under it.
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (/** @type {string} */ path) => readFileSync(resolve(process.cwd(), path), 'utf-8');

describe('community section nav (phones)', () => {
  test('the old scrolling BottomTabBar is gone', () => {
    expect(
      existsSync(resolve(process.cwd(), 'src/lib/components/community/layout/BottomTabBar.svelte'))
    ).toBe(false);
    expect(read('src/routes/c/[pubkey]/+layout.svelte')).not.toContain('BottomTabBar');
  });

  test('the layout mounts CommunitySectionNav above the page in a wrapper that does not box it in', () => {
    const layout = read('src/routes/c/[pubkey]/+layout.svelte');
    expect(layout).toMatch(/<div class="contents lg:hidden">\s*<CommunitySectionNav/);
    expect(layout.indexOf('<CommunitySectionNav')).toBeLessThan(
      layout.indexOf('{@render children()}')
    );
  });

  test('the section row sticks below the 4.5rem mobile header', () => {
    const source = read('src/lib/components/community/layout/CommunitySectionNav.svelte');
    const row = source.match(/data-testid="section-row"\s+class="([^"]*)"/);
    expect(row?.[1].split(/\s+/)).toEqual(expect.arrayContaining(['sticky', 'top-18', 'z-20']));
    const header = read('src/routes/c/+layout.svelte');
    expect(header).toMatch(
      /data-testid="mobile-community-header"\s+class="sticky top-0 z-30 [^"]*\bp-4\b/
    );
  });
});
