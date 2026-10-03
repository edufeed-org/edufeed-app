/**
 * Connection status — is the app waiting on the network, on our servers or
 * on the user's signing app? (laoc, 2026-10-03: "I often don't know if the
 * app hangs or the internet is bad".) Pure derivation; the live inputs are
 * gathered by services/connection-status.svelte.js.
 *
 * Only the app's OWN relays count (app relay categories + the groups
 * relay): a public relay from someone's relay list being down is normal
 * Nostr weather, not something to worry the user with.
 */

/** @typedef {'ok' | 'degraded' | 'unreachable' | 'offline'} ConnectionLevel */
/**
 * @typedef {{kind: 'offline'}
 *   | {kind: 'relays', down: number, total: number, hosts: string[]}
 *   | {kind: 'signer'}} ConnectionReason
 */

/**
 * Host of a relay URL, lowercased; '' when unparseable. Community
 * endpoints (`wss://host/c/<root>`) are separate pool connections to the
 * same server, so health is judged per host.
 * @param {string} url
 * @returns {string}
 */
export function relayHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * @param {string[]} urls the app's own relays
 * @returns {Set<string>}
 */
export function coreHostsOf(urls) {
  return new Set(urls.map(relayHost).filter(Boolean));
}

/**
 * @param {{
 *   online: boolean,
 *   relays: Array<{url: string, failing: boolean}>,
 *   coreHosts: Set<string>,
 *   waitingForSigner: boolean
 * }} input `relays`: the pool's relays (only those in use are in the pool)
 * @returns {{level: ConnectionLevel, reasons: ConnectionReason[]}}
 */
export function deriveConnectionStatus({ online, relays, coreHosts, waitingForSigner }) {
  /** @type {ConnectionReason[]} */
  const reasons = [];
  /** @type {ConnectionLevel} */
  let level = 'ok';

  if (!online) {
    level = 'offline';
    reasons.push({ kind: 'offline' });
  } else {
    // A host is down when every endpoint of it we have open is failing.
    /** @type {Map<string, boolean>} host → all endpoints failing */
    const hosts = new Map();
    for (const r of relays) {
      const host = relayHost(r.url);
      if (!coreHosts.has(host)) continue;
      hosts.set(host, (hosts.get(host) ?? true) && r.failing);
    }
    const down = [...hosts].filter(([, failing]) => failing).map(([host]) => host);
    if (down.length > 0) {
      level = down.length === hosts.size ? 'unreachable' : 'degraded';
      reasons.push({ kind: 'relays', down: down.length, total: hosts.size, hosts: down.sort() });
    }
  }

  if (waitingForSigner) {
    if (level === 'ok') level = 'degraded';
    reasons.push({ kind: 'signer' });
  }
  return { level, reasons };
}
