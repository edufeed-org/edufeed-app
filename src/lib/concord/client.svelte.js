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

export function getConcordState() {
  return state;
}

export function getConcordClient() {
  return currentClient;
}

/** True when the active signer supports NIP-44 (needed for list save / direct invites / rotation). */
export function signerHasNip44() {
  return !!currentClient?.signer?.nip44;
}

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

/** @param {any} account */
async function setup(account) {
  const { runtimeConfig } = await import('$lib/stores/config.svelte.js');
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
  try {
    const [{ ConcordClient }, { pool }, storageModule] = await Promise.all([
      import('applesauce-concord'),
      import('$lib/stores/nostr-infrastructure.svelte'),
      import('./storage.js')
    ]);
    const dbName = storageModule.concordDbName(account.pubkey);
    const client = new ConcordClient({
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
    currentClient = client;
    clientSubs.push(
      client.communities$.subscribe((communities) => {
        state = { ...state, communities };
      }),
      client.phase$.subscribe((phase) => {
        state = { ...state, phase: phase === 'idle' ? 'starting' : phase };
      })
    );
    state = { ...state, client };
    await client.start();
  } catch (/** @type {any} */ error) {
    console.error('concord: client start failed', error);
    // A failed start must not leave a half-started client behind: drop the
    // subs, stop the client, and clear it so getConcordClient() returns
    // undefined. Keep phase/error (a plain teardown() would reset to 'off').
    for (const sub of clientSubs) sub.unsubscribe();
    clientSubs = [];
    currentClient?.stop();
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
    teardown();
    if (account?.signer) await setup(account);
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
