/**
 * The companion pairs with the web app over NIP-46 (client-initiated): it
 * opens `<app>/agents/connect#<nostrconnect-uri>`, using the AGENT KEY as its
 * NIP-46 client key, so the client pubkey in the URI is the agent's pubkey.
 * This module only parses and builds that link; the provider lives in
 * pairing.svelte.js.
 */
import { parseNostrConnectURI } from 'applesauce-signers/helpers';

/**
 * @param {string} hash window.location.hash
 * @returns {{ok: true, uri: string, clientPubkey: string, relays: string[], secret: string, name: string} | {ok: false, error: 'missing' | 'invalid' | 'no-secret'}}
 */
export function parseConnectHash(hash) {
  let raw = (hash ?? '').replace(/^#/, '');
  if (!raw) return { ok: false, error: 'missing' };
  if (!raw.startsWith('nostrconnect://')) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return { ok: false, error: 'invalid' };
    }
  }
  if (!raw.startsWith('nostrconnect://')) return { ok: false, error: 'invalid' };

  /** @type {any} */
  let parsed;
  try {
    parsed = parseNostrConnectURI(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('missing secret')) return { ok: false, error: 'no-secret' };
    return { ok: false, error: 'invalid' };
  }

  const clientPubkey = String(parsed?.client ?? '').toLowerCase();
  const relays = Array.isArray(parsed?.relays)
    ? parsed.relays.filter((/** @type {unknown} */ r) => typeof r === 'string')
    : [];
  const secret =
    typeof parsed?.connectSecret === 'string'
      ? parsed.connectSecret
      : typeof parsed?.secret === 'string'
        ? parsed.secret
        : '';
  if (!secret) return { ok: false, error: 'no-secret' };
  const name = typeof parsed?.metadata?.name === 'string' ? parsed.metadata.name : '';

  return { ok: true, uri: raw, clientPubkey, relays, secret, name };
}

/** @param {string} uri */
export function connectPagePath(uri) {
  return '/agents/connect#' + encodeURIComponent(uri);
}
