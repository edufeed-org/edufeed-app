/**
 * Cordn groups runtime-config parsing. Mirrors the Concord gating contract:
 * with the feature disabled (or misconfigured) there must be zero Cordn UI and
 * zero Cordn network traffic.
 */

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Normalize the `cordnGroups` slice of /api/config. Enabled requires at least
 * one valid coordinator pubkey and one ws(s) relay; anything else parses to
 * disabled so a broken deployment fails closed. Order is preserved — the
 * first coordinator is the default (and the migration target for group
 * records stored before multi-coordinator support).
 *
 * @param {{enabled?: boolean, coordinatorPubkeys?: string[], relays?: string[]} | undefined} raw
 * @returns {{enabled: boolean, coordinatorPubkeys: string[], relays: string[]}}
 */
export function parseCordnGroupsConfig(raw) {
  const coordinatorPubkeys = [
    ...new Set(
      (Array.isArray(raw?.coordinatorPubkeys) ? raw.coordinatorPubkeys : []).filter((pk) =>
        HEX64.test(typeof pk === 'string' ? pk : '')
      )
    )
  ];
  const relays = (Array.isArray(raw?.relays) ? raw.relays : []).filter(
    (url) => typeof url === 'string' && /^wss?:\/\//.test(url)
  );
  const enabled = raw?.enabled === true && coordinatorPubkeys.length > 0 && relays.length > 0;
  return { enabled, coordinatorPubkeys, relays };
}
