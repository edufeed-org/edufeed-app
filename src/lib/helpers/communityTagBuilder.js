/**
 * Community Tag Builder
 * Shared tag-building logic for CreateCommunityModal and EditCommunityModal.
 * Supports both old-spec (badge a-tags, per-section relays) and new-spec
 * (profile list a-tags, enforced relays, languages).
 */

/**
 * @typedef {Object} ContentTypeFormData
 * @property {string} name - Display name (e.g. 'Calendar', 'Chat')
 * @property {boolean} enabled
 * @property {{read: string|null, write: string|null}} badges - Old-spec badge addresses
 * @property {string[]} relays - Per-section relays (old-spec only)
 */

/**
 * @typedef {Object} CommunityFormData
 * @property {(string | {url: string, enforced: boolean})[]} relays - Global relays
 * @property {string[]} blossomServers
 * @property {string} location
 * @property {string} description
 * @property {string[]} [languages] - ISO-639-1 language codes (new-spec)
 * @property {Record<string, ContentTypeFormData>} contentTypes
 */

/** Content type key → kind numbers
 * @type {Record<string, string[]>}
 */
const CONTENT_TYPE_KINDS = {
  calendar: ['31922', '31923'],
  chat: ['9'],
  articles: ['30023'],
  posts: ['1', '11'],
  wikis: ['30818']
};

/**
 * Build tags array for a kind 10222 community definition event.
 *
 * @param {CommunityFormData} data - Form data from the modal
 * @param {{ communityPubkey?: string }} [opts] - When communityPubkey is set,
 *   writes new-spec tags (profile list a-tags, enforced relays, languages).
 *   When absent, writes old-spec tags (badge a-tags, per-section relays).
 * @returns {string[][]}
 */
export function buildCommunityDefinitionTags(data, opts = {}) {
  const { communityPubkey } = opts;
  const isNewSpec = !!communityPubkey;

  /** @type {string[][]} */
  const tags = [];

  // ── Global metadata (before content sections) ──

  // Relays
  for (const relay of data.relays) {
    if (typeof relay === 'string') {
      tags.push(['r', relay]);
    } else {
      if (isNewSpec && relay.enforced) {
        tags.push(['r', relay.url, 'enforced']);
      } else {
        tags.push(['r', relay.url]);
      }
    }
  }

  // Blossom servers
  for (const server of data.blossomServers) {
    tags.push(['blossom', server]);
  }

  // Location
  if (data.location?.trim()) {
    tags.push(['location', data.location.trim()]);
  }

  // Description
  if (data.description?.trim()) {
    tags.push(['description', data.description.trim()]);
  }

  // Languages (new-spec only)
  if (isNewSpec && data.languages) {
    for (const lang of data.languages) {
      tags.push(['l', lang, 'ISO-639-1']);
    }
  }

  // ── Content sections ──

  for (const [key, ct] of Object.entries(data.contentTypes)) {
    if (!ct.enabled) continue;

    tags.push(['content', ct.name]);

    // Kind tags
    const kinds = CONTENT_TYPE_KINDS[key];
    if (kinds) {
      for (const k of kinds) {
        tags.push(['k', k]);
      }
    }

    if (isNewSpec) {
      // New-spec: profile list a-tag per section
      tags.push(['a', `30000:${communityPubkey}:${ct.name}`]);
    } else {
      // Old-spec: badge a-tags
      if (ct.badges.write) {
        tags.push(['a', ct.badges.write, 'write']);
      }
      if (ct.badges.read) {
        tags.push(['a', ct.badges.read, 'read']);
      }

      // Old-spec: per-section relays
      for (const r of ct.relays) {
        tags.push(['r', r, 'content']);
      }
    }
  }

  return tags;
}
