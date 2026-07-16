import { AccountManager } from 'applesauce-accounts';
import { registerCommonAccountTypes } from 'applesauce-accounts/accounts';
import { NostrConnectSigner } from 'applesauce-signers';

/**
 * @typedef {{ name?: string }} AccountMetadata
 */

/* Shared manager (keeps same instance across component mounts) */
export const manager = $state(new AccountManager());
registerCommonAccountTypes(manager);

/**
 * How long to wait for a NIP-07 extension to respond before treating the request
 * as failed. Some extensions never settle `signEvent()` when the user dismisses the
 * popup (instead of explicitly rejecting); without a bound the calling UI would spin
 * forever. Long enough to comfortably cover a deliberate human approval.
 */
export const EXTENSION_SIGNER_TIMEOUT_MS = 60_000;

/**
 * How long to wait for a NIP-46 remote signer (nsec.app, Amber, …). Bunkers
 * often need a push notification to wake the signing app on another device,
 * so the bound is more generous than the extension one — but a sleeping
 * bunker must not hang "Applying changes…" forever (edufeed-app#19).
 */
export const BUNKER_SIGNER_TIMEOUT_MS = 90_000;

/** Marks a signer that has already been wrapped, so re-runs don't double-wrap. */
const TIMEOUT_WRAPPED = Symbol('timeout-wrapped-signer');

/**
 * Reject `promise` if it has not settled within `ms`, clearing the timer either way.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function rejectAfter(promise, ms, label) {
  /** @type {ReturnType<typeof setTimeout>} */
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`${label} timed out after ${ms / 1000}s — the signer did not respond`)),
      ms
    );
  });
  return Promise.race([promise, /** @type {Promise<T>} */ (timeout)]).finally(() =>
    clearTimeout(timer)
  );
}

/**
 * Wrap a signer so `signEvent` rejects after `ms` instead of hanging forever.
 * Everything else (getPublicKey, nip04/nip44, pubkey) passes through unchanged, so
 * encryption and key lookups behave exactly as before.
 *
 * @template {object} T
 * @param {T} signer
 * @param {number} ms
 * @returns {T}
 */
export function wrapSignerWithTimeout(signer, ms) {
  return new Proxy(signer, {
    get(target, prop) {
      if (prop === TIMEOUT_WRAPPED) return true;
      if (prop === 'signEvent') {
        return (/** @type {any} */ template) =>
          rejectAfter(/** @type {any} */ (target).signEvent(template), ms, 'Signing the event');
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

/**
 * Wrap a NIP-46 bunker signer so signEvent (a) rejects after `ms` instead of
 * hanging on a sleeping remote app, and (b) rethrows remote errors with
 * context — NostrConnectSigner surfaces the bunker's raw error string (e.g.
 * "exceeded quota"), which is meaningless to users without attribution.
 *
 * @template {object} T
 * @param {T} signer
 * @param {number} ms
 * @returns {T}
 */
export function wrapBunkerSigner(signer, ms) {
  return new Proxy(signer, {
    get(target, prop) {
      if (prop === TIMEOUT_WRAPPED) return true;
      if (prop === 'signEvent') {
        return (/** @type {any} */ template) =>
          rejectAfter(
            /** @type {any} */ (target).signEvent(template),
            ms,
            'Signing the event'
          ).catch((/** @type {any} */ err) => {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('did not respond')) throw err; // our own timeout
            throw new Error(`Your remote signing app reported an error: ${message}`);
          });
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

/**
 * Harden signer-backed accounts against never-settling or opaque signers:
 *
 * NIP-07 extension accounts:
 * 1. Disable applesauce's per-account signing queue. Otherwise one never-settling
 *    request poisons the account's shared lock and blocks ALL subsequent signing
 *    until a hard reload. Extensions serialize prompts themselves, so this is safe
 *    for them (unlike NIP-46/bunker, which benefits from serialization).
 * 2. Wrap the signer with a timeout so the originating request itself eventually
 *    rejects, letting the calling UI clear its loading state instead of spinning
 *    forever.
 *
 * NIP-46 bunker accounts keep their queue (serialization is wanted there) but
 * get a timeout + error-context wrapper (see wrapBunkerSigner, edufeed-app#19).
 *
 * Idempotent — re-running won't double-wrap. See accounts.queue.test.js.
 *
 * @param {Array<{ type?: string, disableQueue?: boolean, signer?: any }>} accounts
 * @param {{ bunkerTimeoutMs?: number }} [opts]
 */
export function hardenExtensionAccounts(accounts, opts = {}) {
  for (const account of accounts) {
    if (account.type === 'extension') {
      account.disableQueue = true;
      if (account.signer && !account.signer[TIMEOUT_WRAPPED]) {
        account.signer = wrapSignerWithTimeout(account.signer, EXTENSION_SIGNER_TIMEOUT_MS);
      }
    } else if (account.type === 'nostr-connect') {
      if (account.signer && !account.signer[TIMEOUT_WRAPPED]) {
        account.signer = wrapBunkerSigner(
          account.signer,
          opts.bunkerTimeoutMs ?? BUNKER_SIGNER_TIMEOUT_MS
        );
      }
    }
  }
}

// Initialize account persistence
async function initializeAccountPersistence() {
  if (typeof window === 'undefined') return; // Only run on client side

  try {
    // Step 1: Set pool on NostrConnectSigner BEFORE restoring accounts
    // so that restored bunker signers can communicate with relays
    const { pool } = await import('$lib/stores/nostr-infrastructure.svelte');
    NostrConnectSigner.pool = pool;

    // Step 2: Load existing accounts from localStorage
    const savedAccounts = localStorage.getItem('accounts');
    if (savedAccounts) {
      const json = JSON.parse(savedAccounts);
      await manager.fromJSON(json);

      // Step 2b: Re-open relay subscriptions for restored bunker accounts
      for (const account of manager.accounts) {
        if (account.type === 'nostr-connect' && account.signer?.open) {
          account.signer.open().catch((/** @type {Error} */ err) => {
            console.warn('⚠️ Failed to reconnect bunker account:', err.message);
          });
        }
      }
    }

    // Step 3: Load active account from storage
    const activeAccountId = localStorage.getItem('active');
    if (activeAccountId && manager.getAccount(activeAccountId)) {
      manager.setActive(activeAccountId);
    }
  } catch (error) {
    console.error('❌ Failed to load accounts from storage:', error);
  }

  // Step 4: Subscribe to account changes and persist to localStorage
  manager.accounts$.subscribe((accounts) => {
    // Prevent a dismissed extension popup from deadlocking / hanging signing.
    hardenExtensionAccounts(accounts);
    try {
      const json = manager.toJSON();
      localStorage.setItem('accounts', JSON.stringify(json));
    } catch (error) {
      console.error('❌ Failed to save accounts to storage:', error);
    }
  });

  // Step 5: Subscribe to active account changes and persist
  manager.active$.subscribe((account) => {
    try {
      if (account) {
        localStorage.setItem('active', account.id);
      } else {
        localStorage.removeItem('active');
      }
    } catch (error) {
      console.error('❌ Failed to save active account:', error);
    }
  });

  // Step 6: Load user's app-specific relay sets (kind 30002) on login
  // Uses combineLatest pattern to wait for BOTH config AND active account to be ready
  // This fixes race condition where relay set loading runs before config is initialized
  const { combineLatest } = await import('rxjs');
  const { configReady } = await import('$lib/stores/config.svelte.js');

  // Convert Svelte store to Observable
  const configReady$ = new (await import('rxjs')).Observable((subscriber) => {
    const unsubscribe = configReady.subscribe((ready) => subscriber.next(ready));
    return () => unsubscribe();
  });

  combineLatest([configReady$, manager.active$]).subscribe(async ([isConfigReady, account]) => {
    const {
      clearUserOverrideCache,
      updateUserOverrideCache,
      CATEGORIES,
      getRelaySetDTag,
      parseRelaySetEvent
    } = await import('$lib/services/app-relay-service.svelte.js');

    if (!account) {
      clearUserOverrideCache();
      return;
    }

    // Wait for config to be ready before loading relay sets
    // This ensures relayListLookupRelays has been populated from API
    if (!isConfigReady) {
      return;
    }

    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
    const { addressLoader } = await import('$lib/loaders/base.js');
    const { getRelayListLookupRelays } = await import('$lib/services/relay-service.svelte.js');

    const lookupRelays = getRelayListLookupRelays();

    // Double-check we have lookup relays (belt and suspenders)
    if (lookupRelays.length === 0) {
      console.warn('⚠️ No lookup relays configured, cannot load relay sets');
      return;
    }

    // Load and subscribe to each category's relay set via addressLoader
    for (const category of Object.keys(CATEGORIES)) {
      const dTag = getRelaySetDTag(category);
      addressLoader({
        kind: 30002,
        pubkey: account.pubkey,
        identifier: dTag,
        relays: lookupRelays
      }).subscribe();

      eventStore.replaceable(30002, account.pubkey, dTag).subscribe((event) => {
        const relays = parseRelaySetEvent(event);
        updateUserOverrideCache(category, relays);
      });
    }

    // Prefetch the user's NIP-65 relay list (kind 10002) so the session's
    // first publish resolves write relays from EventStore instead of racing
    // a cold network lookup — a miss silently falls back to fallbackRelays
    // and misroutes the event (2026-07-16 follow-set incident).
    addressLoader({ kind: 10002, pubkey: account.pubkey, relays: lookupRelays }).subscribe();

    // Load user's communities follow set (kind 30000, d="communities")
    addressLoader({
      kind: 30000,
      pubkey: account.pubkey,
      identifier: 'communities',
      relays: lookupRelays
    }).subscribe();

    // Load user's community definition (kind 10222) if they are a community admin
    // Enables self-detecting pin option in EventContextMenu
    addressLoader({
      kind: 10222,
      pubkey: account.pubkey,
      relays: lookupRelays
    }).subscribe();
  });

  // Step 7: Pre-warm relays and preload user emoji sets on login
  manager.active$.subscribe(async (account) => {
    if (account) {
      // Use dynamic import to avoid circular dependencies
      const {
        warmUserRelays,
        warmAppRelays,
        clearWarmStatus: _clearWarmStatus
      } = await import('$lib/services/relay-warming-service.svelte.js');

      // Warm relay connections (WebSocket only, no NIP-42 auth)
      warmUserRelays(account.pubkey);
      warmAppRelays();

      // Preload custom emoji sets so ReactionPicker has data on first open
      const { preloadUserEmojiSets } = await import('$lib/stores/user-emoji-sets.svelte.js');
      preloadUserEmojiSets(account.pubkey);
    } else {
      // User logged out - clear warm status
      const { clearWarmStatus } = await import('$lib/services/relay-warming-service.svelte.js');
      clearWarmStatus();
    }
  });

  // Step 8: Load contacts for follow list search when user logs in
  manager.active$.subscribe(async (account) => {
    // Use dynamic import to avoid circular dependencies
    const { contactsStore } = await import('./contacts.svelte.js');

    if (account) {
      contactsStore.loadContacts(account.pubkey);
    } else {
      contactsStore.clear();
    }
  });

  // Step 9: Set WoT user follows and active user pubkey on login/logout
  manager.active$.subscribe(async (account) => {
    const { setUserFollows, clearUserFollows, setActiveUserPubkey, clearActiveUserPubkey } =
      await import('$lib/services/curated-authors-service.svelte.js');

    if (!account) {
      clearUserFollows();
      clearActiveUserPubkey();
      return;
    }

    // Immediately include user's own pubkey in curated filters
    setActiveUserPubkey(account.pubkey);

    // Subscribe to user's kind 3 contact list and extract follow pubkeys
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
    eventStore
      .timeline({
        kinds: [3],
        authors: [account.pubkey],
        limit: 1
      })
      .subscribe((events) => {
        if (events.length > 0) {
          const latestEvent = events[events.length - 1];
          const pubkeys = latestEvent.tags
            .filter((/** @type {string[]} */ t) => t[0] === 'p' && t[1])
            .map((/** @type {string[]} */ t) => t[1]);
          setUserFollows(pubkeys);
        }
      });
  });

  // Step 10: Initialize DM service for NIP-17 encrypted messages
  manager.active$.subscribe(async (account) => {
    const { initializeDMs, cleanup } = await import('$lib/services/dm-service.svelte.js');

    if (account && account.signer) {
      initializeDMs(account.pubkey, account.signer);
    } else {
      cleanup();
    }
  });
}

// Initialize persistence when module loads (client-side only)
initializeAccountPersistence();

export const accounts = $state(/** @type {any[]} */ ([]));

// Authentication signer state (migrated from shared.svelte.js in Phase 1)
export let signer = $state({
  signer: null
});

/**
 * Custom hook for loading and managing accounts list from AccountManager
 * @returns {() => any[]} - Reactive getter function returning array of accounts
 */
export function useAccounts() {
  let accounts = $state(/** @type {any[]} */ ([]));

  $effect(() => {
    const subscription = manager.accounts$.subscribe((accountList) => {
      accounts = accountList;
    });
    return () => subscription.unsubscribe();
  });

  return () => accounts;
}

/**
 * Custom hook for loading and managing active user from AccountManager
 * @returns {() => any} - Reactive getter function returning active user
 */
export function useActiveUser() {
  let activeUser = $state(manager.active);

  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription.unsubscribe();
  });

  return () => activeUser;
}
