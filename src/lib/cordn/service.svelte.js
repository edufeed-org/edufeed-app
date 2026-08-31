/**
 * Cordn client singleton. The /c layout mounts route children multiple times
 * for its responsive variants, so the page must never own the client — this
 * module hands every mount the same instance per account and destroys it on
 * logout/account switch. Browser-only — import dynamically from ssr=false
 * pages.
 */
import { CordnGroupsClient } from './client.svelte.js';

/** @type {{pubkey: string, client: CordnGroupsClient} | undefined} */
let current;
let watcherStarted = false;

/**
 * Get (or create) the client for the given account. Idempotent across the
 * layout's duplicate mounts; init runs once in the background.
 *
 * @param {{pubkey: string, signer: import('@contextvm/sdk').NostrSigner, config: {coordinatorPubkeys: string[], relays: string[]}}} params
 */
export function ensureCordnClient(params) {
  if (current?.pubkey === params.pubkey) return current.client;
  void current?.client.destroy();
  const client = new CordnGroupsClient(params);
  current = { pubkey: params.pubkey, client };
  void client.init();
  startAccountWatcher();
  return client;
}

/** Destroy the client when the account logs out or switches. */
function startAccountWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;
  void import('$lib/stores/accounts.svelte.js').then(({ manager }) => {
    manager.active$.subscribe((/** @type {any} */ account) => {
      if (current && (!account || account.pubkey !== current.pubkey)) {
        void current.client.destroy();
        current = undefined;
      }
    });
  });
}
