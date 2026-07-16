/**
 * Indexer vs. author attribution for AMB resources (kind 30142).
 *
 * On Nostr the event pubkey is always the publisher — but for indexed
 * resources (e.g. a curator ingesting a journal article) the pubkey is only
 * the indexer, and the real author lives in the AMB creator metadata.
 * NIP-AMB gives every creator exactly ONE representation on the wire:
 * a `["p", <hex>, <relay>, "creator"]` tag when they have a Nostr identity,
 * a flattened `creator:*` run otherwise.
 */

import { getAMBCreators, getAMBIdentifier } from './ambHelpers.js';

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

/**
 * @typedef {Object} ResourceAttribution
 * @property {boolean} indexed - true when the event pubkey is only the indexer
 * @property {{name?: string, pubkey?: string, type?: string} | null} creator
 *   The creator to display instead of the publisher (null when not indexed)
 * @property {string | null} sourceDomain - Hostname of the d-tag URL, if any
 */

/** @param {string | null | undefined} name */
function normalizeName(name) {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Hostname of a URL-shaped d-tag, without the `www.` prefix.
 * @param {any} event
 * @returns {string | null}
 */
function getSourceDomain(event) {
  const identifier = getAMBIdentifier(event) || '';
  if (!/^https?:\/\//i.test(identifier)) return null;
  try {
    return new URL(identifier).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Decides whether a resource is indexed (publisher ≠ author) and which
 * creator should occupy the author slot instead.
 *
 * Own content (indexed=false) when:
 * - there are no creators at all, or
 * - a creator p-tag points at the event pubkey itself, or
 * - a structured creator name matches the publisher's profile name.
 *
 * @param {any} event - AMB event (kind 30142)
 * @param {any} [publisherProfile] - kind-0 profile content of event.pubkey
 * @returns {ResourceAttribution}
 */
export function getResourceAttribution(event, publisherProfile = null) {
  if (!event) return { indexed: false, creator: null, sourceDomain: null };

  const sourceDomain = getSourceDomain(event);

  // Creator identities from p-tags: marker "creator" (or none, for legacy
  // events written before markers) — other markers are mentions/contributors.
  const pTagCreators = (event.tags || [])
    .filter(
      (/** @type {string[]} */ t) =>
        t[0] === 'p' && HEX_PUBKEY.test(t[1] || '') && (!t[3] || t[3] === 'creator')
    )
    .map((/** @type {string[]} */ t) => t[1].toLowerCase());

  const publisherPubkey = (event.pubkey || '').toLowerCase();
  if (pTagCreators.includes(publisherPubkey)) {
    return { indexed: false, creator: null, sourceDomain };
  }

  const structuredCreators = getAMBCreators(event).filter((c) => !!c.name);

  const profileNames = [
    publisherProfile?.name,
    publisherProfile?.display_name,
    publisherProfile?.displayName
  ]
    .map(normalizeName)
    .filter(Boolean);
  const publisherIsCreator = structuredCreators.some((c) =>
    profileNames.includes(normalizeName(c.name))
  );
  if (publisherIsCreator) {
    return { indexed: false, creator: null, sourceDomain };
  }

  const foreignPTagCreator = pTagCreators.find(
    (/** @type {string} */ pk) => pk !== publisherPubkey
  );
  if (structuredCreators.length === 0 && !foreignPTagCreator) {
    return { indexed: false, creator: null, sourceDomain };
  }

  // Prefer a named structured creator for display; fall back to the first
  // foreign p-tag creator (has a real, linkable profile).
  const structured = structuredCreators[0];
  const creator = structured
    ? { name: structured.name, ...(structured.type ? { type: structured.type } : {}) }
    : { pubkey: /** @type {string} */ (foreignPTagCreator) };

  return { indexed: true, creator, sourceDomain };
}

/**
 * Initials for a metadata-only creator (no Nostr profile): first letters of
 * the first two words. Tolerates messy real-world name strings.
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function creatorInitials(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}
