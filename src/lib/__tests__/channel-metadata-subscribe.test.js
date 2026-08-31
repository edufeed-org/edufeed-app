/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { subscribeChannelMetadata } from '$lib/groups/channel-metadata-subscribe.js';

const A = 'wss://a.example/';
const B = 'wss://b.example/';

const meta = (/** @type {string} */ id, /** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', id], ...extra]
});

/**
 * A stand-in for the relay pool: records what was asked of it and lets a test
 * push events or errors into a specific relay's subscriber.
 */
function fakePool() {
  /** @type {Array<{relay: string, filter: any, handlers: any, unsubscribed: boolean}>} */
  const calls = [];
  /** @param {string} relay @param {any} filter */
  const subscribe = (relay, filter) => {
    const call = { relay, filter, handlers: /** @type {any} */ (null), unsubscribed: false };
    calls.push(call);
    return {
      subscribe(/** @type {any} */ handlers) {
        call.handlers = handlers;
        return {
          unsubscribe() {
            call.unsubscribed = true;
          }
        };
      }
    };
  };
  return { calls, subscribe };
}

const reqs = [
  { relay: A, filter: { kinds: [39000], '#d': ['allgemein', 'leitung'] }, keys: [] },
  { relay: B, filter: { kinds: [39000], '#d': ['extern'] }, keys: [] }
];

describe('subscribeChannelMetadata', () => {
  it('opens one subscription per request, on the named relay', () => {
    const pool = fakePool();
    subscribeChannelMetadata({ requests: reqs, subscribe: pool.subscribe, onMetadata: () => {} });
    expect(pool.calls.map((c) => c.relay)).toEqual([A, B]);
    expect(pool.calls[0].filter).toEqual(reqs[0].filter);
  });

  // The key has to be built from the relay the event CAME FROM. Two relays can
  // both carry a group called "allgemein"; keying on the id alone would let one
  // relay's metadata decide how the other relay's channel is drawn.
  it('keys each event by the relay it arrived from', () => {
    const pool = fakePool();
    const onMetadata = vi.fn();
    subscribeChannelMetadata({ requests: reqs, subscribe: pool.subscribe, onMetadata });

    pool.calls[0].handlers.next(meta('allgemein', [['private']]));
    pool.calls[1].handlers.next(meta('allgemein'));

    expect(onMetadata.mock.calls.map((c) => c[0])).toEqual([
      'allgemein@wss://a.example/',
      'allgemein@wss://b.example/'
    ]);
  });

  it('passes the event through unchanged', () => {
    const pool = fakePool();
    const onMetadata = vi.fn();
    const event = meta('allgemein', [['private']]);
    subscribeChannelMetadata({ requests: reqs, subscribe: pool.subscribe, onMetadata });
    pool.calls[0].handlers.next(event);
    expect(onMetadata.mock.calls[0][1]).toBe(event);
  });

  it('ignores events that are not group metadata', () => {
    const pool = fakePool();
    const onMetadata = vi.fn();
    subscribeChannelMetadata({ requests: reqs, subscribe: pool.subscribe, onMetadata });
    pool.calls[0].handlers.next({ kind: 9, tags: [['h', 'allgemein']] });
    // A sibling group addressable — 39001 admins, 39002 members — is the case
    // that actually tests the kind guard: it carries the SAME `d` tag, so
    // without the guard it would be filed as this channel's metadata. A kind-9
    // message has no `d` tag and is dropped for the wrong reason.
    pool.calls[0].handlers.next({ kind: 39002, tags: [['d', 'allgemein']] });
    pool.calls[0].handlers.next({ kind: 39001, tags: [['d', 'allgemein']] });
    expect(onMetadata).not.toHaveBeenCalled();
  });

  it('ignores metadata without a d tag — there is nothing to key it by', () => {
    const pool = fakePool();
    const onMetadata = vi.fn();
    subscribeChannelMetadata({ requests: reqs, subscribe: pool.subscribe, onMetadata });
    pool.calls[0].handlers.next({ kind: 39000, tags: [['name', 'Allgemein']] });
    expect(onMetadata).not.toHaveBeenCalled();
  });

  // One unreachable relay must not blind the community to its other channels.
  it('keeps the other relays alive when one errors', () => {
    const pool = fakePool();
    const onMetadata = vi.fn();
    subscribeChannelMetadata({ requests: reqs, subscribe: pool.subscribe, onMetadata });

    expect(() => pool.calls[0].handlers.error(new Error('auth-required'))).not.toThrow();
    pool.calls[1].handlers.next(meta('extern'));

    expect(onMetadata).toHaveBeenCalledTimes(1);
    expect(onMetadata.mock.calls[0][0]).toBe('extern@wss://b.example/');
  });

  it('reports a failing relay so the rail can say so', () => {
    const pool = fakePool();
    const onError = vi.fn();
    subscribeChannelMetadata({
      requests: reqs,
      subscribe: pool.subscribe,
      onMetadata: () => {},
      onError
    });
    pool.calls[0].handlers.error(new Error('auth-required'));
    expect(onError).toHaveBeenCalledWith(A, expect.any(Error));
  });

  it('tears down every subscription it opened', () => {
    const pool = fakePool();
    const stop = subscribeChannelMetadata({
      requests: reqs,
      subscribe: pool.subscribe,
      onMetadata: () => {}
    });
    stop();
    expect(pool.calls.map((c) => c.unsubscribed)).toEqual([true, true]);
  });

  it('is a no-op teardown when there is nothing to ask', () => {
    const pool = fakePool();
    const stop = subscribeChannelMetadata({
      requests: [],
      subscribe: pool.subscribe,
      onMetadata: () => {}
    });
    expect(pool.calls).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });
});
