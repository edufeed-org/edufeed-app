/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { watchAccountSwitches, flushSessionState } from '$lib/services/session-flush.js';

const alice = { id: 'acct-a', pubkey: 'pk-alice' };
const bob = { id: 'acct-b', pubkey: 'pk-bob' };
// Same pubkey as alice under a different account instance (extension + bunker)
const aliceBunker = { id: 'acct-a2', pubkey: 'pk-alice' };

describe('watchAccountSwitches', () => {
  /** @param {any} initial */
  function setup(initial) {
    const active$ = new BehaviorSubject(initial);
    const flush = vi.fn();
    const sub = watchAccountSwitches({ active$, flush });
    return { active$, flush, sub };
  }

  it('does not flush on the initial BehaviorSubject replay', () => {
    const { flush, sub } = setup(alice);
    expect(flush).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('does not flush on login from anonymous (null -> account)', () => {
    const { active$, flush, sub } = setup(null);
    active$.next(alice);
    expect(flush).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('flushes when switching between two accounts', () => {
    const { active$, flush, sub } = setup(alice);
    active$.next(bob);
    expect(flush).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('flushes on logout (account -> null)', () => {
    const { active$, flush, sub } = setup(alice);
    active$.next(null);
    expect(flush).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('does not flush when the new account has the same pubkey', () => {
    const { active$, flush, sub } = setup(alice);
    active$.next(aliceBunker);
    expect(flush).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('logout then login flushes only once (at logout)', () => {
    const { active$, flush, sub } = setup(alice);
    active$.next(null);
    active$.next(bob);
    expect(flush).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });
});

describe('flushSessionState', () => {
  /**
   * Build a signed event so EventStore accepts it.
   * @param {Uint8Array} sk
   * @param {number} kind
   * @param {string} content
   * @param {string[][]} [tags]
   */
  function makeEvent(sk, kind, content, tags = []) {
    return finalizeEvent({ kind, content, tags, created_at: Math.floor(Date.now() / 1000) }, sk);
  }

  /** @param {any[]} relays */
  function makePool(relays) {
    return {
      relays: new Map(relays.map((r) => [r.url, r])),
      remove: vi.fn()
    };
  }

  it('removes all events from the event store', () => {
    const eventStore = new EventStore();
    const sk = generateSecretKey();
    const a = makeEvent(sk, 1, 'hello');
    const b = makeEvent(sk, 9, 'chat', [['h', 'community']]);
    eventStore.add(a);
    eventStore.add(b);

    flushSessionState({ eventStore, pool: makePool([]) });

    expect(eventStore.hasEvent(a.id)).toBe(false);
    expect(eventStore.hasEvent(b.id)).toBe(false);
  });

  it('preserves deletion knowledge across the flush', () => {
    const eventStore = new EventStore();
    const sk = generateSecretKey();
    const target = makeEvent(sk, 1, 'to be deleted');
    eventStore.add(target);
    const deletion = makeEvent(sk, 5, '', [['e', target.id]]);
    eventStore.add(deletion);
    expect(eventStore.hasEvent(target.id)).toBe(false);

    flushSessionState({ eventStore, pool: makePool([]) });

    // Re-adding the deleted event (e.g. from a relay refetch) must still be rejected
    eventStore.add(target);
    expect(eventStore.hasEvent(target.id)).toBe(false);
  });

  it('closes only relays that authenticated this session', () => {
    const authed = { url: 'wss://groups.example/', authentication: { kind: 22242 } };
    const anonymous = { url: 'wss://public.example/', authentication: null };
    const pool = makePool([authed, anonymous]);

    flushSessionState({ eventStore: new EventStore(), pool });

    expect(pool.remove).toHaveBeenCalledTimes(1);
    expect(pool.remove).toHaveBeenCalledWith(authed);
  });
});
