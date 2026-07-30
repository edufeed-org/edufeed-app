// @ts-nocheck
/**
 * Shared replaceable-update helpers (edufeed-app#64)
 *
 * Both hazards these helpers cover were first found on the calendar edit path
 * (#62) and then at further publish sites (#64). The point of the helper is
 * that a new call site inherits the guard instead of re-deriving it, so the
 * behaviour is pinned here once rather than at every adopter.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const eventStoreAdd = vi.fn();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: (...args) => eventStoreAdd(...args)
  },
  pool: {}
}));

import { nextCreatedAt, cachePublishedEvent } from '$lib/helpers/replaceableUpdates.js';

describe('nextCreatedAt', () => {
  it('is strictly greater than the event being replaced', () => {
    // The whole point: equal created_at is a tie, and a tie is resolved
    // against the replacement by nostr-idb every single time.
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(nextCreatedAt({ created_at: future })).toBe(future + 1);
  });

  it('uses wall-clock time when the predecessor is older than now', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = nextCreatedAt({ created_at: now - 500 });
    // unixNow() rounds, so it can be one second ahead of a floored now.
    expect(result).toBeGreaterThanOrEqual(now);
    expect(result).toBeLessThanOrEqual(now + 1);
  });

  it('never returns the predecessor’s own timestamp', () => {
    // Sweep the neighbourhood of "now" — this is the same-second window that
    // an edit straight after a create lands in.
    const now = Math.floor(Date.now() / 1000);
    for (let offset = -2; offset <= 2; offset++) {
      const previous = { created_at: now + offset };
      expect(nextCreatedAt(previous)).toBeGreaterThan(previous.created_at);
    }
  });

  it('falls back to wall-clock time when there is nothing to replace', () => {
    const now = Math.floor(Date.now() / 1000);
    for (const previous of [null, undefined, {}]) {
      const result = nextCreatedAt(previous);
      expect(result).toBeGreaterThanOrEqual(now);
      expect(result).toBeLessThanOrEqual(now + 1);
    }
  });
});

describe('cachePublishedEvent', () => {
  const EVENT = {
    kind: 10002,
    pubkey: 'a'.repeat(64),
    id: 'e'.repeat(64),
    created_at: 1,
    tags: [],
    content: '',
    sig: 'f'.repeat(128)
  };

  beforeEach(() => {
    eventStoreAdd.mockReset();
  });

  it('adds the event when at least one relay accepted it', () => {
    cachePublishedEvent(EVENT, { success: true, successCount: 1 });
    expect(eventStoreAdd).toHaveBeenCalledTimes(1);
    expect(eventStoreAdd).toHaveBeenCalledWith(EVENT);
  });

  it('does NOT add the event when no relay accepted it', () => {
    // The cache must not outlive a publish that never landed — mirrors
    // publishEventOptimistic removing the event on total failure.
    for (const result of [{ success: false }, null, undefined]) {
      cachePublishedEvent(EVENT, result);
    }
    expect(eventStoreAdd).not.toHaveBeenCalled();
  });

  it('swallows a rejected eventStore.add instead of failing the save', () => {
    // eventStore.add validates and throws on a malformed event. The publish
    // has already landed by then, so this must degrade to a stale read, not
    // surface as a failed save.
    eventStoreAdd.mockImplementation(() => {
      throw new Error('invalid event');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => cachePublishedEvent(EVENT, { success: true })).not.toThrow();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
