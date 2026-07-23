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
    console.warn('concord: CONCORD_ENABLED without CONCORD_RELAYS — feature disabled');
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
    state = { ...state, phase: 'error', error: String(error?.message || error) };
  }
}

/**
 * Watch for accounts disappearing from the manager (a real logout/removal,
 * as opposed to switching `active$` between existing accounts) and wipe
 * that pubkey's local Concord data. Guards against the same pubkey still
 * being logged in under a second account instance (e.g. extension + bunker).
 * @param {any} manager
 */
function watchAccountRemovals(manager) {
  /** @type {{id: string, pubkey: string}[]} */
  let previous = manager.accounts.map((/** @type {any} */ a) => ({ id: a.id, pubkey: a.pubkey }));
  manager.accounts$.subscribe((/** @type {any[]} */ accounts) => {
    const current = accounts.map((a) => ({ id: a.id, pubkey: a.pubkey }));
    const removed = previous.filter((prev) => !current.some((c) => c.id === prev.id));
    previous = current;
    for (const { pubkey } of removed) {
      if (current.some((c) => c.pubkey === pubkey)) continue; // still logged in under another account instance
      wipeConcordData(pubkey).catch((error) => {
        console.error('concord: failed to wipe local data on logout', error);
      });
    }
  });
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
  watchAccountRemovals(manager);
}
