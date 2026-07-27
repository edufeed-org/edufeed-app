/**
 * Cordn groups runtime-config parsing. Mirrors the Concord gating contract:
 * with the feature disabled (or misconfigured) there must be zero Cordn UI and
 * zero Cordn network traffic.
 */

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Normalize the `cordnGroups` slice of /api/config. Enabled requires a valid
 * coordinator pubkey and at least one ws(s) relay; anything else parses to
 * disabled so a broken deployment fails closed.
 *
 * @param {{enabled?: boolean, coordinatorPubkey?: string, relays?: string[]} | undefined} raw
 * @returns {{enabled: boolean, coordinatorPubkey: string, relays: string[]}}
 */
export function parseCordnGroupsConfig(raw) {
  const coordinatorPubkey = typeof raw?.coordinatorPubkey === 'string' ? raw.coordinatorPubkey : '';
  const relays = (Array.isArray(raw?.relays) ? raw.relays : []).filter(
    (url) => typeof url === 'string' && /^wss?:\/\//.test(url)
  );
  const enabled = raw?.enabled === true && HEX64.test(coordinatorPubkey) && relays.length > 0;
  return { enabled, coordinatorPubkey, relays };
}
