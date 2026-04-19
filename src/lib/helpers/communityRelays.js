/**
 * Community Relays Helper
 * Utilities for getting the appropriate relays for different content types within a community
 */

/**
 * @typedef {Object} ContentTypeConfig
 * @property {string} name
 * @property {number[]} kinds
 * @property {boolean} exclusive
 * @property {string[]} roles
 * @property {{amount: string, unit: string}=} fee
 * @property {{read: string|null, write: string|null}} badges
 * @property {string[]} relays
 * @property {string|null} profileList - Profile list address: "30000:pubkey:d-tag" (new spec)
 * @property {string|null} profileListRelay - Relay hint for the profile list (new spec)
 * @property {string|null} formRef - Preferred form address: "30168:pubkey:d-tag" (form-driven authoring)
 * @property {string|null} formRefRelay - Relay hint for the preferred form
 */

/**
 * @typedef {Object} CommunityMetadata
 * @property {{ url: string, enforced: boolean }[]} relays
 * @property {string[]} blossomServers
 * @property {string[]} mints
 * @property {string|null} tos
 * @property {string|null} location
 * @property {string|null} geohash
 * @property {string[]} languages
 * @property {string|null} livekitUrl
 */

/**
 * Parse content types from a community event.
 * Supports both old-spec tags (badges, exclusive, fee, roles, per-section relays)
 * and new-spec tags (profile list a-tags).
 * @param {any} event - The kind 10222 community event
 * @returns {ContentTypeConfig[]}
 */
export function parseCommunityContentTypes(event) {
  /** @type {ContentTypeConfig[]} */
  const contentTypes = [];
  /** @type {ContentTypeConfig|null} */
  let currentContentType = null;

  if (!event || !Array.isArray(event.tags)) return contentTypes;

  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.length === 0) continue;
    const key = tag[0];

    if (key === 'content') {
      if (currentContentType) contentTypes.push(currentContentType);
      currentContentType = {
        name: tag[1],
        kinds: [],
        exclusive: false,
        roles: [],
        badges: { read: null, write: null },
        relays: [],
        profileList: null,
        profileListRelay: null,
        formRef: null,
        formRefRelay: null
      };
    } else if (key === 'k' && currentContentType) {
      const kind = parseInt(tag[1], 10);
      if (!Number.isNaN(kind)) currentContentType.kinds.push(kind);
    } else if (key === 'fee' && currentContentType) {
      currentContentType.fee = { amount: tag[1], unit: tag[2] || 'sat' };
    } else if (key === 'exclusive' && currentContentType) {
      currentContentType.exclusive = tag[1] === 'true';
    } else if (key === 'role' && currentContentType) {
      currentContentType.roles = tag.slice(1);
    } else if (key === 'a' && currentContentType && tag[1]?.startsWith('30009:')) {
      const qualifier = tag[2] || 'write';
      if (qualifier === 'read') {
        currentContentType.badges.read = tag[1];
      } else {
        currentContentType.badges.write = tag[1];
      }
    } else if (key === 'a' && currentContentType && tag[1]?.startsWith('30000:')) {
      currentContentType.profileList = tag[1];
      currentContentType.profileListRelay = tag[2] || null;
    } else if (
      key === 'a' &&
      currentContentType &&
      tag[1]?.startsWith('30168:') &&
      tag[3] === 'form'
    ) {
      // Only the first form-marked 30168 a-tag per content section is recorded.
      if (!currentContentType.formRef) {
        currentContentType.formRef = tag[1];
        currentContentType.formRefRelay = tag[2] || null;
      }
    } else if (key === 'r' && currentContentType && tag[2] === 'content') {
      currentContentType.relays.push(tag[1]);
    }
  }

  if (currentContentType) contentTypes.push(currentContentType);
  return contentTypes;
}

/**
 * Parse global community metadata from a kind 10222 event.
 * Only parses tags before the first 'content' section.
 * @param {any} event - The kind 10222 community event
 * @returns {CommunityMetadata}
 */
export function parseCommunityMetadata(event) {
  /** @type {CommunityMetadata} */
  const metadata = {
    relays: [],
    blossomServers: [],
    mints: [],
    tos: null,
    location: null,
    geohash: null,
    languages: [],
    livekitUrl: null
  };

  if (!event || !Array.isArray(event.tags)) return metadata;

  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.length === 0) continue;
    const key = tag[0];
    if (key === 'content') break;

    if (key === 'r') {
      metadata.relays.push({ url: tag[1], enforced: tag[2] === 'enforced' });
    } else if (key === 'blossom') {
      metadata.blossomServers.push(tag[1]);
    } else if (key === 'mint') {
      metadata.mints.push(tag[1]);
    } else if (key === 'tos') {
      metadata.tos = tag[1];
    } else if (key === 'location') {
      metadata.location = tag[1];
    } else if (key === 'g') {
      metadata.geohash = tag[1];
    } else if (key === 'l' && tag[2] === 'ISO-639-1') {
      metadata.languages.push(tag[1]);
    } else if (key === 'livekit') {
      metadata.livekitUrl = tag[1];
    }
  }

  return metadata;
}

/**
 * Get global community relays (r tags without 'content' marker)
 * @param {any} communityEvent - The kind 10222 community event
 * @returns {string[]} Array of relay URLs
 */
export function getCommunityGlobalRelays(communityEvent) {
  if (!communityEvent || !Array.isArray(communityEvent.tags)) {
    return [];
  }

  return communityEvent.tags
    .filter((/** @type {string[]} */ t) => t[0] === 'r' && t[2] !== 'content')
    .map((/** @type {string[]} */ t) => t[1]);
}

/**
 * Get relays for a specific content kind within a community
 * Returns content-specific relays if defined, otherwise falls back to community global relays
 *
 * @param {any} communityEvent - The kind 10222 community event
 * @param {number} kind - The event kind to get relays for
 * @returns {string[]} Array of relay URLs to use
 */
export function getRelaysForKind(communityEvent, kind) {
  if (!communityEvent) {
    return [];
  }

  const contentTypes = parseCommunityContentTypes(communityEvent);
  const contentType = contentTypes.find((ct) => ct.kinds.includes(kind));

  // Use content-specific relays if defined
  if (contentType && contentType.relays && contentType.relays.length > 0) {
    return contentType.relays;
  }

  // Fall back to community's global relays
  return getCommunityGlobalRelays(communityEvent);
}

/**
 * Get relays for a specific content type by name
 *
 * @param {any} communityEvent - The kind 10222 community event
 * @param {string} contentTypeName - The content type name (e.g., 'Calendar', 'Chat')
 * @returns {string[]} Array of relay URLs to use
 */
export function getRelaysForContentType(communityEvent, contentTypeName) {
  if (!communityEvent) {
    return [];
  }

  const contentTypes = parseCommunityContentTypes(communityEvent);
  const contentType = contentTypes.find(
    (ct) => ct.name.toLowerCase() === contentTypeName.toLowerCase()
  );

  // Use content-specific relays if defined
  if (contentType && contentType.relays && contentType.relays.length > 0) {
    return contentType.relays;
  }

  // Fall back to community's global relays
  return getCommunityGlobalRelays(communityEvent);
}

/**
 * Get all unique relays from a community (both global and content-specific)
 *
 * @param {any} communityEvent - The kind 10222 community event
 * @returns {string[]} Array of all unique relay URLs
 */
export function getAllCommunityRelays(communityEvent) {
  if (!communityEvent || !Array.isArray(communityEvent.tags)) {
    return [];
  }

  const allRelays = new Set();

  // Add global relays
  for (const relay of getCommunityGlobalRelays(communityEvent)) {
    allRelays.add(relay);
  }

  // Add content-specific relays
  const contentTypes = parseCommunityContentTypes(communityEvent);
  for (const ct of contentTypes) {
    for (const relay of ct.relays || []) {
      allRelays.add(relay);
    }
  }

  return Array.from(allRelays);
}

/**
 * Get community relays split by enforcement status
 * @param {any} communityEvent - The kind 10222 community event
 * @returns {{ enforced: string[], open: string[] }}
 */
export function getCommunityRelaysByEnforcement(communityEvent) {
  const metadata = parseCommunityMetadata(communityEvent);
  return {
    enforced: metadata.relays.filter((r) => r.enforced).map((r) => r.url),
    open: metadata.relays.filter((r) => !r.enforced).map((r) => r.url)
  };
}

/**
 * Get the community's preferred form for a given content kind.
 * Walks the content sections in order and returns the formRef of the first
 * section that includes the kind and declares a form-marked a-tag.
 *
 * @param {any} communityEvent - The kind 10222 community event
 * @param {number} kind - The event kind to resolve a form for
 * @returns {{ address: string, relay: string } | null}
 */
export function getPreferredFormForKind(communityEvent, kind) {
  if (!communityEvent) return null;
  const contentTypes = parseCommunityContentTypes(communityEvent);
  const match = contentTypes.find((ct) => ct.kinds.includes(kind) && ct.formRef);
  if (!match || !match.formRef) return null;
  return { address: match.formRef, relay: match.formRefRelay || '' };
}

/**
 * Check if a content type has badge-gated access (either read or write)
 *
 * @param {any} communityEvent - The kind 10222 community event
 * @param {number} kind - The event kind to check
 * @returns {{hasBadgeGating: boolean, readBadge: string|null, writeBadge: string|null}}
 */
export function getKindBadgeRequirements(communityEvent, kind) {
  if (!communityEvent) {
    return { hasBadgeGating: false, readBadge: null, writeBadge: null };
  }

  const contentTypes = parseCommunityContentTypes(communityEvent);
  const contentType = contentTypes.find((ct) => ct.kinds.includes(kind));

  if (!contentType) {
    return { hasBadgeGating: false, readBadge: null, writeBadge: null };
  }

  const readBadge = contentType.badges?.read || null;
  const writeBadge = contentType.badges?.write || null;

  return {
    hasBadgeGating: !!(readBadge || writeBadge),
    readBadge,
    writeBadge
  };
}
