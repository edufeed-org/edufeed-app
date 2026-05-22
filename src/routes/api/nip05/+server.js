/**
 * Admin proxy to the standalone nip-05-service.
 *
 * Browser caller is the edufeed admin: they sign a NIP-98 (kind 27235) event,
 * we verify the signature + that the signer is in MEMBERSHIP_ADMIN_PUBKEYS,
 * then we forward to the nip-05-service with its server-held Bearer token.
 *
 * The nip-05-service has no concept of Nostr auth — it uses Bearer tokens
 * and lives behind its own admin auth. This endpoint is the bridge: it lets
 * the edufeed admin approve handles in-app without exposing the upstream
 * API key to the browser.
 */
import { env } from '$env/dynamic/private';
import { verifyEvent } from 'nostr-tools/pure';
import { json } from '@sveltejs/kit';

const TIMESTAMP_TOLERANCE_S = 60;

/**
 * @param {string} str
 * @returns {Promise<string>}
 */
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a NIP-98 Authorization header against the request URL, method, and
 * raw body string. Returns the signer pubkey on success, or null on any
 * failure. Hashes the **raw body string** the client sent (matches what
 * `createNIP98AuthHeader` does in `src/lib/helpers/nip98.js`); using
 * `nip98.validateEvent` here would re-stringify the parsed body and produce
 * a different hash.
 *
 * @param {string | null} authHeader
 * @param {string} url
 * @param {string} method
 * @param {string} rawBody
 * @returns {Promise<string | null>}
 */
async function verifyNip98Header(authHeader, url, method, rawBody) {
  if (!authHeader?.startsWith('Nostr ')) return null;
  let event;
  try {
    event = JSON.parse(atob(authHeader.slice(6)));
  } catch {
    return null;
  }
  if (!event || event.kind !== 27235) return null;
  if (!verifyEvent(event)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - (event.created_at ?? 0)) > TIMESTAMP_TOLERANCE_S) return null;

  const uTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'u');
  if (!uTag || uTag[1] !== url) return null;

  const methodTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'method');
  if (!methodTag || methodTag[1].toUpperCase() !== method.toUpperCase()) return null;

  if (rawBody) {
    const payloadTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'payload');
    if (!payloadTag) return null;
    const expected = await sha256Hex(rawBody);
    if (payloadTag[1] !== expected) return null;
  }

  return event.pubkey;
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request, url }) {
  const serviceUrl = env.NIP05_SERVICE_URL;
  const serviceApiKey = env.NIP05_SERVICE_API_KEY;
  if (!serviceUrl || !serviceApiKey) {
    return json({ error: 'nip-05 service not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const signer = await verifyNip98Header(
    request.headers.get('authorization'),
    url.toString(),
    'POST',
    rawBody
  );
  if (!signer) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allowed = (env.MEMBERSHIP_ADMIN_PUBKEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(signer)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const upstreamRes = await fetch(`${serviceUrl.replace(/\/$/, '')}/api/nip05`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceApiKey}`,
      'Content-Type': 'application/json'
    },
    body: rawBody
  });
  const upstreamBody = await upstreamRes.text();
  return new Response(upstreamBody, {
    status: upstreamRes.status,
    headers: { 'content-type': upstreamRes.headers.get('content-type') || 'application/json' }
  });
}
