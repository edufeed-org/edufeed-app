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
 * @property {string} [formRef] - Form template coordinate (new-spec: gates section when set)
 * @property {string} [formRefRelay] - Relay hint for the preferred-form a-tag
 * @property {{tier: 'all'}|{tier: 'members'}|{tier: 'role', role: string}} [access] - Publish tier (new-spec; omitted or 'all' → open)
 */

/**
 * @typedef {Object} CommunityFormData
 * @property {(string | {url: string, enforced: boolean})[]} relays - Global relays
 * @property {string[]} blossomServers
 * @property {string} location
 * @property {string} description
 * @property {string[]} [languages] - ISO-639-1 language codes (new-spec)
 * @property {string} [livekitUrl] - LiveKit operator URL for Meet rooms
 * @property {Record<string, ContentTypeFormData>} contentTypes
 */

/** Content type key → kind numbers
 * @type {Record<string, string[]>}
 */
const CONTENT_TYPE_KINDS = {
  calendar: ['31922', '31923', '31924'],
  chat: ['9'],
  articles: ['30023'],
  posts: ['1', '11'],
  wikis: ['30818'],
  learning: ['30142'],
  polls: ['1068'],
  bookmarks: ['39701'],
  meet: ['30312', '30313']
};

/** Content type key → default section display name
 * @type {Record<string, string>}
 */
const CONTENT_TYPE_NAMES = {
  calendar: 'Calendar',
  chat: 'Chat',
  articles: 'Articles',
  posts: 'Forum',
  wikis: 'Wikis',
  learning: 'Learning',
  polls: 'Polls',
  bookmarks: 'Social Bookmarks',
  meet: 'Meet'
};

/**
 * Build a fresh content-type state record for the community modals.
 * @param {string[]} [enabledKeys] - Content type keys to enable
 * @returns {Record<string, ContentTypeFormData & { formRef: string }>}
 */
export function createDefaultContentTypes(enabledKeys = []) {
  /** @type {Record<string, ContentTypeFormData & { formRef: string }>} */
  const result = {};
  for (const [key, name] of Object.entries(CONTENT_TYPE_NAMES)) {
    result[key] = {
      name,
      enabled: enabledKeys.includes(key),
      badges: { read: null, write: null },
      relays: [],
      formRef: '',
      access: { tier: 'all' }
    };
  }
  return result;
}

/**
 * Build tags array for a kind 10222 community definition event.
 *
 * @param {CommunityFormData} data - Form data from the modal
 * @param {{ communityPubkey?: string, membership?: {id: string, relay: string}, application?: {address: string, relay?: string|null} }} [opts] - When communityPubkey is set,
 *   writes new-spec tags (profile list a-tags, enforced relays, languages).
 *   When absent, writes old-spec tags (badge a-tags, per-section relays).
 *   membership and application are new-spec only; ignored in old-spec mode.
 * @returns {string[][]}
 */
export function buildCommunityDefinitionTags(data, opts = {}) {
  const { communityPubkey, membership, application } = opts;
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

  // LiveKit operator URL
  if (data.livekitUrl?.trim()) {
    tags.push(['livekit', data.livekitUrl.trim()]);
  }

  // Moderated-community pointers (communikey-groups NIP draft) — top-level,
  // and BEFORE the sections: section parsers absorb same-key tags positionally.
  if (isNewSpec && membership) {
    tags.push(['membership', membership.id, membership.relay]);
  }
  if (isNewSpec && application) {
    const applicationTag = ['application', application.address];
    if (application.relay) applicationTag.push(application.relay);
    tags.push(applicationTag);
  }

  // Strict content marker: the modals present the full content-type
  // vocabulary, so the sections below are an exhaustive, owner-reviewed
  // choice. Clients only filter navigation/creation UIs when this is present.
  tags.push(['strict', 'content']);

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

    // Publish tier per communikey-groups NIP draft (new-spec only)
    if (isNewSpec && ct.access && ct.access.tier !== 'all') {
      if (ct.access.tier === 'members') {
        tags.push(['access', 'members']);
      } else if (
        ct.access.tier === 'role' &&
        typeof ct.access.role === 'string' &&
        ct.access.role.trim()
      ) {
        tags.push(['access', 'role', ct.access.role.trim()]);
      }
    }

    if (isNewSpec && ct.formRef) {
      // New-spec: profile list a-tag per section (only when gated with a form)
      tags.push(['a', `30000:${communityPubkey}:${ct.name}`]);
      // Phase C: advertise the preferred form directly on the community event
      // so clients can discover it without loading the profile list.
      tags.push(['a', ct.formRef, ct.formRefRelay || '', 'form']);
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

/** Tag keys the community modals do not model — carried over verbatim on
 * every rebuild so an edit cannot silently drop a community's group,
 * membership engine, application form, or private-area pointer. */
const POINTER_TAG_KEYS = ['membership', 'application', 'concord', 'group'];

/**
 * Prepend the source event's pointer tags to a rebuilt tag array.
 * Prepended (not appended) so top-level pointers stay ahead of content
 * sections, which absorb same-key tags positionally.
 * @param {string[][]} sourceTags - tags of the event being edited
 * @param {string[][]} rebuiltTags - fresh output of buildCommunityDefinitionTags
 * @returns {string[][]}
 */
export function preservePointerTags(sourceTags, rebuiltTags) {
  const preserved = (Array.isArray(sourceTags) ? sourceTags : []).filter(
    (tag) => Array.isArray(tag) && POINTER_TAG_KEYS.includes(tag[0])
  );
  return [...preserved, ...rebuiltTags];
}
