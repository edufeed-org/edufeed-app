/** @vitest-environment node */
// Locks the applesauce v6 paging semantics the app's feeds are built on, now
// provided by the local port in $lib/loaders/timeline-loader.js (applesauce v7
// replaced block paging with explicit time windows).
import { describe, it, expect, vi } from 'vitest';
import { of, EMPTY } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { createTimelineLoader } from '$lib/loaders/timeline-loader.js';

/** @param {number} createdAt */
const ev = (createdAt, id = `id-${createdAt}`) => ({
  id,
  kind: 1,
  pubkey: 'a'.repeat(64),
  created_at: createdAt,
  content: '',
  tags: [],
  sig: 'b'.repeat(128)
});

/** @param {Array<Array<any>>} pages */
function fakePool(pages) {
  /** @type {any[][]} */
  const calls = [];
  const pool = vi.fn((/** @type {string[]} */ relays, /** @type {any[]} */ filters) => {
    calls.push(filters);
    const page = pages.shift();
    return page && page.length ? of(...page) : EMPTY;
  });
  return { pool, calls };
}

const RELAYS = ['wss://a.example', 'wss://b.example'];

/**
 * A timeline loader observable never completes (the window subject stays
 * open), so collect what one block call emits and let go again.
 * @param {import('rxjs').Observable<any>} obs
 */
async function collect(obs) {
  /** @type {any[]} */
  const got = [];
  const sub = obs.subscribe((e) => got.push(e));
  await new Promise((r) => setTimeout(r, 0));
  sub.unsubscribe();
  return got;
}

describe('createTimelineLoader (v6 paging port)', () => {
  it('loader() pages backward: next block uses until = oldest seen - 1', async () => {
    const { pool, calls } = fakePool([[ev(300), ev(200)], [ev(100)], []]);
    const loader = createTimelineLoader(pool, RELAYS, { kinds: [1] }, { limit: 2 });

    const first = await collect(loader());
    expect(first.map((e) => e.created_at)).toEqual([300, 200]);
    expect(calls[0]).toEqual([{ kinds: [1], limit: 2 }]);
    expect(pool).toHaveBeenCalledWith(RELAYS, expect.anything());

    const second = await collect(loader());
    expect(second.map((e) => e.created_at)).toEqual([100]);
    expect(calls[1]).toEqual([{ kinds: [1], limit: 2, until: 199 }]);

    // Third block is empty → loader completes for good
    const third = await collect(loader());
    expect(third).toEqual([]);
    expect(calls[2]).toEqual([{ kinds: [1], limit: 2, until: 99 }]);

    // Exhausted: no more requests are made
    await collect(loader());
    expect(calls).toHaveLength(3);
  });

  it('deduplicates events through the event store', async () => {
    // Fixture sigs are fake: verification would drop every event.
    const eventStore = new EventStore({ verifyEvent: () => true });
    const { pool } = fakePool([
      [ev(300), ev(300), ev(200)],
      [ev(200), ev(100)]
    ]);
    const loader = createTimelineLoader(pool, RELAYS, { kinds: [1] }, { eventStore });

    const first = await collect(loader());
    expect(first.map((e) => e.id)).toEqual(['id-300', 'id-200']);
    // Only duplicates within one block are dropped here; a repeat across
    // blocks is re-emitted (v6 behaviour) and collapses in the store/models.
    const second = await collect(loader());
    expect(second.map((e) => e.id)).toEqual(['id-200', 'id-100']);
    expect(eventStore.hasEvent('id-100')).toBe(true);
  });

  it('merges a cache request with the relay request', async () => {
    const { pool } = fakePool([[ev(300)], []]);
    const cache = vi.fn(() => [ev(250, 'cached')]);
    const loader = createTimelineLoader(pool, RELAYS, { kinds: [1] }, { cache, limit: 5 });

    const first = await collect(loader());
    expect(first.map((e) => e.id).sort()).toEqual(['cached', 'id-300']);
    expect(cache).toHaveBeenCalledWith([{ kinds: [1], limit: 5 }]);
  });

  it('loader({ since, until }) loads an explicit window', async () => {
    const { pool, calls } = fakePool([[ev(150)], []]);
    const loader = createTimelineLoader(pool, RELAYS, { kinds: [1] });

    const got = await collect(loader({ since: 100, until: 200 }));
    expect(got.map((e) => e.created_at)).toEqual([150]);
    // Backward and forward block loaders both watch the window; with both
    // bounds finite the forward one fires first (since) while the backward
    // one is already "in range" (until initialises its cursor).
    expect(calls[0]).toEqual([{ kinds: [1], since: 100 }]);
  });

  it('accepts an upstream pool object with request()', async () => {
    const request = vi.fn(() => of(ev(10)));
    const loader = createTimelineLoader({ request }, RELAYS, { kinds: [1] });
    const got = await collect(loader());
    expect(got).toHaveLength(1);
    expect(request).toHaveBeenCalledWith(RELAYS, [{ kinds: [1] }]);
  });
});
