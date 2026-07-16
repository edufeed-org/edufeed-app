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
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

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
 * @param {string} session
 * @param {string} operatorUrl
 * @returns {string}
 */
export function operatorToken(session, operatorUrl) {
  return bytesToHex(sha256(utf8.encode(`${session}:${operatorUrl}`)));
}
