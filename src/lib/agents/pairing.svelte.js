/**
 * The web app as NIP-46 remote signer for a companion (the Ditto/Soapbox
 * pattern): applesauce's NostrConnectProvider with the account manager's
 * signer as upstream, so every login method (extension, local key, Google/
 * Pomegranate bunker) works unchanged. v1 signs nothing on the companion's
 * behalf — the owner's events (30175, 30177, 9000) are published by the web
 * app itself — so onSignEvent refuses. The provider stays alive after
 * pairing (the companion still calls get_public_key), and is dropped on
 * logout.
 */
import { NostrConnectProvider } from 'applesauce-signers';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';

/** @type {NostrConnectProvider[]} */
let providers = [];

manager.active$.subscribe((account) => {
  if (!account) stopAllPairings();
});

/** Pairing relays: configured ones, else the groups relays, plus what the URI names. */
function pairingRelays(/** @type {string[]} */ fromUri) {
  const configured = runtimeConfig.agents?.pairingRelays ?? [];
  const base = configured.length > 0 ? configured : getGroupsRelays();
  return [...new Set([...base, ...fromUri].map(normalizeURL))];
}

/**
 * @param {{uri: string, clientPubkey: string, relays: string[]}} args
 * @returns {Promise<string>} the connected client pubkey (= the agent pubkey)
 */
export async function pairWithCompanion({ uri, clientPubkey, relays }) {
  const provider = new NostrConnectProvider({
    relays: pairingRelays(relays),
    upstream: manager.signer,
    pool,
    onConnect: (client) => client === clientPubkey,
    onSignEvent: () => false,
    onNip04Encrypt: () => false,
    onNip04Decrypt: () => false,
    onNip44Encrypt: () => false,
    onNip44Decrypt: () => false
  });
  providers.push(provider);
  try {
    await provider.start(uri);
  } catch (error) {
    providers = providers.filter((p) => p !== provider);
    await provider.stop().catch(() => {});
    throw error;
  }
  return clientPubkey;
}

export function stopAllPairings() {
  const open = providers;
  providers = [];
  for (const provider of open) provider.stop().catch(() => {});
}
