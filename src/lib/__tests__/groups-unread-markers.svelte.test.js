/** @vitest-environment jsdom */
/**
 * Where read markers survive.
 *
 * The defect this file exists to catch is the one that cannot be seen in a
 * single session: unread that resets whenever the app reconnects or reloads is
 * worse than no unread at all, because it teaches you to ignore the bold. So
 * every read here goes back to `localStorage` rather than to a module cache —
 * a "reload" in these tests is a fresh read, and it must return what the
 * previous session wrote.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readUnreadMarkers, writeUnreadMarkers } from '$lib/groups/unread-markers.svelte.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const KEY = 'allgemein@wss://groups.example/';

beforeEach(() => {
  localStorage.clear();
});

describe('unread markers', () => {
  it('has no markers before anything is read', () => {
    expect(readUnreadMarkers(ME)).toEqual({});
  });

  it('gives a marker written in an earlier session back after a reload', () => {
    writeUnreadMarkers(ME, { [KEY]: 1700 });
    // No in-memory hand-off: this is the value as the next page load finds it.
    expect(readUnreadMarkers(ME)).toEqual({ [KEY]: 1700 });
  });

  it('keeps one account out of another account markers', () => {
    writeUnreadMarkers(ME, { [KEY]: 1700 });
    expect(readUnreadMarkers(OTHER)).toEqual({});
  });

  it('has nothing to read for a signed-out user', () => {
    writeUnreadMarkers(ME, { [KEY]: 1700 });
    expect(readUnreadMarkers(null)).toEqual({});
  });

  it('writes nothing for a signed-out user rather than under a shared key', () => {
    writeUnreadMarkers(null, { [KEY]: 1700 });
    expect(localStorage.length).toBe(0);
  });

  it('reads unparseable storage as no markers instead of throwing', () => {
    localStorage.setItem('groups-unread:' + ME, '{oh no');
    expect(readUnreadMarkers(ME)).toEqual({});
  });

  it('drops a stored value that is not a timestamp', () => {
    localStorage.setItem(
      'groups-unread:' + ME,
      JSON.stringify({ [KEY]: 1700, bad: 'soon', worse: null })
    );
    expect(readUnreadMarkers(ME)).toEqual({ [KEY]: 1700 });
  });

  it('reads a stored non-object as no markers', () => {
    localStorage.setItem('groups-unread:' + ME, '"nope"');
    expect(readUnreadMarkers(ME)).toEqual({});
  });

  it('reads a stored array as no markers, not as index-keyed ones', () => {
    // An array survives a `typeof === 'object'` check and its entries are
    // numbers, so without the Array.isArray branch it would come back as
    // {0: 5, 1: 6} — markers under keys that are not channels.
    localStorage.setItem('groups-unread:' + ME, '[5,6]');
    expect(readUnreadMarkers(ME)).toEqual({});
  });

  it('keeps the markers it already had when the quota is full', () => {
    writeUnreadMarkers(ME, { [KEY]: 1700 });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeUnreadMarkers(ME, { [KEY]: 1800 })).not.toThrow();
    setItem.mockRestore();
    expect(readUnreadMarkers(ME)).toEqual({ [KEY]: 1700 });
  });
});
