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

  const signer = await NostrConnectSigner.fromBunkerURI(url, {
    signer: clientSigner,
    onAuth
  });

  await signer.open();
  await signer.connect();
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
 * Register a bunker account with the account manager (add-or-activate pattern)
 * @param {any} manager
 * @param {string} pubkey
 * @param {NostrConnectSigner} signer
 * @returns {NostrConnectAccount}
 */
export function registerBunkerAccount(manager, pubkey, signer) {
  const account = new NostrConnectAccount(pubkey, signer);

  if (!manager.getAccountForPubkey(pubkey)) {
    manager.addAccount(account);
  }
  manager.setActive(account);

  return account;
}
