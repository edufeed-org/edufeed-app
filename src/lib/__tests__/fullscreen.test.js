// @ts-nocheck
/**
 * Full screen for a call tile: one path for screen shares and camera seats,
 * on the document the tile is rendered in (the pop-out window is a second
 * document), refusals logged rather than thrown.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isFullscreenOf, toggleFullscreen } from '$lib/groups/fullscreen.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete document.fullscreenElement;
});

/** jsdom has no fullscreenElement: pretend `el` is in full screen. */
function fullscreenIs(el) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
}

function tile() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.requestFullscreen = vi.fn(async () => {});
  return el;
}

describe('toggleFullscreen', () => {
  it('asks the tile itself for full screen', async () => {
    const el = tile();
    await toggleFullscreen(el);
    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('leaves full screen when the tile is the full screen element', async () => {
    const el = tile();
    fullscreenIs(el);
    document.exitFullscreen = vi.fn(async () => {});
    expect(isFullscreenOf(el)).toBe(true);
    await toggleFullscreen(el);
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(el.requestFullscreen).not.toHaveBeenCalled();
  });

  it('another element in full screen does not count as this tile', () => {
    const el = tile();
    fullscreenIs(document.body);
    expect(isFullscreenOf(el)).toBe(false);
    expect(isFullscreenOf(null)).toBe(false);
  });

  it('a refusal is logged, never thrown', async () => {
    const el = tile();
    el.requestFullscreen = vi.fn(async () => {
      throw new TypeError('not allowed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(toggleFullscreen(el)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('does nothing without an element', async () => {
    await expect(toggleFullscreen(undefined)).resolves.toBeUndefined();
  });
});
