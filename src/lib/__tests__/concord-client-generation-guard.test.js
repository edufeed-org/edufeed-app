/** @vitest-environment node */
/**
 * Generation guard (final review, IMPORTANT) — see the doc comment above
 * `generation` in client.svelte.js. The `initConcordService()` subscriber is
 * `async` and RxJS never waits for it before delivering the next emission,
 * so `teardown(); await setup(account)` was NOT serialized: a fast second
 * emission (account switch / logout) could resume while a slow first
 * `setup()` was still suspended mid-await, either installing a client for
 * the wrong (stale) account or having its `catch` tear down state that by
 * then belonged to the successor.
 *
 * This test drives that exact interleaving with a controllable, mocked
 * `ConcordClient.start()`: account A's `start()` is held open past account
 * B's active$ emission, and B's `start()` resolves first. Without the
 * generation guard, A's client (built for account A) would still be
 * assigned to `currentClient`/`state` when its `start()` eventually
 * resolves/rejects, clobbering B.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';

/** @type {Map<string, {promise: Promise<void>, resolve: (value?: any) => void, reject: (reason?: any) => void}>} */
const startGates = new Map();
/** @type {any[]} */
const createdClients = [];

function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  /** @type {(reason?: any) => void} */
  let reject = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush pending microtasks generously — every await in setup() is a plain
 * microtask (mocked dynamic imports resolve immediately), so this is not
 * timing-sensitive; the only real "wait" points are the start() gates we
 * control explicitly below. */
async function flush(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  // A dynamic import() can take more than a single microtask tick to settle
  // even for an already-loaded module, so also cross one macrotask boundary
  // to be sure everything queued so far has drained.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const active$ = new Subject();

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active$,
    accounts$: { subscribe: () => ({ unsubscribe() {} }) },
    accounts: []
  }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  configReady: {
    subscribe: (/** @type {(ready: boolean) => void} */ cb) => {
      cb(true);
      return () => {};
    }
  },
  runtimeConfig: { concord: { enabled: true, relays: ['wss://concord.test'] } }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ pool: {} }));

// NOTE: these two are relative to client.svelte.js (src/lib/concord/), NOT
// to this test file — the specifier must resolve to the same absolute path
// vitest sees when client.svelte.js does `import('./storage.js')`.
vi.mock('../concord/storage.js', () => ({
  concordDbName: (/** @type {string} */ pk) => `concord-${pk}`,
  createConcordStorage: () => ({}),
  createConcordStoreFactory: () => ({})
}));

vi.mock('../concord/account-removal-watcher.js', () => ({ watchAccountRemovals: vi.fn() }));

// notifications.svelte.js pulls in community.svelte.js, which statically
// imports client.svelte.js (getConcordState/getConcordClient) — a real cycle
// back into the very module under test. Leaving the dynamic
// import('./notifications.svelte.js') unmocked here left it never resolving
// in this harness (the module graph deadlocks on the circular re-entry into
// client.svelte.js while it's still mid-setup()), which silently defeated
// the intended start()-gate interleaving below without failing any
// assertion. Mock it so setup() actually reaches `await client.start()`.
//
// notifStartGates lets a test suspend one account's startConcordNotifications
// call mid-flight (default: resolves immediately, like the real mock did
// before) — needed below to reproduce the stale-branch-stops-the-winner race
// (final review, IMPORTANT) where the stale setup is still awaiting
// startConcordNotifications() when the successor's OWN service finishes
// starting.
/** @type {Map<string, {promise: Promise<void>, resolve: (value?: any) => void, reject: (reason?: any) => void}>} */
const notifStartGates = new Map();
const startConcordNotifications = vi.fn(async (/** @type {any} */ args) => {
  const gate = notifStartGates.get(args?.pubkey);
  if (gate) await gate.promise;
});
const stopConcordNotifications = vi.fn();
vi.mock('../concord/notifications.svelte.js', () => ({
  startConcordNotifications: (/** @type {any} */ args) => startConcordNotifications(args),
  stopConcordNotifications: () => stopConcordNotifications()
}));

vi.mock('applesauce-concord', () => {
  class FakeConcordClient {
    /** @param {any} opts */
    constructor(opts) {
      this.pubkey = opts.signer.pubkey;
      this.stopped = false;
      // Store the subscribed callback so a test can fire a "late" emission
      // from a superseded client, independent of whether .unsubscribe() was
      // actually called — this isolates the generation guard INSIDE the
      // subscription callback body from the guard around setup() itself.
      this.communities$ = {
        subscribe: (/** @type {(v: any) => void} */ cb) => {
          this.emitCommunities = cb;
          return { unsubscribe() {} };
        }
      };
      this.phase$ = { subscribe: () => ({ unsubscribe() {} }) };
      // Auto-unlock (client.svelte.js) subscribes this at setup; a stub that
      // never emits means no auto-unlock fires in these tests.
      this.communityList$ = { subscribe: () => ({ unsubscribe() {} }) };
      // Same for the pending-direct-invite auto-read (invite UX round 2).
      this.directInviteWatcher$ = { subscribe: () => ({ unsubscribe() {} }) };
      createdClients.push(this);
    }
    async start() {
      const gate = deferred();
      startGates.set(this.pubkey, gate);
      await gate.promise;
    }
    stop() {
      this.stopped = true;
    }
  }
  return { ConcordClient: FakeConcordClient, Helpers: { STOCK_RELAYS: [] } };
});

const { initConcordService, getConcordClient, getConcordState } = await import(
  '../concord/client.svelte.js'
);

describe('client.svelte.js setup() generation guard', () => {
  beforeEach(() => {
    startGates.clear();
    notifStartGates.clear();
    createdClients.length = 0;
    startConcordNotifications.mockClear();
    stopConcordNotifications.mockClear();
  });

  it('a slow setup for an old account never overwrites a fast setup for the new account', async () => {
    await initConcordService();

    active$.next({ pubkey: 'alice', signer: { pubkey: 'alice', nip44: {} } });
    await flush(); // let alice's setup reach client.start() and suspend there

    active$.next({ pubkey: 'bob', signer: { pubkey: 'bob', nip44: {} } });
    await flush();

    // B superseding A must have torn down A's notifications service (via
    // teardown()'s `notificationsModule?.stop()`) rather than leaving it
    // running for the wrong (stale) account.
    expect(stopConcordNotifications).toHaveBeenCalled();

    startGates.get('bob')?.resolve(); // bob resolves fast, while alice is still pending
    await flush();

    expect(getConcordClient().pubkey).toBe('bob');

    // now let alice's stale start() resolve
    startGates.get('alice')?.resolve();
    await flush();

    // bob must still be current — alice's stale resumption must not clobber it
    expect(getConcordClient().pubkey).toBe('bob');
    const alice = createdClients.find((c) => c.pubkey === 'alice');
    const bob = createdClients.find((c) => c.pubkey === 'bob');
    expect(alice.stopped).toBe(true); // alice's stray client got cleaned up
    expect(bob.stopped).toBe(false); // bob's client must not have been touched

    // A superseded client's own observable can still fire its subscription
    // callback (e.g. an in-flight relay message) even after the client has
    // been stopped — the guard INSIDE that callback body (not just around
    // setup()) must reject it too.
    alice.emitCommunities?.([{ id: 'stale-from-alice' }]);
    expect(getConcordState().communities).not.toEqual([{ id: 'stale-from-alice' }]);
  });

  it('a stale rejection does not overwrite the successor’s state with an error', async () => {
    await initConcordService();

    active$.next({ pubkey: 'carol', signer: { pubkey: 'carol', nip44: {} } });
    await flush();

    active$.next({ pubkey: 'dave', signer: { pubkey: 'dave', nip44: {} } });
    await flush();
    startGates.get('dave')?.resolve();
    await flush();

    expect(getConcordState().phase).not.toBe('error');
    expect(getConcordClient().pubkey).toBe('dave');

    // carol's stale start() now rejects — must not flip state to 'error'
    startGates.get('carol')?.reject(new Error('stale network failure'));
    await flush();

    expect(getConcordState().phase).not.toBe('error');
    expect(getConcordClient().pubkey).toBe('dave');
  });

  it('a stale setup does not stop the winner’s already-started notifications service', async () => {
    // Final review, IMPORTANT: a prior version of the stale-generation
    // branch in setup() called the module-singleton stopConcordNotifications()
    // directly. Since there is one notifications service for the whole
    // session (not one per setup() invocation), that call stops WHATEVER
    // service is currently running — if the successor's own service has
    // already started by the time the stale branch runs, the stale call
    // kills the successor's healthy service instead of the stale one.
    await initConcordService();

    // Gate alice's own startConcordNotifications call so her setup()
    // suspends there (not at client.start(), unlike the other tests in this
    // file) — this is the exact await point the buggy branch resumes from.
    // Assertions below use deltas, not absolute call counts: `notificationsModule`
    // is module-level state that outlives any one `it()` (this file never
    // resets modules between tests), so a prior test's leftover client can
    // add an extra real teardown()-stop call before this test's own
    // emissions even begin.
    const aliceGate = deferred();
    notifStartGates.set('alice', aliceGate);
    active$.next({ pubkey: 'alice', signer: { pubkey: 'alice', nip44: {} } });
    await flush();
    const stopCallsAfterAliceSuspended = stopConcordNotifications.mock.calls.length;

    // Bob supersedes alice. teardown() stops whatever notificationsModule
    // pointed at (alice's, at this point) exactly once.
    active$.next({ pubkey: 'bob', signer: { pubkey: 'bob', nip44: {} } });
    await flush();
    expect(stopConcordNotifications.mock.calls.length).toBe(stopCallsAfterAliceSuspended + 1);

    // Bob's own startConcordNotifications call is NOT gated, so it already
    // resolved during the flush() above; only his client.start() is still
    // pending. Resolve it so bob's service is fully started.
    startGates.get('bob')?.resolve();
    await flush();
    expect(getConcordClient().pubkey).toBe('bob');
    const stopCallsAfterBobStarted = stopConcordNotifications.mock.calls.length;

    // NOW let alice's stale startConcordNotifications resolve — her setup()
    // resumes into the stale-generation branch.
    aliceGate.resolve();
    await flush();

    // The stale branch must NOT call the singleton stop again: that would
    // tear down bob's already-running service. teardown() (above) plus
    // bob's own start/stop already cover cleanup for this invocation.
    expect(stopConcordNotifications.mock.calls.length).toBe(stopCallsAfterBobStarted);
    expect(getConcordClient().pubkey).toBe('bob');
  });
});
