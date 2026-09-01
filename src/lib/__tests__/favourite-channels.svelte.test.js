/** @vitest-environment jsdom */
/**
 * Where a channel favourite lives: ON THIS DEVICE, per account.
 *
 * A synced NIP-51 list would publish which NIP-29 group ids an account cares
 * about — membership metadata on public relays — and for Concord channels any
 * public trace at all is off the table. So favourites follow the same
 * decision, and the same storage shape, as unread-markers.svelte.js:
 * localStorage keyed by pubkey, reads that go back to storage (a "reload"
 * in these tests is a fresh read, not an in-memory hand-off).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readFavouriteChannels,
  toggleFavouriteChannel
} from '$lib/groups/favourite-channels.svelte.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const KEY = 'group:allgemein@wss://groups.example/';
const KEY2 = 'concord:c1';

beforeEach(() => {
  localStorage.clear();
});

describe('favourite channels', () => {
  it('has no favourites before anything is starred', () => {
    expect(readFavouriteChannels(ME)).toEqual(new Set());
  });

  it('gives a favourite starred in an earlier session back after a reload', () => {
    toggleFavouriteChannel(ME, KEY);
    expect(readFavouriteChannels(ME)).toEqual(new Set([KEY]));
  });

  it('unstars on the second toggle', () => {
    toggleFavouriteChannel(ME, KEY);
    toggleFavouriteChannel(ME, KEY2);
    toggleFavouriteChannel(ME, KEY);
    expect(readFavouriteChannels(ME)).toEqual(new Set([KEY2]));
  });

  it('keeps one account out of another account favourites', () => {
    toggleFavouriteChannel(ME, KEY);
    expect(readFavouriteChannels(OTHER)).toEqual(new Set());
  });

  it('has nothing to read for a signed-out user', () => {
    toggleFavouriteChannel(ME, KEY);
    expect(readFavouriteChannels(null)).toEqual(new Set());
  });

  it('writes nothing for a signed-out user rather than under a shared key', () => {
    toggleFavouriteChannel(null, KEY);
    expect(localStorage.length).toBe(0);
  });

  it('ignores a toggle of a missing key', () => {
    toggleFavouriteChannel(ME, null);
    toggleFavouriteChannel(ME, '');
    expect(localStorage.length).toBe(0);
  });

  it('reads unparseable storage as no favourites instead of throwing', () => {
    localStorage.setItem('channel-favourites:' + ME, '{oh no');
    expect(readFavouriteChannels(ME)).toEqual(new Set());
  });

  it('reads a stored non-array as no favourites', () => {
    localStorage.setItem('channel-favourites:' + ME, '{"a": 1}');
    expect(readFavouriteChannels(ME)).toEqual(new Set());
  });

  it('drops a stored entry that is not a channel key string', () => {
    localStorage.setItem('channel-favourites:' + ME, JSON.stringify([KEY, 5, null, '']));
    expect(readFavouriteChannels(ME)).toEqual(new Set([KEY]));
  });

  it('keeps the favourites it already had when the quota is full', () => {
    toggleFavouriteChannel(ME, KEY);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => toggleFavouriteChannel(ME, KEY2)).not.toThrow();
    setItem.mockRestore();
    expect(readFavouriteChannels(ME)).toEqual(new Set([KEY]));
  });
});
