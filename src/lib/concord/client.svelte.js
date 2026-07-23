// One ConcordClient per logged-in session. Created lazily (dynamic import —
// the concord dep tree pulls @noble/hashes v2 and must never enter SSR
// chunks), torn down on logout/account switch. autoUnlock stays false: zero
// signer calls during initial sync (CORD lists unlock on user action).
import { browser } from '$app/environment';

let state = $state.raw({
  phase: /** @type {'off'|'starting'|'ready'|'error'} */ ('off'),
  client: /** @type {any} */ (undefined),
  communities: /** @type {any[]} */ ([]),
  error: /** @type {string|null} */ (null)
});

let initialized = false;
/** @type {any} */ let currentClient;
/** @type {import('rxjs').Subscription[]} */ let clientSubs = [];

// Generation guard against stale async setup() resumption (final review,
// IMPORTANT). The combineLatest subscriber below is `async`, and RxJS never
// awaits an async subscriber callback before delivering the next emission —
// so `teardown(); await setup(account)` is NOT serialized: a second
// emission (logout, account switch, or even a spurious duplicate) can start
// its own teardown()+setup() while a PRIOR setup() is still suspended
// mid-await. Two failure modes without a guard:
//   1. The stale setup resumes after logout/switch and finishes installing
//      a client for the WRONG (old) account, clobbering the new one.
//   2. The stale setup's `catch` (e.g. a network error arriving late) tears
//      down state/currentClient that by then belong to the SUCCESSOR.
// Fix: bump `generation` synchronously in the subscriber before teardown(),
// capture it as `myGeneration` at setup() entry, and re-check
// `myGeneration === generation` after every `await` inside setup()
// (including at the very top of the catch, per the instructions this
// guard was written against). A stale invocation only cleans up its OWN
// locally-held client/subs (never the shared `currentClient`/`clientSubs`,
// which may already belong to a newer generation) and never rewrites
// `state`. Interleavings exercised by the accompanying unit test
// (concord-client-generation-guard.test.js): (a) a slow setup for account A
// loses the race to a fast setup for account B — B's client ends up
// installed and A's client is stopped without touching B's; (b) a stale
// rejection (A's `client.start()` throws after B has already taken over)
// does not overwrite B's phase/error state.
let generation = 0;

export function getConcordState() {
  return state;
}

export function getConcordClient() {
  return currentClient;
}

// NOTE: nip44 capability is exposed reactively as `signerHasNip44` on
// useConcordCommunity's return value (community.svelte.js) — a raw helper
// here would read the untracked `currentClient` and go stale in templates
// (the exact bug fixed in Task 8); deliberately no such helper exists.

function teardown() {
  for (const sub of clientSubs) sub.unsubscribe();
  clientSubs = [];
  // ConcordClient exposes stop(), not dispose() — verified against
  // node_modules/applesauce-concord/dist/client/client.d.ts.
  currentClient?.stop();
  currentClient = undefined;
  state = { phase: 'off', client: undefined, communities: [], error: null };
}

/**
 * Wipe an account's local Concord data (spec §5: logout clears stores).
 * Called from the accounts$ removal watcher below (a real logout — the
 * account disappears from manager.accounts — not a mere account switch,
 * which only moves manager.active$ and never touches manager.accounts$).
 * @param {string} pubkey
 */
export async function wipeConcordData(pubkey) {
  const { runtimeConfig } = await import('$lib/stores/config.svelte.js');
  if (!runtimeConfig.concord?.enabled) return;
  const { concordDbName } = await import('./storage.js');
  const { deleteConcordDb } = await import('./idb-database.js');
  await deleteConcordDb(concordDbName(pubkey));
}

/**
 * @param {any} account
 * @param {number} myGeneration - captured from the module-level `generation`
 *   counter by the caller BEFORE this async function starts; re-checked
 *   after every await below (see the `generation` doc comment above).
 */
async function setup(account, myGeneration) {
  const { runtimeConfig } = await import('$lib/stores/config.svelte.js');
  if (myGeneration !== generation) return; // superseded while importing config
  if (!runtimeConfig.concord?.enabled) return;
  const relays = runtimeConfig.concord.relays;
  if (!relays?.length) {
    // Surface misconfiguration as an error state — leaving phase at 'off'
    // strands flag-gated UI (e.g. the /invite join button) on an
    // indefinite disabled spinner (Task 12 review finding).
    console.warn('concord: CONCORD_ENABLED without CONCORD_RELAYS — feature disabled');
    state = { ...state, phase: 'error', error: 'CONCORD_RELAYS is not configured' };
    return;
  }
  state = { ...state, phase: 'starting' };
  // Local to THIS invocation — never read/written by any other setup() call,
  // so a stale invocation can always clean up its own work without touching
  // whatever the shared `currentClient`/`clientSubs` module vars now hold.
  /** @type {any} */
  let client;
  /** @type {import('rxjs').Subscription[]} */
  const localSubs = [];
  try {
    const [{ ConcordClient }, { pool }, storageModule] = await Promise.all([
      import('applesauce-concord'),
      import('$lib/stores/nostr-infrastructure.svelte'),
      import('./storage.js')
    ]);
    if (myGeneration !== generation) return; // superseded while importing deps — never build a client for a stale account
    const dbName = storageModule.concordDbName(account.pubkey);
    client = new ConcordClient({
      signer: account.signer,
      // The app's `pool` is `applesauce-relay@^6.2.1`; applesauce-concord
      // pins its own pre-release fork of applesauce-relay as an internal
      // dependency, so svelte-check sees two structurally different
      // RelayPool classes here. Intentional per the design doc ("existing
      // app RelayPool instance") — cast bridges the type-only mismatch.
      pool: /** @type {any} */ (pool),
      relays,
      storage: storageModule.createConcordStorage(dbName),
      storeFactory: storageModule.createConcordStoreFactory(dbName),
      autoUnlock: false,
      autoSaveCommunityList: false,
      watchDirectInvites: !!account.signer?.nip44
    });
    localSubs.push(
      client.communities$.subscribe((/** @type {any[]} */ communities) => {
        if (myGeneration !== generation) return; // stale emission after a later teardown/setup
        state = { ...state, communities };
      }),
      client.phase$.subscribe((/** @type {'idle'|'starting'|'ready'|'error'} */ phase) => {
        if (myGeneration !== generation) return;
        state = { ...state, phase: phase === 'idle' ? 'starting' : phase };
      })
    );
    // No await since the last generation check above — safe to publish this
    // client as the shared one (JS is single-threaded; nothing can race in
    // between synchronous statements).
    currentClient = client;
    clientSubs = localSubs;
    state = { ...state, client };
    await client.start();
    if (myGeneration !== generation) {
      // A newer generation already ran teardown() (and may have installed
      // its own client) while `start()` was pending. currentClient/state
      // may already belong to that successor — clean up only THIS
      // invocation's local client/subs, never the shared module state.
      for (const sub of localSubs) sub.unsubscribe();
      client.stop();
    }
  } catch (/** @type {any} */ error) {
    if (myGeneration !== generation) return; // stale failure: the successor now owns currentClient/state — don't clobber it
    console.error('concord: client start failed', error);
    // A failed start must not leave a half-started client behind: drop the
    // subs, stop the client, and clear it so getConcordClient() returns
    // undefined. Keep phase/error (a plain teardown() would reset to 'off').
    for (const sub of localSubs) sub.unsubscribe();
    client?.stop();
    currentClient = undefined;
    state = {
      phase: 'error',
      client: undefined,
      communities: [],
      error: String(error?.message || error)
    };
  }
}

/** Idempotent; call once from the root layout (browser only). */
export async function initConcordService() {
  if (!browser || initialized) return;
  initialized = true;
  const [{ configReady }, { manager }, { combineLatest, Observable }] = await Promise.all([
    import('$lib/stores/config.svelte.js'),
    import('$lib/stores/accounts.svelte'),
    import('rxjs')
  ]);
  const configReady$ = new Observable((subscriber) => {
    const unsubscribe = configReady.subscribe((ready) => subscriber.next(ready));
    return () => unsubscribe();
  });
  combineLatest([configReady$, manager.active$]).subscribe(async ([ready, account]) => {
    if (!ready) return;
    // Bump BEFORE teardown()/setup() so any setup() still in flight from a
    // prior emission (this callback is async; RxJS delivers the next
    // emission without waiting for it) observes a stale generation on its
    // next re-check and bails instead of clobbering this emission's work.
    generation += 1;
    const myGeneration = generation;
    teardown();
    if (account?.signer) await setup(account, myGeneration);
  });
  // Wipe local Concord data when an account is genuinely removed (logout),
  // never on a mere active-account switch. Logic + guards live in the
  // extracted, unit-tested watcher; wipeConcordData itself no-ops unless
  // runtimeConfig.concord.enabled.
  const { watchAccountRemovals } = await import('./account-removal-watcher.js');
  watchAccountRemovals({
    getAccounts: () => manager.accounts,
    accounts$: manager.accounts$,
    wipe: wipeConcordData
  });
}
