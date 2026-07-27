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
import { unique, uniqueBy } from '$lib/helpers/unique.js';

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

/**
 * @typedef {Object} DisplayCreator
 * @property {string} [name] - Creator name from metadata
 * @property {string} [pubkey] - Nostr identity (from a creator p-tag)
 * @property {string} [type] - 'Person' | 'Organization'
 */

/**
 * @typedef {Object} ResourceAttribution
 * @property {boolean} indexed - true when the event pubkey is only the indexer
 * @property {DisplayCreator[]} creators - Creators to display instead of the
 *   publisher: structured creator:* runs in tag order, then foreign p-tag
 *   creators. Empty when not indexed.
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
  if (!event) return { indexed: false, creators: [], sourceDomain: null };

  const sourceDomain = getSourceDomain(event);

  // Creator identities from p-tags: marker "creator" (or none, for legacy
  // events written before markers) — other markers are mentions/contributors.
  const pTagCreators = unique(
    (event.tags || [])
      .filter(
        (/** @type {string[]} */ t) =>
          t[0] === 'p' && HEX_PUBKEY.test(t[1] || '') && (!t[3] || t[3] === 'creator')
      )
      .map((/** @type {string[]} */ t) => t[1].toLowerCase())
  );

  const publisherPubkey = (event.pubkey || '').toLowerCase();
  if (pTagCreators.includes(publisherPubkey)) {
    return { indexed: false, creators: [], sourceDomain };
  }

  // Deduped: events in the wild repeat whole creator runs, and duplicates
  // would both mislead and crash keyed {#each} blocks downstream.
  const structuredCreators = uniqueBy(
    getAMBCreators(event).filter((c) => !!c.name),
    (c) => `${normalizeName(c.name)}|${c.id ?? ''}`
  );

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
    return { indexed: false, creators: [], sourceDomain };
  }

  /** @type {DisplayCreator[]} */
  const creators = [
    ...structuredCreators.map((c) => ({
      name: c.name,
      ...(c.type ? { type: c.type } : {})
    })),
    ...pTagCreators
      .filter((/** @type {string} */ pk) => pk !== publisherPubkey)
      .map((/** @type {string} */ pk) => ({ pubkey: pk }))
  ];
  if (creators.length === 0) {
    return { indexed: false, creators: [], sourceDomain };
  }

  return { indexed: true, creators, sourceDomain };
}

/**
 * Joins creator names for a card byline: up to `max` names comma-separated,
 * remaining count as "+N".
 * @param {(string | undefined)[]} names
 * @param {number} [max]
 * @returns {string}
 */
export function formatCreatorNames(names, max = 2) {
  const clean = names.filter(Boolean);
  if (clean.length <= max) return clean.join(', ');
  return `${clean.slice(0, max).join(', ')} +${clean.length - max}`;
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
