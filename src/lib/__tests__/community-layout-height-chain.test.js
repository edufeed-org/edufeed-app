/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The community route's mobile/tablet layout (< lg) wraps every community view
// in a drawer. Views that bound their own height (the channel chat, the call
// stage inside it) resolve `h-full` against this chain, so every box between
// the root <main> and the child layout must have a definite height. A plain
// `flex-1` block let the channel view grow with its timeline — the page
// scrolled, the call's tiles sat at the bottom of a tall box and the stage
// collapsed to a strip with the chat hidden (laoc, 2026-10-01).
const source = readFileSync(resolve(process.cwd(), 'src/routes/c/+layout.svelte'), 'utf-8');

/** @param {string} needle */
function classesOf(needle) {
  const match = source.match(new RegExp(`<div[^>]*class="([^"]*${needle}[^"]*)"`));
  return match ? match[1].split(/\s+/) : null;
}

describe('community layout: definite height chain below lg', () => {
  test('the logged-in mobile wrapper fills <main> as a bounded flex item', () => {
    const wrapper = source.match(/<div class="([^"]*)">\s*<div class="drawer/);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.[1].split(/\s+/)).toEqual(
      expect.arrayContaining(['flex', 'min-h-0', 'flex-1', 'flex-col', 'lg:hidden'])
    );
  });

  test('the drawer fills the wrapper', () => {
    const drawer = source.match(/<div class="(drawer(?:\s[^"]*)?)">/);
    expect(drawer?.[1].split(/\s+/)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1']));
  });

  test('the drawer content takes the bounded height, not the viewport', () => {
    // h-dvh ignored <main>'s bottom-bar padding: the page scrolled by it.
    const content = classesOf('drawer-content');
    expect(content).toEqual(expect.arrayContaining(['flex', 'h-full', 'min-h-0', 'flex-col']));
    expect(content).not.toContain('h-dvh');
  });

  test('the child-layout slot below the mobile header is a bounded column', () => {
    const slot = source.match(
      /<!-- Main Content \(child layout renders here\) -->\s*<div class="([^"]*)">/
    );
    expect(slot?.[1].split(/\s+/)).toEqual(
      expect.arrayContaining(['flex', 'min-h-0', 'flex-1', 'flex-col'])
    );
  });

  test('the logged-out mobile wrapper is bounded too', () => {
    const wrapper = source.match(/{:else}\s*<div class="([^"]*lg:hidden[^"]*)">/);
    expect(wrapper?.[1].split(/\s+/)).toEqual(
      expect.arrayContaining(['flex', 'min-h-0', 'flex-1', 'flex-col'])
    );
  });
});
