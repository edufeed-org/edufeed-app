// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * watchNewFollowers — feeds the follower ledger from the contact lists that
 * name the user (one capped, since-less fetch per session + the store model)
 * and hands the inbox stable "X folgt dir jetzt" items.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ME = 'f'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const io = vi.hoisted(() => ({ fetch: null, model: null, filters: [] }));
vi.mock('$lib/loaders/base.js', async () => {
  const { Subject } = await import('rxjs');
  return {
    fetchEvents: (relays, filter) => {
      io.filters.push([relays, filter]);
      io.fetch = new Subject();
      return io.fetch;
    }
  };
});
vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { Subject } = await import('rxjs');
  return {
    eventStore: {
      model: () => {
        io.model = new Subject();
        return io.model;
      }
    }
  };
});
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TimelineModel' }));

const { watchNewFollowers, FOLLOWER_LEDGER_PREFIX } = await import(
  '$lib/services/new-followers.svelte.js'
);

const kind3 = (pubkey, created_at) => ({
  kind: 3,
  pubkey,
  created_at,
  tags: [['p', ME]],
  content: ''
});

describe('watchNewFollowers', () => {
  beforeEach(() => {
    localStorage.clear();
    io.filters = [];
  });

  it('asks the relays once for every contact list naming the user, capped, no since', () => {
    watchNewFollowers(ME, ['wss://r'], vi.fn());
    expect(io.filters).toEqual([[['wss://r'], { kinds: [3], '#p': [ME], limit: 500 }]]);
  });

  it('records the first session silently, then announces a newcomer', () => {
    const onItems = vi.fn();
    watchNewFollowers(ME, ['wss://r'], onItems, { now: () => 2000 });
    io.model.next([kind3(A, 1000)]);
    io.fetch.complete(); // seeded at 2000
    // A republished (known), C's list predates the seeding (a past follow
    // loaded late), B followed after it.
    const C = 'c'.repeat(64);
    io.model.next([kind3(A, 2050), kind3(C, 1500), kind3(B, 2100)]);
    expect(onItems).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: `follow:${B}`, pubkey: B, created_at: 2100 })
    ]);
  });

  it('keeps the ledger across sessions', () => {
    const first = watchNewFollowers(ME, ['wss://r'], vi.fn(), { now: () => 2000 });
    io.model.next([kind3(A, 1000)]);
    io.fetch.complete();
    first.forEach((s) => s.unsubscribe());
    expect(JSON.parse(localStorage.getItem(FOLLOWER_LEDGER_PREFIX + ME))).toMatchObject({
      seeded: true,
      known: { [A]: 0 }
    });

    const onItems = vi.fn();
    watchNewFollowers(ME, ['wss://r'], onItems, { now: () => 3000 });
    io.model.next([kind3(A, 2500), kind3(B, 2900)]); // A republished — not new
    expect(onItems).toHaveBeenLastCalledWith([expect.objectContaining({ pubkey: B })]);
  });
});
