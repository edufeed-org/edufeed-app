/**
 * Meet room event helpers
 * Parse, build, and inspect kind 30312 (room definition) events.
 */

/**
 * @typedef {Object} ParsedRoomEvent
 * @property {string} name
 * @property {string} summary
 * @property {'video'|'audio'} type
 * @property {string} status
 * @property {string} serviceUrl - LiveKit operator URL
 * @property {string} communityPubkey
 * @property {string} hostPubkey
 * @property {number|null} expiration - Unix timestamp or null
 * @property {any} event - Original event
 */

/**
 * Parse a kind 30312 room event into structured data.
 * @param {any} event
 * @returns {ParsedRoomEvent}
 */
export function parseRoomEvent(event) {
  const get = (/** @type {string} */ key) =>
    event.tags?.find((/** @type {string[]} */ t) => t[0] === key)?.[1] || '';

  const hostTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'p' && t[3] === 'host');

  const expStr = get('expiration');

  return {
    name: get('title'),
    summary: get('summary'),
    type: /** @type {'video'|'audio'} */ (get('type') || 'video'),
    status: get('status') || 'open',
    serviceUrl: get('service'),
    communityPubkey: get('h'),
    hostPubkey: hostTag?.[1] || '',
    expiration: expStr ? parseInt(expStr, 10) : null,
    event
  };
}

/**
 * Get the replaceable event coordinate for a room event.
 * @param {any} event
 * @returns {string} "30312:<pubkey>:<d-tag>"
 */
export function getRoomCoordinate(event) {
  const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

/**
 * Check if a room is currently active (status=open and not expired).
 * @param {any} event
 * @returns {boolean}
 */
export function isRoomActive(event) {
  const get = (/** @type {string} */ key) =>
    event.tags?.find((/** @type {string[]} */ t) => t[0] === key)?.[1] || '';

  const status = get('status') || 'open';
  if (status !== 'open') return false;

  const expStr = get('expiration');
  if (expStr) {
    const exp = parseInt(expStr, 10);
    if (exp <= Math.floor(Date.now() / 1000)) return false;
  }

  return true;
}

/**
 * Calculate time remaining until expiration.
 * @param {number|null|undefined} expiration - Unix timestamp
 * @returns {{ hours: number, minutes: number } | null} null if expired or no expiration
 */
export function formatTimeRemaining(expiration) {
  if (expiration == null) return null;
  const remaining = expiration - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return null;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  return { hours, minutes };
}

/**
 * Prune stale presence entries from a map.
 * @param {Map<string, number>} entries - pubkey → created_at (unix seconds)
 * @param {number} maxAge - max age in seconds
 * @returns {Map<string, number>} new map with only fresh entries
 */
export function pruneStalePresence(entries, maxAge) {
  const now = Math.floor(Date.now() / 1000);
  const result = new Map();
  for (const [pubkey, createdAt] of entries) {
    if (now - createdAt < maxAge) {
      result.set(pubkey, createdAt);
    }
  }
  return result;
}

/**
 * Build tags for a kind 30312 room event.
 * @param {Object} opts
 * @param {string} opts.name
 * @param {string} [opts.summary]
 * @param {'video'|'audio'} [opts.type]
 * @param {string} opts.communityPubkey
 * @param {string} opts.serviceUrl
 * @param {string} [opts.hostPubkey]
 * @param {number} [opts.duration] - Duration in seconds (for NIP-40 expiration)
 * @returns {string[][]}
 */
export function buildRoomEventTags(opts) {
  const dTag = crypto.randomUUID().slice(0, 8);
  /** @type {string[][]} */
  const tags = [
    ['d', dTag],
    ['title', opts.name],
    ['type', opts.type || 'video'],
    ['status', 'open'],
    ['service', opts.serviceUrl],
    ['h', opts.communityPubkey]
  ];

  if (opts.summary) {
    tags.push(['summary', opts.summary]);
  }

  if (opts.hostPubkey) {
    tags.push(['p', opts.hostPubkey, '', 'host']);
  }

  if (opts.duration) {
    const expiration = Math.floor(Date.now() / 1000) + opts.duration;
    tags.push(['expiration', String(expiration)]);
  }

  return tags;
}
