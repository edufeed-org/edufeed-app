/**
 * Call chrome autohide (design 2b): hides after the delay without input,
 * comes back on input, never hides while something holds it up, hides at
 * once when the mouse leaves the stage — and lets go of its timer on detach.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCallIdle, CALL_IDLE_DELAY_MS } from '$lib/groups/call-idle.svelte.js';

describe('createCallIdle', () => {
  /** @type {HTMLDivElement} */
  let node;
  beforeEach(() => {
    vi.useFakeTimers();
    node = document.createElement('div');
    document.body.appendChild(node);
  });
  afterEach(() => {
    node.remove();
    vi.useRealTimers();
  });

  it('starts visible and goes idle after the delay', () => {
    const ctl = createCallIdle();
    const detach = ctl.attach(node);
    expect(ctl.idle).toBe(false);
    vi.advanceTimersByTime(CALL_IDLE_DELAY_MS - 1);
    expect(ctl.idle).toBe(false);
    vi.advanceTimersByTime(1);
    expect(ctl.idle).toBe(true);
    detach();
  });

  it('any input brings the chrome back and restarts the clock', () => {
    const ctl = createCallIdle({ delay: 1000 });
    const detach = ctl.attach(node);
    vi.advanceTimersByTime(1000);
    expect(ctl.idle).toBe(true);
    node.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(ctl.idle).toBe(false);
    vi.advanceTimersByTime(900);
    node.dispatchEvent(new Event('keydown', { bubbles: true }));
    vi.advanceTimersByTime(900);
    expect(ctl.idle).toBe(false);
    vi.advanceTimersByTime(100);
    expect(ctl.idle).toBe(true);
    // Keyboard users reach the dock by focus: that counts as input too.
    node.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(ctl.idle).toBe(false);
    detach();
  });

  it('a blocker holds the chrome up; lifting it starts the clock', () => {
    const ctl = createCallIdle({ delay: 1000 });
    const detach = ctl.attach(node);
    ctl.setBlocked(true);
    vi.advanceTimersByTime(5000);
    expect(ctl.idle).toBe(false);
    ctl.setBlocked(false);
    vi.advanceTimersByTime(999);
    expect(ctl.idle).toBe(false);
    vi.advanceTimersByTime(1);
    expect(ctl.idle).toBe(true);
    // Blocking while idle shows the chrome again (a menu opened by keyboard).
    ctl.setBlocked(true);
    expect(ctl.idle).toBe(false);
    detach();
  });

  it('the mouse leaving the stage hides at once; a finger lifting does not', () => {
    const ctl = createCallIdle({ delay: 1000 });
    const detach = ctl.attach(node);
    node.dispatchEvent(Object.assign(new Event('pointerleave'), { pointerType: 'touch' }));
    expect(ctl.idle).toBe(false);
    node.dispatchEvent(Object.assign(new Event('pointerleave'), { pointerType: 'mouse' }));
    expect(ctl.idle).toBe(true);
    // ... unless something holds the chrome up.
    ctl.setBlocked(true);
    node.dispatchEvent(Object.assign(new Event('pointerleave'), { pointerType: 'mouse' }));
    expect(ctl.idle).toBe(false);
    detach();
  });

  it('detaching stops the clock', () => {
    const ctl = createCallIdle({ delay: 1000 });
    const detach = ctl.attach(node);
    detach();
    vi.advanceTimersByTime(5000);
    expect(ctl.idle).toBe(false);
    node.dispatchEvent(new Event('pointermove', { bubbles: true }));
    vi.advanceTimersByTime(5000);
    expect(ctl.idle).toBe(false);
  });
});
