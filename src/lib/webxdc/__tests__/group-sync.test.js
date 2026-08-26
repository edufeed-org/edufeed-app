/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { createGroupSync } from '../group-sync.js';
import { buildStateTemplate, buildRealtimeTemplate } from '../session-events.js';

const GROUP = 'deadbeef00000000';
const SID = 'session-uuid-1';

/**
 * @param {any[][]} pages one array of events per request() call, consumed in
 *   order; a call past the end of the array returns an empty page.
 */
function makeRelay(pages = [[]]) {
  /** @type {Subject<any>[]} */
  const subjects = [];
  let requestCall = 0;
  return {
    subjects,
    request: vi.fn((/** @type {any} */ _filter, /** @type {any} */ _opts) => {
      const page = pages[requestCall] ?? [];
      requestCall++;
      return of(...page);
    }),
    subscription: vi.fn((/** @type {any} */ _filters) => {
      const s = new Subject();
      subjects.push(s);
      return s.asObservable();
    })
  };
}
/** @param {string} id @param {number} created_at @param {any} payload */
const stateEv = (id, created_at, payload) => ({
  ...buildStateTemplate(GROUP, SID, payload),
  id,
  created_at
});

describe('createGroupSync', () => {
  it('freezes the paginated backfill sorted by created_at, then appends live in arrival order', async () => {
    const relay = makeRelay([[stateEv('b', 200, 2), stateEv('a', 100, 1)]]); // out of order, one short page
    const publish = vi.fn(async (t) => ({ ...t, id: 'own1' }));
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });
    const notified = vi.fn();
    sync.subscribe(notified);

    await vi.waitFor(() => expect(sync.getUpdates().map((u) => u.payload)).toEqual([1, 2]));
    expect(notified).toHaveBeenCalledTimes(1);
    expect(relay.request).toHaveBeenCalledTimes(1); // one short page, no second fetch
    await vi.waitFor(() => expect(relay.subjects).toHaveLength(1)); // live sub opened after backfill

    const s = relay.subjects[0];
    s.next(stateEv('c', 150, 3)); // older timestamp, arrives late → APPENDED, not spliced
    expect(sync.getUpdates().map((u) => u.payload)).toEqual([1, 2, 3]);
    s.next(stateEv('c', 150, 3)); // duplicate id ignored
    expect(sync.getUpdates()).toHaveLength(3);
    // A live EOSE (some relays still send one) is a no-op post-backfill.
    s.next('EOSE');
    expect(notified).toHaveBeenCalledTimes(2); // one for the append of 'c', none for EOSE
  });

  it('pages when a page comes back full, stitching pages with a stepped `until`', async () => {
    const fullPage = Array.from(
      { length: 500 },
      (_, i) => stateEv(`p1-${i}`, 1000 - i, i) // created_at 1000..501, oldest = 501
    );
    const secondPage = [stateEv('p2-0', 400, 999)]; // short page → stop
    const relay = makeRelay([fullPage, secondPage]);
    const publish = vi.fn();
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });

    await vi.waitFor(() => expect(sync.getUpdates()).toHaveLength(501));
    expect(relay.request).toHaveBeenCalledTimes(2);
    // Second page's filter is bounded by the first page's oldest created_at,
    // INCLUSIVE — not `oldest - 1`, which would skip any other event sharing
    // that same timestamp across the page cut (see the dedicated test below).
    expect(relay.request.mock.calls[1][0]).toMatchObject({ until: 501 });
  });

  it('does not lose events sharing the oldest created_at across a page cut (inclusive `until`)', async () => {
    // 500 events on the first page, the last two sharing the same oldest
    // created_at (501). An exclusive `until = oldest - 1` would never ask
    // for created_at 501 again, silently dropping whichever of the two
    // didn't happen to land in the first page's own result set.
    const fullPage = [
      ...Array.from({ length: 498 }, (_, i) => stateEv(`p1-${i}`, 1000 - i, i)), // 1000..503
      stateEv('p1-498', 501, 498),
      stateEv('p1-499', 501, 499)
    ];
    // Second page: the relay re-includes the 501 event it already sent (the
    // inclusive boundary's overlap) plus one genuinely new, older event.
    const secondPage = [stateEv('p1-499', 501, 499), stateEv('p2-0', 400, 999)];
    const relay = makeRelay([fullPage, secondPage]);
    const sync = createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish: vi.fn()
    });

    // 500 distinct ids from page one + exactly one new id from page two —
    // the re-sent p1-499 must not be double-counted.
    await vi.waitFor(() => expect(sync.getUpdates()).toHaveLength(501));
    expect(relay.request).toHaveBeenCalledTimes(2);
  });

  it('sendState publishes and appends optimistically, deduped against echo', async () => {
    const relay = makeRelay([[]]);
    const publish = vi.fn(async (t) => ({ ...t, id: 'own1' }));
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });
    await vi.waitFor(() => expect(relay.subjects).toHaveLength(1));
    sync.sendState({ x: 1 }, { info: 'hi' });
    await vi.waitFor(() => expect(sync.getUpdates()).toHaveLength(1));
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 9450, tags: expect.arrayContaining([['i', SID]]) })
    );
    relay.subjects[0].next({ ...publish.mock.results[0].value, id: 'own1', kind: 9450 });
    await Promise.resolve();
    expect(sync.getUpdates()).toHaveLength(1); // echo deduped
  });

  it('reports state-publish failures via onError as a write-phase error', async () => {
    const relay = makeRelay([[]]);
    const onError = vi.fn();
    const publish = vi.fn(async () => {
      throw new Error('restricted: not a member');
    });
    const sync = createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish,
      onError
    });
    await vi.waitFor(() => expect(relay.subjects).toHaveLength(1));
    sync.sendState({ x: 1 });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error), 'write'));
    expect(sync.getUpdates()).toHaveLength(0);
  });

  it('freezes with an empty backfill and still opens the live sub when the first page errors', async () => {
    const relay = makeRelay();
    relay.request = vi.fn(() => throwError(() => new Error('boom: relay hiccup')));
    const onError = vi.fn();
    const notified = vi.fn();
    const sync = createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish: vi.fn(),
      onError
    });
    sync.subscribe(notified);

    await vi.waitFor(() => expect(notified).toHaveBeenCalledTimes(1));
    expect(sync.getUpdates()).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'read');
    await vi.waitFor(() => expect(relay.subjects).toHaveLength(1)); // live sub still opens
  });

  it('freezes with whatever arrived when a page emits events but never completes (no EOSE)', async () => {
    // applesauce's Relay.request(filter, {timeout}) only bounds time-to-
    // FIRST-event — once one event has arrived, completion depends solely
    // on the relay's own EOSE. Without takeUntil(timer()) in fetchPage this
    // relay shape (an event, then silence forever) would hang the backfill
    // — and the whole session — forever.
    vi.useFakeTimers();
    try {
      const relay = makeRelay();
      const neverCompletes = new Subject();
      relay.request = vi.fn(() => neverCompletes);
      const onError = vi.fn();
      const notified = vi.fn();
      const sync = createGroupSync({
        relayConn: relay,
        groupId: GROUP,
        sessionId: SID,
        publish: vi.fn(),
        onError
      });
      sync.subscribe(notified);

      neverCompletes.next(stateEv('a', 100, 1)); // one event arrives...
      // ...and then never an EOSE/complete.

      await vi.advanceTimersByTimeAsync(5000);

      expect(sync.getUpdates().map((u) => u.payload)).toEqual([1]);
      expect(notified).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(relay.subjects).toHaveLength(1); // live sub opened once frozen
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() cancels an in-flight backfill page instead of leaving it hung forever', async () => {
    const relay = makeRelay();
    const neverCompletes = new Subject();
    relay.request = vi.fn(() => neverCompletes);
    const notified = vi.fn();
    const sync = createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish: vi.fn()
    });
    sync.subscribe(notified);

    sync.stop();
    // Let the unstuck `await fetchPage(...)` and its continuation settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(neverCompletes.observed).toBe(false); // the page subscription was actually torn down
    expect(sync.getUpdates()).toEqual([]);
    expect(notified).not.toHaveBeenCalled(); // stopped before the freeze/notify ever ran
    expect(relay.subjects).toHaveLength(0); // live sub never opened
  });

  it('opens the live subscription bounded by `since` = the newest backfilled event', async () => {
    const relay = makeRelay([[stateEv('a', 100, 1), stateEv('b', 200, 2)]]);
    const sync = createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish: vi.fn()
    });

    await vi.waitFor(() => expect(sync.getUpdates()).toHaveLength(2));
    expect(relay.subscription).toHaveBeenCalledWith([expect.objectContaining({ since: 200 })]);
  });

  it('omits `since` on the live subscription when the backfill collected nothing', async () => {
    const relay = makeRelay([[]]);
    createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish: vi.fn()
    });

    await vi.waitFor(() => expect(relay.subjects).toHaveLength(1));
    const [filters] = relay.subscription.mock.calls[0];
    expect(filters[0]).not.toHaveProperty('since');
  });

  it('retries the backfill once after authenticate() on an auth-required paging error', async () => {
    const relay = makeRelay();
    let attempt = 0;
    relay.request = vi.fn(() => {
      attempt++;
      if (attempt === 1) return throwError(() => new Error('auth-required: please authenticate'));
      return of(stateEv('a', 100, 1));
    });
    const authenticate = vi.fn(async () => ({ ok: true }));
    const onError = vi.fn();
    const sync = createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish: vi.fn(),
      onError,
      authenticate
    });

    await vi.waitFor(() => expect(sync.getUpdates().map((u) => u.payload)).toEqual([1]));
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(relay.request).toHaveBeenCalledTimes(2);
  });

  it('retries the live subscription once after authenticate() on a restricted error, then gives up on a second refusal', async () => {
    const relay = makeRelay([[]]);
    let subCall = 0;
    relay.subscription = vi.fn(() => {
      subCall++;
      const s = new Subject();
      relay.subjects.push(s);
      if (subCall <= 2) {
        queueMicrotask(() =>
          s.error(new Error("restricted: you're trying to access a private group"))
        );
      }
      return s.asObservable();
    });
    const authenticate = vi.fn(async () => ({ ok: true }));
    const onError = vi.fn();
    createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish: vi.fn(),
      onError,
      authenticate
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error), 'read'));
    // One retry only: authenticate ran once, and the second (still-restricted)
    // refusal is reported rather than retried again.
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(relay.subscription).toHaveBeenCalledTimes(2);
  });

  it('realtime: lazy 24450 subscription, own frames skipped', async () => {
    const relay = makeRelay([[]]);
    const publish = vi.fn(async (t) => ({ ...t, id: 'rt1' }));
    const sync = createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish,
      selfPubkey: 'me'
    });
    await vi.waitFor(() => expect(relay.subjects).toHaveLength(1)); // state live sub, no realtime yet

    /** @type {number[][]} */
    const frames = [];
    const off = sync.onRealtime((bytes) => frames.push([...bytes]));
    expect(relay.subjects).toHaveLength(2);
    sync.sendRealtime(Uint8Array.from([7]));
    // No wait-for-publish choreography: the own-frame filter is pubkey-based,
    // not id-based, so it must work even if the echo arrives before publish()
    // resolves (the race that made the old id-set mechanism unsafe).
    relay.subjects[1].next({
      ...buildRealtimeTemplate(GROUP, SID, Uint8Array.from([7])),
      id: 'rt1',
      pubkey: 'me'
    });
    relay.subjects[1].next({
      ...buildRealtimeTemplate(GROUP, SID, Uint8Array.from([9])),
      id: 'peer',
      pubkey: 'peer'
    });
    expect(frames).toEqual([[9]]); // own frame (pubkey 'me') skipped
    off();
  });

  it('throttles sendRealtime to one publish per 100ms, leading + trailing, dropping the middle frame', async () => {
    vi.useFakeTimers();
    try {
      const relay = makeRelay([[]]);
      const publish = vi.fn(async (t) => ({ ...t, id: `rt${publish.mock.calls.length}` }));
      const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });

      sync.sendRealtime(Uint8Array.from([1]));
      sync.sendRealtime(Uint8Array.from([2]));
      sync.sendRealtime(Uint8Array.from([3]));

      // Leading edge: the first frame published immediately, synchronously.
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish.mock.calls[0][0].content).toBe(btoa(String.fromCharCode(1)));

      await vi.advanceTimersByTimeAsync(100);

      // Trailing edge: exactly one more publish, carrying the LAST frame
      // (frame [2] was superseded and never published at all).
      expect(publish).toHaveBeenCalledTimes(2);
      expect(publish.mock.calls[1][0].content).toBe(btoa(String.fromCharCode(3)));
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the realtime throttle timer on stop()', async () => {
    const relay = makeRelay([[]]);
    const publish = vi.fn(async (t) => ({ ...t, id: 'rt1' }));
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });
    sync.sendRealtime(Uint8Array.from([1]));
    sync.sendRealtime(Uint8Array.from([2])); // queued as pending
    sync.stop();
    await new Promise((r) => setTimeout(r, 150));
    // Only the leading publish went out; stop() dropped the pending trailing one.
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
