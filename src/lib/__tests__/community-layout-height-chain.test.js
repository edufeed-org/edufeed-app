/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The community route's mobile/tablet layout (< lg) wraps every community view
// in a column (it was a DaisyUI drawer until the switcher drawer left the
// phone chrome in mobile nav round 2). Views that bound their own height (the
// channel chat, the call stage inside it) resolve `h-full` against this
// chain, so for THOSE pages every box between the root <main> and the child
// layout must have a definite height: a plain `flex-1` block let the channel
// view grow with its timeline — the page scrolled, the call's tiles sat at
// the bottom of a tall box and the stage collapsed to a strip with the chat
// hidden (laoc, 2026-10-01). For every other page the chain must NOT be
// bounded: a long page overflowed the bounded box and <main>'s dock padding
// sat at the box end instead of after the content, hiding the last 80px
// under the dock (issue "mobile: bottom nav bar hides content"). The
// bounded/flowing switch is tested by rendering in
// components/__tests__/CommunityRouteLayout.bounded-chain.test.js; this file
// pins the class vocabulary in the source.
const source = readFileSync(resolve(process.cwd(), 'src/routes/c/+layout.svelte'), 'utf-8');

describe('community layout: height chain below lg', () => {
  test('the logged-in mobile shell is a flex column item whose min-h-0 is conditional', () => {
    const shell = source.match(/<div\s+data-testid="mobile-shell"[^>]*>/)?.[0] ?? '';
    expect(shell).toMatch(/class="[^"]*\bflex\b[^"]*\bflex-1\b[^"]*\bflex-col\b/);
    expect(shell).toMatch(/class:min-h-0=\{boundedChain\}/);
  });

  test('the column takes the bounded height only on bounded pages, never the viewport', () => {
    // h-dvh ignored <main>'s bottom-bar padding: the page scrolled by it.
    const column = source.match(/<div\s+data-testid="mobile-column"[^>]*>/)?.[0] ?? '';
    expect(column).toMatch(/class:h-full=\{boundedChain\}/);
    expect(column).toMatch(/class:min-h-0=\{boundedChain\}/);
    expect(column).not.toContain('h-dvh');
  });

  test('the child-layout slot is a flex column only on bounded pages, a block otherwise', () => {
    const slot = source.match(/<div\s+data-testid="mobile-slot"[^>]*>/)?.[0] ?? '';
    expect(slot).toMatch(/class="flex-1"/);
    expect(slot).toMatch(/class:flex=\{boundedChain\}/);
    expect(slot).toMatch(/class:flex-col=\{boundedChain\}/);
    expect(slot).toMatch(/class:min-h-0=\{boundedChain\}/);
  });

  test('the bounded chain is decided by the pages that own their bottom edge', () => {
    expect(source).toMatch(/boundedChain\s*=\s*\$derived/);
    expect(source).toContain('hasStaticOwnBottomUI(');
  });

  test('no drawer is left on phones', () => {
    expect(source).not.toMatch(/class="drawer/);
    expect(source).not.toContain('community-drawer');
  });

  test('the logged-out mobile wrapper is bounded too', () => {
    const wrapper = source.match(/{:else}\s*<div class="([^"]*)">\s*{@render children\(\)}/);
    expect(wrapper?.[1].split(/\s+/)).toEqual(
      expect.arrayContaining(['flex', 'min-h-0', 'flex-1', 'flex-col'])
    );
  });
});
