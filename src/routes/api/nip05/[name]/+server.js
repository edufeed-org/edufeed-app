/**
 * Admin proxy: revoke a NIP-05 entry on the standalone service.
 *
 * Mirrors the POST proxy in ../+server.js but for DELETE /api/nip05/:name.
 * The browser caller (admin) signs a NIP-98 (kind 27235) event whose `u` tag
 * matches the full request URL; we verify the signature + admin allowlist,
 * then forward to the upstream nip-05-service with the server-held Bearer
 * token.
 */
import { env } from '$env/dynamic/private';
import { verifyEvent } from 'nostr-tools/pure';
import { json } from '@sveltejs/kit';

const TIMESTAMP_TOLERANCE_S = 60;

/**
 * @param {string | null} authHeader
 * @param {string} url
 * @param {string} method
 * @returns {Promise<string | null>}
 */
async function verifyNip98Header(authHeader, url, method) {
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

  return event.pubkey;
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function DELETE({ request, params, url }) {
  const serviceUrl = env.NIP05_SERVICE_URL;
  const serviceApiKey = env.NIP05_SERVICE_API_KEY;
  if (!serviceUrl || !serviceApiKey) {
    return json({ error: 'nip-05 service not configured' }, { status: 503 });
  }

  const signer = await verifyNip98Header(
    request.headers.get('authorization'),
    url.toString(),
    'DELETE'
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

  const name = params.name;
  if (!name) {
    return json({ error: 'name parameter required' }, { status: 400 });
  }

  const upstreamRes = await fetch(
    `${serviceUrl.replace(/\/$/, '')}/api/nip05/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${serviceApiKey}` }
    }
  );
  const upstreamBody = await upstreamRes.text();
  return new Response(upstreamBody, {
    status: upstreamRes.status,
    headers: {
      'content-type': upstreamRes.headers.get('content-type') || 'application/json'
    }
  });
}
