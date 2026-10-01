/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// laoc, 2026-10-02 (window ~1000 px, below lg, in a call with the chat
// beside): the whole channel view was wider than the viewport — header
// clipped on the left, "Senden" cut off on the right. A flex item's minimum
// width defaults to its content's min-content width; the timeline column of
// GroupChat sits in a flex ROW without `min-w-0`, so the stage header's
// buttons plus the 24rem chat column set the page width (measured: 829 px
// content in a 768/800 px window).
const read = (/** @type {string} */ path) => readFileSync(resolve(process.cwd(), path), 'utf-8');

describe('channel view never widens the page', () => {
  test("GroupChat's timeline column may shrink below its content's width", () => {
    const source = read('src/lib/components/groups/GroupChat.svelte');
    const row = source.indexOf('<div class="flex min-h-0 flex-1">');
    expect(row).toBeGreaterThan(-1);
    const column = source.slice(row + 1).match(/<div\s+class="([^"{]*)/);
    expect(column?.[1].split(/\s+/)).toEqual(
      expect.arrayContaining(['relative', 'flex', 'min-h-0', 'min-w-0', 'flex-1', 'flex-col'])
    );
  });
});

describe('community bottom tab bar', () => {
  test('its tabs are centred when they fit, and still scroll when they do not', () => {
    const source = read('src/lib/components/community/layout/BottomTabBar.svelte');
    const row = source.match(/<div class="([^"]*w-max[^"]*)">/);
    expect(row?.[1].split(/\s+/)).toEqual(expect.arrayContaining(['mx-auto', 'w-max', 'flex']));
  });
});
