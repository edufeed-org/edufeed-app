import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers';
import { NostrConnectAccount } from 'applesauce-accounts/accounts';
import { generateSecretKey } from 'nostr-tools';
import { buildNip46Permissions } from '$lib/helpers/nip46-permissions.js';
import { AUTH_AWARE_PUBLISH_RETRY } from '$lib/services/relay-publish-auth.js';

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
 * applesauce-signers v7 rejects a NIP-46 request after 60s by default. A
 * bunker approval is a human tapping "allow" on another device and routinely
 * takes longer (publishToGroupRelay already re-stamps events after slow
 * approvals), and the app's bunker UX is built on v6's wait-forever
 * semantics — keep those (0 = no deadline).
 */
const BUNKER_REQUEST_TIMEOUT = 0;

/**
 * Permissions requested with every connect (`perms` in the nostrconnect://
 * URI, the third `connect` param for bunker:// — also the Google/Pomegranate
 * login, which goes through connectWithBunkerUrl). A signer that honours
 * them (Amber, nsec.app) shows them once on its pairing screen and then
 * signs those kinds without a prompt; one that ignores them behaves as
 * before. They are sent only with the initial `connect`: a session paired
 * before they existed keeps its old grant until the user logs out and pairs
 * again. See nip46-permissions.js for why login depends on this.
 */
const CONNECT_PERMISSIONS = buildNip46Permissions();

/**
 * NIP-46 publish: done as soon as ONE relay accepts the request.
 *
 * applesauce's `pool.publish` resolves only after every relay answered, and
 * the signer awaits it before reading the reply — so one dead or
 * write-restricted relay (relay.nsec.app went dark in 2026-11; nostr.wine
 * refuses non-members) held every request for the 30 s publish timeout. The
 * auth-aware retry makes an `auth-required` relay fail instead of parking in
 * waitForAuth (which suspends the timeout), so all-AUTH relays error out.
 *
 * @param {any} pool
 * @returns {(relays: string[], event: any) => Promise<void>}
 */
export function firstAcceptedPublish(pool) {
  return (relays, event) =>
    Promise.any(
      relays.map(async (url) => {
        const res = await pool
          .relay(url)
          .publish(event, { timeout: 10_000, retries: AUTH_AWARE_PUBLISH_RETRY });
        if (!res?.ok) throw new Error(`${url}: ${res?.message || 'rejected'}`);
      })
    ).then(
      () => undefined,
      (/** @type {AggregateError} */ e) => {
        throw new Error(
          `NIP-46 request not accepted: ${e.errors.map((x) => x.message).join('; ')}`
        );
      }
    );
}

/**
 * Point every NostrConnectSigner — new pairings and sessions restored from
 * storage — at the app pool, publishing through {@link firstAcceptedPublish}.
 * A class-level publishMethod wins over the class-level pool.
 * @param {any} pool
 */
export function useNostrConnectPool(pool) {
  NostrConnectSigner.pool = pool;
  NostrConnectSigner.publishMethod = firstAcceptedPublish(pool);
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

  useNostrConnectPool(pool);

  // fromBunkerURI parses the URI, builds the signer, AND calls .connect(secret,
  // permissions) internally — see applesauce-signers nostr-connect-signer.js
  // line 351. The returned signer is already opened and connected. Calling
  // .open()/.connect() again re-sends a Connect RPC without the bunker's
  // secret, which strict bunkers (nsec.app, recent Amber) reject — and
  // connect()'s error path calls close(), destroying the subscription.
  const signer = await NostrConnectSigner.fromBunkerURI(url, {
    signer: clientSigner,
    onAuth,
    timeout: BUNKER_REQUEST_TIMEOUT,
    permissions: CONNECT_PERMISSIONS
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
 * Used only when a deployment configures no fallback relays: a
 * nostrconnect:// URI without relays cannot pair at all.
 */
const DEFAULT_CONNECT_RELAYS = ['wss://relay.damus.io', 'wss://relay.primal.net'];

/**
 * Build the list of relays for a client-initiated nostrconnect:// URI: the
 * deployment's fallback relays, deduplicated. The signer answers on the
 * relays the URI lists (Amber does). We used to force wss://relay.nsec.app
 * in as a "rendezvous relay"; it went dark in 2026-11, and a listed dead
 * relay costs QR size and, before firstAcceptedPublish, 30 s per request.
 *
 * @param {string[] | undefined | null} fallbackRelays
 * @returns {string[]}
 */
export function buildClientConnectRelays(fallbackRelays) {
  const fallback = Array.isArray(fallbackRelays) ? fallbackRelays.filter(Boolean) : [];
  return Array.from(new Set(fallback.length > 0 ? fallback : DEFAULT_CONNECT_RELAYS));
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

  useNostrConnectPool(pool);

  const signer = new NostrConnectSigner({
    relays,
    signer: clientSigner,
    // v6.2: `secret` deprecated in favor of connectSecret (client-initiated
    // nostrconnect:// flow)
    connectSecret: generateSecret(),
    onAuth,
    timeout: BUNKER_REQUEST_TIMEOUT
  });

  const uri = signer.getNostrConnectURI({ ...appMetadata, permissions: CONNECT_PERMISSIONS });

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
