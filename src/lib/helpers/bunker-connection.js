import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers';
import { NostrConnectAccount } from 'applesauce-accounts/accounts';
import { generateSecretKey } from 'nostr-tools';

/**
 * Validate a bunker:// URL
 * @param {string} url
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateBunkerUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) {
    return { valid: false, error: 'Please enter a bunker URL' };
  }
  if (!trimmed.startsWith('bunker://')) {
    return { valid: false, error: 'URL must start with bunker://' };
  }
  return { valid: true };
}

/**
 * Connect to a remote signer via bunker:// URI (signer-initiated flow)
 * @param {string} url - bunker:// URI
 * @param {{ pool: any, onAuth?: (url: string) => Promise<void> }} options
 * @returns {Promise<{ signer: NostrConnectSigner, pubkey: string }>}
 */
export async function connectWithBunkerUrl(url, { pool, onAuth }) {
  const clientSecretKey = generateSecretKey();
  const clientSigner = new PrivateKeySigner(clientSecretKey);

  NostrConnectSigner.pool = pool;

  // fromBunkerURI parses the URI, builds the signer, AND calls .connect(secret,
  // permissions) internally — see applesauce-signers nostr-connect-signer.js
  // line 351. The returned signer is already opened and connected. Calling
  // .open()/.connect() again re-sends a Connect RPC without the bunker's
  // secret, which strict bunkers (nsec.app, recent Amber) reject — and
  // connect()'s error path calls close(), destroying the subscription.
  const signer = await NostrConnectSigner.fromBunkerURI(url, {
    signer: clientSigner,
    onAuth
  });

  const pubkey = await signer.getPublicKey();

  return { signer, pubkey };
}

/**
 * Generate a random secret for nostrconnect
 * @returns {string}
 */
function generateSecret() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * The NIP-46 rendezvous relay. Most popular bunkers (nsec.app, recent Amber)
 * publish their Connect-RPC ack ONLY to this relay regardless of what the
 * client lists in the `nostrconnect://` URI's `relay=` params. If our QR URI
 * doesn't list this relay, we never see the ack and `waitForSigner` hangs.
 * The official applesauce example (`signers/bunker`) uses this relay alone
 * for the same reason.
 */
const NIP46_RENDEZVOUS_RELAY = 'wss://relay.nsec.app';

/**
 * Build the list of relays for a client-initiated nostrconnect:// URI.
 * Always includes the NIP-46 rendezvous relay, deduplicated against the
 * caller-supplied fallback list.
 *
 * @param {string[] | undefined | null} fallbackRelays
 * @returns {string[]}
 */
export function buildClientConnectRelays(fallbackRelays) {
  const fallback = Array.isArray(fallbackRelays) ? fallbackRelays.filter(Boolean) : [];
  return Array.from(new Set([NIP46_RENDEZVOUS_RELAY, ...fallback]));
}

/**
 * Create a client-initiated connection (for QR code flow)
 * @param {string[]} relays
 * @param {{ pool: any, onAuth?: (url: string) => Promise<void>, appMetadata: { name: string, url: string } }} options
 * @returns {{ signer: NostrConnectSigner, uri: string, open: () => Promise<void>, waitForSigner: (signal?: AbortSignal) => Promise<void> }}
 */
export function createClientConnection(relays, { pool, onAuth, appMetadata }) {
  const clientSecretKey = generateSecretKey();
  const clientSigner = new PrivateKeySigner(clientSecretKey);

  NostrConnectSigner.pool = pool;

  const signer = new NostrConnectSigner({
    relays,
    signer: clientSigner,
    secret: generateSecret(),
    onAuth
  });

  const uri = signer.getNostrConnectURI(appMetadata);

  return {
    signer,
    uri,
    open: () => signer.open(),
    waitForSigner: (signal) => signer.waitForSigner(signal)
  };
}

/**
 * Register a bunker account with the account manager (add-or-activate pattern).
 *
 * If an account with the same pubkey already exists, the EXISTING account
 * reference is activated (applesauce's setActive looks up by `id`, so a
 * freshly-constructed account with the same pubkey would throw
 * "Cant find account with that ID"). The caller can use `alreadyExisted`
 * to surface a friendlier message instead of treating it as an error.
 *
 * @param {any} manager
 * @param {string} pubkey
 * @param {NostrConnectSigner} signer
 * @returns {{ account: NostrConnectAccount, alreadyExisted: boolean }}
 */
export function registerBunkerAccount(manager, pubkey, signer) {
  const existing = manager.getAccountForPubkey(pubkey);
  if (existing) {
    manager.setActive(existing);
    return { account: existing, alreadyExisted: true };
  }

  const account = new NostrConnectAccount(pubkey, signer);
  manager.addAccount(account);
  manager.setActive(account);
  return { account, alreadyExisted: false };
}
