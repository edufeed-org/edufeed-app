// @ts-nocheck
/**
 * Relay liveness for the shared pool: applesauce's RelayLiveness parks a
 * relay that fails to connect (exponential cooldown, "dead" after a sustained
 * streak) so every pool request skips it until the cooldown ends. The state
 * is persisted per device through a localStorage adapter so a relay that was
 * dead yesterday does not cost the first request of today its full timeout.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  createLivenessStorage,
  createRelayLiveness,
  skipParkedRelays,
  RELAY_LIVENESS_STORAGE_PREFIX
} from '$lib/stores/relay-liveness.js';

function fakeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    keys: () => [...m.keys()]
  };
}

describe('createLivenessStorage', () => {
  it('round-trips structured values through localStorage under a prefix', () => {
    const ls = fakeLocalStorage();
    const storage = createLivenessStorage(ls);
    storage.setItem('relays', ['wss://a.example/']);
    storage.setItem('state', { state: 'offline', failureCount: 2 });
    expect(storage.getItem('relays')).toEqual(['wss://a.example/']);
    expect(storage.getItem('state')).toEqual({ state: 'offline', failureCount: 2 });
    expect(ls.keys().every((k) => k.startsWith(RELAY_LIVENESS_STORAGE_PREFIX))).toBe(true);
  });

  it('answers null for missing or corrupt entries and never throws', () => {
    const ls = fakeLocalStorage();
    const storage = createLivenessStorage(ls);
    expect(storage.getItem('missing')).toBeNull();
    ls.setItem(RELAY_LIVENESS_STORAGE_PREFIX + 'bad', '{nope');
    expect(storage.getItem('bad')).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      }
    };
    const s2 = createLivenessStorage(throwing);
    expect(s2.getItem('x')).toBeNull();
    expect(() => s2.setItem('x', 1)).not.toThrow();
  });

  it('is undefined without a localStorage (SSR)', () => {
    expect(createLivenessStorage(null)).toBeUndefined();
  });
});

describe('createRelayLiveness', () => {
  it('parks a relay after a connection failure and lets it back after a success', () => {
    const liveness = createRelayLiveness({ storage: null });
    const dead = 'wss://dead.example/';
    const ok = 'wss://ok.example/';
    expect(liveness.filter([dead, ok])).toEqual([dead, ok]);
    liveness.recordFailure(dead);
    expect(liveness.isInBackoff(dead)).toBe(true);
    expect(liveness.filter([dead, ok])).toEqual([ok]);
    liveness.recordSuccess(dead);
    expect(liveness.filter([dead, ok])).toEqual([dead, ok]);
    liveness.destroy();
  });

  it('persists failures so a new session starts with the relay marked offline', async () => {
    const ls = fakeLocalStorage();
    const first = createRelayLiveness({ storage: createLivenessStorage(ls) });
    first.recordFailure('wss://dead.example/');
    await first.save();
    first.destroy();

    const second = createRelayLiveness({ storage: createLivenessStorage(ls) });
    await second.load();
    expect(second.getState('wss://dead.example/')?.state).toBe('offline');
    second.destroy();
  });
});

describe('skipParkedRelays', () => {
  it('drops parked relays from a one-shot cohort', () => {
    const liveness = createRelayLiveness({ storage: null });
    liveness.recordFailure('wss://dead.example/');
    expect(skipParkedRelays(liveness, ['wss://dead.example/', 'wss://ok.example/'])).toEqual([
      'wss://ok.example/'
    ]);
    liveness.destroy();
  });

  it('never drops every relay — a fully parked cohort is asked as-is', () => {
    const liveness = createRelayLiveness({ storage: null });
    liveness.recordFailure('wss://a.example/');
    liveness.recordFailure('wss://b.example/');
    expect(skipParkedRelays(liveness, ['wss://a.example/', 'wss://b.example/'])).toEqual([
      'wss://a.example/',
      'wss://b.example/'
    ]);
    liveness.destroy();
  });

  it('is the identity without a tracker (mocked infrastructure) or an empty list', () => {
    expect(skipParkedRelays(undefined, ['wss://a.example/'])).toEqual(['wss://a.example/']);
    expect(skipParkedRelays(null, [])).toEqual([]);
    expect(skipParkedRelays(/** @type {any} */ ({}), ['wss://a.example/'])).toEqual([
      'wss://a.example/'
    ]);
  });
});

describe('pool attachment', () => {
  it('observes the pool without filtering it — a pool-wide filter would retire relays from the timeline loader and standing groups', async () => {
    const { RelayPool } = await import('applesauce-relay');
    const liveness = createRelayLiveness({ storage: null });
    const pool = new RelayPool();
    liveness.connectToPool(pool);
    liveness.recordFailure('wss://dead.example/');
    expect(liveness.filter(['wss://dead.example/'])).toEqual([]);
    // the pool itself still hands the relay to every request
    expect(pool.filterRelays(['wss://dead.example/'])).toEqual(['wss://dead.example/']);
    liveness.destroy();
  });

  it('a pool WITH the liveness option completes a fully parked request empty at once (why we do not use it)', async () => {
    const { RelayPool } = await import('applesauce-relay');
    const { lastValueFrom } = await import('rxjs');
    const { toArray } = await import('rxjs/operators');
    const liveness = createRelayLiveness({ storage: null });
    const pool = new RelayPool({ liveness });
    liveness.recordFailure('wss://dead.example/');
    const events = await lastValueFrom(
      pool.request(['wss://dead.example/'], { kinds: [1], limit: 1 }).pipe(toArray()),
      { defaultValue: [] }
    );
    expect(events).toEqual([]);
    expect(pool.relays.has('wss://dead.example/')).toBe(false);
    liveness.destroy();
  });
});
