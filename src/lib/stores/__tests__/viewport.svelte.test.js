// @ts-nocheck
/* global $effect */
/**
 * useIsDesktop — the one JS breakpoint helper (Tailwind lg, 1024px). One
 * shared MediaQuery for every caller; the getter tracks changes.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

// A real EventTarget: svelte's `on()` wrapper walks the event's target chain,
// so the change listener must receive a dispatched DOM event.
const mq = Object.assign(new EventTarget(), {
  matches: true,
  media: '(min-width: 1024px)',
  fire() {
    this.dispatchEvent(new Event('change'));
  }
});

// No vi.resetModules(): a re-imported svelte runtime would not share the
// scheduler the test's flushSync drives. The module-level MediaQuery is
// created once, so the sharing test runs first while matchMedia is counted.
window.matchMedia = vi.fn(() => mq);
const { useIsDesktop } = await import('../viewport.svelte.js');

beforeEach(() => {
  mq.matches = true;
});

describe('useIsDesktop', () => {
  it('shares one MediaQuery across callers', () => {
    const a = useIsDesktop();
    const b = useIsDesktop();
    expect(a()).toBe(true);
    expect(b()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledTimes(1);
  });

  it('reflects the lg media query and updates on change', () => {
    const isDesktop = useIsDesktop();
    let seen;
    const stop = $effect.root(() => {
      $effect(() => {
        seen = isDesktop();
      });
    });
    flushSync();
    expect(seen).toBe(true);
    mq.matches = false;
    mq.fire();
    flushSync();
    expect(seen).toBe(false);
    stop();
  });
});
