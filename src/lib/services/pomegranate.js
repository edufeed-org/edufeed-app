/**
 * Pomegranate — client for the promenade FROST threshold-signer protocol
 * ("Login with Google"). Ported from Jumble's pomegranate.service.ts.
 *
 * Flow: a random Nostr key is generated in the browser, split into FROST
 * shards (trusted dealer) and distributed to independent operator servers.
 * Google OAuth (run by the central server in a popup) only proves identity
 * for registration, login lookup, and shard recovery. After setup the account
 * is an ordinary NIP-46 bunker account; the central server coordinates
 * threshold partial signatures.
 *
 * Spec: docs/superpowers/specs/2026-07-16-google-and-npub-login-design.md
 */
// NOTE: do not add a top-level `@noble/hashes` dependency here. A hoisted
// @noble/hashes v2 shadows the bare `@noble/hashes/utils` imports that
// bundled SSR chunks (via nostr-tools/applesauce) resolve at runtime — v2
// only exports .js-suffixed subpaths, which 500s the whole server (CI smoke
// test caught this). Hex helpers come from nostr-tools' re-export instead,
// and sha256 uses WebCrypto.
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { nsecEncode } from 'nostr-tools/nip19';
import {
  aggregateSecretKeyShards,
  decodeShard,
  hexPubShard,
  hexShard,
  trustedKeyDeal
} from '@fiatjaf/promenade-trusted-dealer';

/** A Google auth token is valid for 24h on the central server. */
const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const utf8 = new TextEncoder();

/** Nostr event kinds for the pomegranate registration protocol. */
export const KIND_ACCOUNT_REGISTRATION = 20445;
export const KIND_OPERATOR_REGISTRATION = 20444;

/**
 * @typedef {{ url: string, pubshard: string }} PomegranateOperator
 * @typedef {{ email: string, pubkey: string, operators: PomegranateOperator[], threshold: number }} PomegranateAccount
 * @typedef {{ handler_pubkey: string, name: string, email: string }} PomegranateProfile
 * @typedef {{ raw: string, email: string, createdAt: number }} GoogleToken
 */

/** The browser blocked `window.open` — usually a popup-blocker setting. */
export class PomegranatePopupBlockedError extends Error {
  constructor() {
    super('Popup was blocked');
    this.name = 'PomegranatePopupBlockedError';
  }
}

/** The user closed the popup before it posted a result back. */
export class PomegranatePopupClosedError extends Error {
  constructor() {
    super('Popup was closed');
    this.name = 'PomegranatePopupClosedError';
  }
}

/** The Google account is linked to a different pubkey than expected. */
export class PomegranatePubkeyMismatchError extends Error {
  constructor() {
    super('This Google account is linked to a different Nostr account');
    this.name = 'PomegranatePubkeyMismatchError';
  }
}

/**
 * Normalize a URL to its origin (drops path, trailing slash; bare hosts get
 * https://, localhost gets http://).
 * @param {string} input
 * @returns {string}
 */
export function massageURL(input) {
  let url = input.trim();
  if (!url.startsWith('http')) {
    url = 'http' + (url.startsWith('localhost') ? '' : 's') + '://' + url;
  }
  return new URL(url).origin;
}

/**
 * Default FROST signing threshold for a given operator count.
 * @param {number} operatorCount
 * @returns {number}
 */
export function defaultThreshold(operatorCount) {
  return Math.ceil((operatorCount * 7) / 12);
}

/**
 * Decode + validate the base64 identity token posted back by the central
 * server's Google popup (a Nostr-event-shaped JSON with created_at + email tag).
 * @param {string} raw
 * @returns {GoogleToken}
 */
export function decodeGoogleToken(raw) {
  let createdAt = null;
  let email = '';
  try {
    const parsed = JSON.parse(atob(raw));
    if (typeof parsed.created_at === 'number') {
      createdAt = parsed.created_at * 1000;
    }
    if (Array.isArray(parsed.tags)) {
      const emailTag = parsed.tags.find(
        /** @param {any} tag */ (tag) => Array.isArray(tag) && tag.length > 1 && tag[0] === 'email'
      );
      email = typeof emailTag?.[1] === 'string' ? emailTag[1] : '';
    }
  } catch {
    throw new Error('Invalid Google sign-in token');
  }
  if (createdAt === null || Date.now() - createdAt > TOKEN_MAX_AGE_MS) {
    throw new Error('Google sign-in token expired, please try again');
  }
  return { raw, email, createdAt };
}

/**
 * Build the NIP-46 bunker URL for a signing profile; the central server
 * doubles as the NIP-46 relay.
 * @param {string} central - massaged central origin
 * @param {PomegranateProfile} profile
 * @returns {string}
 */
export function buildBunkerUrl(central, profile) {
  const relay = central.replace(/^http/, 'ws');
  return `bunker://${profile.handler_pubkey}?relay=${encodeURIComponent(relay)}`;
}

/**
 * Correlation token sent to each operator during registration.
 * Async because it hashes via WebCrypto (see the note on the imports above).
 * @param {string} session
 * @param {string} operatorUrl
 * @returns {Promise<string>}
 */
export async function operatorToken(session, operatorUrl) {
  const digest = await crypto.subtle.digest('SHA-256', utf8.encode(`${session}:${operatorUrl}`));
  return bytesToHex(new Uint8Array(digest));
}

/** How long to wait for a popup (Google sign-in / shard recovery) to post back. */
const POPUP_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
async function apiJson(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * GET /account — the pomegranate account registered for this Google identity,
 * or null when none exists yet.
 * @param {string} central - massaged origin
 * @param {GoogleToken} token
 * @returns {Promise<PomegranateAccount | null>}
 */
export async function getPomegranateAccount(central, token) {
  const res = await apiJson(`${central}/account`, {
    headers: { Authorization: `Token ${token.raw}` }
  });
  if (res.status === 401) {
    throw new Error('Google session expired, please sign in again');
  }
  if (res.ok && res.data && res.data.pubkey) {
    return res.data;
  }
  if (res.ok || res.status === 404) {
    // Deliberate "no account" responses: a 200 without a pubkey, or an
    // explicit 404. Anything else below is a transient/server failure and
    // must NOT be treated as "no account" — that would route an existing
    // user into new-account creation and orphan their real identity.
    return null;
  }
  throw new Error('Could not check your account status, please try again');
}

/**
 * Create a new account: split the key into FROST shards (trusted dealer) and
 * register with the central server + every operator. The key signs the
 * registration events but is never persisted here.
 * @param {string} central - massaged origin
 * @param {GoogleToken} token
 * @param {{ operators: string[], threshold: number, secretKey: Uint8Array }} config
 */
export async function createPomegranateAccount(central, token, config) {
  const operators = config.operators.map(massageURL);
  if (operators.length < 2) {
    throw new Error('At least 2 operators are required');
  }
  const threshold = config.threshold;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > operators.length) {
    throw new Error('Invalid signing threshold');
  }
  const session = crypto.randomUUID();

  const secretKey = config.secretKey;
  const masterSk = BigInt('0x' + bytesToHex(secretKey));
  const { shards } = trustedKeyDeal(masterSk, threshold, operators.length);

  // Register the account with the central server (kind 20445).
  const regEvent = finalizeEvent(
    {
      kind: KIND_ACCOUNT_REGISTRATION,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['threshold', String(threshold)],
        ...operators.map((op, i) => ['operator', op, hexPubShard(shards[i].pubShard)])
      ],
      content: ''
    },
    secretKey
  );
  const regRes = await fetch(`${central}/register`, {
    method: 'POST',
    body: JSON.stringify(regEvent),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token.raw}`,
      'X-Pomegranate-Session': session
    }
  });
  if (regRes.status !== 200) {
    throw new Error('Central server registration failed');
  }

  // Register with every operator in parallel (kind 20444, one shard each).
  // A few may fail; the account works while ≥ threshold operators hold shards.
  const failed = (
    await Promise.all(
      operators.map(async (operator, i) => {
        const event = finalizeEvent(
          {
            kind: KIND_OPERATOR_REGISTRATION,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['central', central],
              ['email', token.email]
            ],
            content: hexShard(shards[i])
          },
          secretKey
        );
        try {
          const opRes = await fetch(`${operator}/po/register`, {
            method: 'POST',
            body: JSON.stringify(event),
            headers: {
              'Content-Type': 'application/json',
              'X-Pomegranate-Operator-Token': await operatorToken(session, operator)
            }
          });
          if (opRes.ok) return null;
          console.warn(`[pomegranate] operator registration failed: ${operator} (${opRes.status})`);
          return operator;
        } catch (err) {
          console.warn(`[pomegranate] operator registration error: ${operator}`, err);
          return operator;
        }
      })
    )
  ).filter((url) => url !== null);

  const registered = operators.length - failed.length;
  if (registered < threshold) {
    throw new Error(
      `Could not register with enough operators (${registered}/${threshold}). Please try again.`
    );
  }
}

/**
 * GET /profiles, creating a "default" one when none exists.
 * @param {string} central
 * @param {GoogleToken} token
 * @returns {Promise<PomegranateProfile>}
 */
export async function ensureProfile(central, token) {
  const list = await apiJson(`${central}/profiles`, {
    headers: { Authorization: `Token ${token.raw}` }
  });
  if (!list.ok || !Array.isArray(list.data)) {
    throw new Error('Failed to load signing profiles');
  }
  if (list.data.length > 0) return list.data[0];

  const created = await fetch(`${central}/profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token.raw}`
    },
    body: JSON.stringify({ name: 'default' })
  });
  if (!created.ok) {
    throw new Error('Signing profile creation failed');
  }
  let profile = null;
  try {
    profile = JSON.parse(await created.text());
  } catch {
    /* fall through */
  }
  if (!profile?.handler_pubkey || !/^[0-9a-f]{64}$/i.test(profile.handler_pubkey)) {
    throw new Error('Signing profile creation did not complete');
  }
  return profile;
}

/**
 * First login half: open the Google popup at the central server (call from a
 * user gesture) and report whether an account already exists.
 * @param {string} centralUrl
 * @returns {Promise<{ token: GoogleToken, hasAccount: boolean }>}
 */
export async function startGoogleLogin(centralUrl) {
  const central = massageURL(centralUrl);
  const popup = openPopup(`${central}/login/google`, 'PomegranateLogin');
  const raw = await awaitPopupMessage(popup, central, (data) =>
    data && typeof data === 'object' && typeof data.token === 'string' ? data.token : undefined
  );
  const token = decodeGoogleToken(raw);
  const account = await getPomegranateAccount(central, token);
  return { token, hasAccount: !!account };
}

/**
 * Second login half. Pass `config` ({operators, threshold, secretKey}) to
 * create a new account, or null for an existing one. Opens no popup.
 * @param {string} centralUrl
 * @param {GoogleToken} token
 * @param {{ operators: string[], threshold: number, secretKey: Uint8Array } | null} config
 * @returns {Promise<{ bunkerUrl: string, central: string }>}
 */
export async function finishGoogleLogin(centralUrl, token, config) {
  const central = massageURL(centralUrl);
  if (config) {
    await createPomegranateAccount(central, token, config);
  }
  const profile = await ensureProfile(central, token);
  return { bunkerUrl: buildBunkerUrl(central, profile), central };
}

/**
 * Authenticate with Google and load the pomegranate account for the nsec
 * export flow. Throws PomegranatePubkeyMismatchError when the Google account
 * maps to a different pubkey than the locally active one.
 * @param {string} centralUrl
 * @param {string} expectedPubkey
 * @returns {Promise<{ token: GoogleToken, account: PomegranateAccount }>}
 */
export async function startRecovery(centralUrl, expectedPubkey) {
  const central = massageURL(centralUrl);
  const popup = openPopup(`${central}/login/google`, 'PomegranateLogin');
  const raw = await awaitPopupMessage(popup, central, (data) =>
    data && typeof data === 'object' && typeof data.token === 'string' ? data.token : undefined
  );
  const token = decodeGoogleToken(raw);
  const account = await getPomegranateAccount(central, token);
  if (!account) {
    throw new Error('No pomegranate account found for this Google login');
  }
  if (account.pubkey !== expectedPubkey) {
    throw new PomegranatePubkeyMismatchError();
  }
  return { token, account };
}

/**
 * Recover one secret-key shard from one operator (popup re-proves the Google
 * identity to that operator). Call from a user gesture.
 * @param {PomegranateOperator} operator
 * @returns {Promise<string>}
 */
export async function recoverShard(operator) {
  const operatorURL = massageURL(operator.url);
  const popup = openPopup(`${operatorURL}/po/recover/google`, 'PomegranateRecover');
  const shard = await awaitPopupMessage(popup, operatorURL, (data) =>
    typeof data === 'string' ? data : undefined
  );
  if (!shard.startsWith(operator.pubshard)) {
    throw new Error('Recovered shard does not match the operator');
  }
  return shard;
}

/**
 * Aggregate ≥threshold recovered shards back into the secret key.
 * @param {string[]} shards
 * @param {string} expectedPubkey
 * @returns {string} nsec
 */
export function aggregateNsec(shards, expectedPubkey) {
  const secret = aggregateSecretKeyShards(shards.map(hexToBytes).map(decodeShard));
  const secretKey = hexToBytes(secret.toString(16).padStart(64, '0'));
  if (getPublicKey(secretKey) !== expectedPubkey) {
    throw new Error('Recovered key does not match the account');
  }
  return nsecEncode(secretKey);
}

/**
 * @param {string} url
 * @param {string} name
 * @returns {Window}
 */
function openPopup(url, name) {
  const width = 600;
  const height = 700;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  const popup = window.open(
    url,
    name,
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`
  );
  if (!popup) throw new PomegranatePopupBlockedError();
  return popup;
}

/**
 * Resolve with the first message posted by `popup` from `expectedOrigin` for
 * which `extract` returns a defined value. Rejects on close or timeout.
 * @template T
 * @param {Window} popup
 * @param {string} expectedOrigin
 * @param {(data: any) => T | undefined} extract
 * @returns {Promise<T>}
 */
function awaitPopupMessage(popup, expectedOrigin, extract) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closeMonitor);
      window.clearTimeout(timer);
    };
    /** @param {MessageEvent} event */
    const onMessage = (event) => {
      if (event.origin !== expectedOrigin || event.source !== popup) return;
      const value = extract(event.data);
      if (value === undefined) return;
      cleanup();
      popup.close();
      resolve(value);
    };
    const closeMonitor = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new PomegranatePopupClosedError());
      }
    }, 300);
    const timer = window.setTimeout(() => {
      cleanup();
      popup.close();
      reject(new Error('Timed out waiting for the popup'));
    }, POPUP_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
  });
}

// generateSecretKey is re-exported for the login UI so it doesn't import
// nostr-tools separately for this one call.
export { generateSecretKey };
