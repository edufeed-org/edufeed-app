/**
 * GET /api/agent-config — what the desktop companion ("Edufeed Agent") needs
 * to know about this deployment, public and unauthenticated: where the groups
 * live, where NIP-46 pairing traffic goes, how the app is called, and where
 * the companion itself can be downloaded. 404 while AGENTS_ENABLED is off so
 * a companion pointed at a deployment without agents fails clearly.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { parseArray, parseBool } from '$lib/server/env-parse.js';

/** @param {{ url: URL }} event */
export function GET({ url }) {
  if (!parseBool(env.AGENTS_ENABLED, false)) {
    return new Response('Not Found', { status: 404 });
  }
  const groupsRelays = parseArray(env.GROUPS_RELAYS);
  return json({
    appName: env.APP_NAME || 'Edufeed',
    appUrl: url.origin,
    groupsRelays,
    pairingRelays: parseArray(env.AGENT_PAIRING_RELAYS, groupsRelays),
    downloadUrl: env.AGENT_DOWNLOAD_URL || null
  });
}
