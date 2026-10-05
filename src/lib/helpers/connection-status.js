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
 *   | {kind: 'relays', down: number, total: number, servers: Array<{host: string, categories: string[]}>}
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
 * The app's own relays, per host, with what each serves.
 * @param {Record<string, string[]>} byCategory category → relay URLs
 * @returns {Map<string, string[]>} host → categories (sorted)
 */
export function coreHostsOf(byCategory) {
  /** @type {Map<string, Set<string>>} */
  const hosts = new Map();
  for (const [category, urls] of Object.entries(byCategory)) {
    for (const url of urls ?? []) {
      const host = relayHost(url);
      if (!host) continue;
      if (!hosts.has(host)) hosts.set(host, new Set());
      hosts.get(host)?.add(category);
    }
  }
  return new Map([...hosts].map(([host, cats]) => [host, [...cats].sort()]));
}

/**
 * @param {{
 *   online: boolean,
 *   relays: Array<{url: string, failing: boolean}>,
 *   coreHosts: Map<string, string[]>,
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
      reasons.push({
        kind: 'relays',
        down: down.length,
        total: hosts.size,
        servers: down.sort().map((host) => ({ host, categories: coreHosts.get(host) ?? [] }))
      });
    }
  }

  if (waitingForSigner) {
    if (level === 'ok') level = 'degraded';
    reasons.push({ kind: 'signer' });
  }
  return { level, reasons };
}

/** @typedef {'connected' | 'failing' | 'idle'} ServerState */

/**
 * Every app server with its state, for the connection details: `failing`
 * when every open endpoint of the host fails (as in deriveConnectionStatus),
 * `connected` when one is open, `idle` when the app has not needed it yet
 * (or applesauce closed it after use). Failing first, then by host.
 * @param {{
 *   relays: Array<{url: string, failing: boolean, connected?: boolean}>,
 *   coreHosts: Map<string, string[]>
 * }} input
 * @returns {Array<{host: string, categories: string[], state: ServerState}>}
 */
export function describeServers({ relays, coreHosts }) {
  /** @type {Map<string, {failing: boolean, connected: boolean}>} */
  const seen = new Map();
  for (const r of relays) {
    const host = relayHost(r.url);
    if (!coreHosts.has(host)) continue;
    const prev = seen.get(host) ?? { failing: true, connected: false };
    seen.set(host, {
      failing: prev.failing && r.failing,
      connected: prev.connected || !!r.connected
    });
  }
  /** @type {Record<ServerState, number>} */
  const order = { failing: 0, connected: 1, idle: 2 };
  return [...coreHosts]
    .map(([host, categories]) => {
      const s = seen.get(host);
      /** @type {ServerState} */
      const state = !s ? 'idle' : s.failing ? 'failing' : s.connected ? 'connected' : 'idle';
      return { host, categories, state };
    })
    .sort((a, b) => order[a.state] - order[b.state] || a.host.localeCompare(b.host));
}
