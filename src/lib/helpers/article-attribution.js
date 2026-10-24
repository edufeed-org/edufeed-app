/**
 * Authorship, license and TULLU provenance on NIP-23 articles (kind 30023).
 *
 * NIP-23 itself knows only the event pubkey as author and no license. The
 * blog form lets a publisher credit someone else (a re-published post), name
 * the license and record where the text came from and what was changed — the
 * TULLU rule (Titel, Urheber, Lizenz, Link, Ursprung) plus the modification
 * note CC BY asks for. All of it is optional; an article without these tags
 * reads exactly as before.
 *
 * Wire form — the vocabulary the app's other addressable content already
 * uses, so nope-mcp, the citation and the people pickers read it unchanged:
 *
 *   ["p", <hex>, <relay>, "creator" | "contributor"]   person with a Nostr identity
 *   ["creator:type", "Person"], ["creator:name", "…"]   name-only person, flattened
 *   (`contributor:*` likewise; AMB flattening, NIP-AMB AMB.md l.81-93)
 *   ["license:id", <url>]                               as kind 30142 / 30040
 *   ["source", <url>]                                   Ursprungsort, as the kind-1063 attestation
 *   ["changes", "geändert von Gina, Links ausgetauscht"] modification note
 *
 * Unmarked `p` tags on an article are NIP-27 body mentions, never creators.
 * Pure helpers, no I/O.
 */
import { getAMBCreators, getAMBContributors } from './educational/ambHelpers.js';
import { formatLicenseUrl } from './educational/licenseLabel.js';
import { resolveAttribution } from './educational/resourceAttribution.js';
import { unique, uniqueBy } from './unique.js';

export const ARTICLE_LICENSE_TAG = 'license:id';
export const ARTICLE_SOURCE_TAG = 'source';
export const ARTICLE_CHANGES_TAG = 'changes';

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

/**
 * @typedef {Object} ArticlePerson
 * @property {'creator' | 'contributor'} role
 * @property {string} [pubkey] - Nostr identity (hex), from a marked p-tag
 * @property {string} [name] - Name as written (name-only person)
 * @property {string} [type] - 'Person' | 'Organization'
 * @property {string} [honorificPrefix]
 * @property {string} [affiliationName]
 * @property {string} [id] - URI identifier (ORCID)
 */

/**
 * @typedef {Object} ArticleProvenance
 * @property {{ id: string, label: string } | null} license
 * @property {string | null} source - Where the text originally appeared (http(s) URL)
 * @property {string | null} changes - Modification note, as written
 */

/** @param {string} value */
function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

/** @param {any} event @param {string} name */
function tagValue(event, name) {
  const value = (event?.tags || []).find(
    (/** @type {string[]} */ t) => Array.isArray(t) && t[0] === name
  )?.[1];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Credited people: all creators first (name-only runs in wire order, then
 * linked p-tags), then the contributors the same way. Tags are untrusted
 * input — repeated runs and malformed pubkeys are dropped.
 * @param {any} event - Article event (kind 30023)
 * @returns {ArticlePerson[]}
 */
export function getArticlePeople(event) {
  const personKey = (/** @type {any} */ c) => `${c.name ?? ''}|${c.id ?? ''}`;
  const marked = (event?.tags || []).filter(
    (/** @type {string[]} */ t) =>
      Array.isArray(t) &&
      t[0] === 'p' &&
      HEX_PUBKEY.test(t[1] || '') &&
      (t[3] === 'creator' || t[3] === 'contributor')
  );
  /** @param {'creator' | 'contributor'} role */
  const linked = (role) =>
    unique(
      marked
        .filter((/** @type {string[]} */ t) => t[3] === role)
        .map((/** @type {string[]} */ t) => t[1].toLowerCase())
    ).map((pubkey) => ({ pubkey, role }));
  /** @param {any[]} runs @param {'creator' | 'contributor'} role */
  const named = (runs, role) =>
    uniqueBy(runs, personKey)
      .filter((c) => !!c.name)
      .map((c) => ({ ...c, role }));
  return [
    ...named(getAMBCreators(event), 'creator'),
    ...linked('creator'),
    ...named(getAMBContributors(event), 'contributor'),
    ...linked('contributor')
  ];
}

/**
 * License, origin and modification note of an article.
 * @param {any} event - Article event (kind 30023)
 * @returns {ArticleProvenance}
 */
export function getArticleProvenance(event) {
  // Both URLs are rendered as hrefs — only http(s) from untrusted tags.
  const licenseId = tagValue(event, ARTICLE_LICENSE_TAG);
  const source = tagValue(event, ARTICLE_SOURCE_TAG);
  const changes = tagValue(event, ARTICLE_CHANGES_TAG);
  return {
    license: isHttpUrl(licenseId)
      ? { id: licenseId, label: formatLicenseUrl(licenseId) || licenseId }
      : null,
    source: isHttpUrl(source) ? source : null,
    changes: changes || null
  };
}

/**
 * Whether the byline belongs to a credited creator instead of the publisher
 * (same rule as AMB resources: foreign creators only, contributors and body
 * mentions never qualify).
 * @param {any} event - Article event (kind 30023)
 * @param {any} [publisherProfile] - kind-0 profile content of event.pubkey
 * @returns {{ indexed: boolean, creators: import('./educational/resourceAttribution.js').DisplayCreator[] }}
 */
export function getArticleAttribution(event, publisherProfile = null) {
  const creators = getArticlePeople(event).filter((p) => p.role === 'creator');
  return resolveAttribution({
    structuredCreators: creators.filter((p) => !p.pubkey),
    pTagCreators: creators.flatMap((p) => (p.pubkey ? [p.pubkey] : [])),
    publisherPubkey: event?.pubkey,
    publisherProfile
  });
}

/**
 * Credited people as `CreatorInput` entries, for the edit form. A linked
 * person's name is resolved from their profile by the picker, so it starts
 * empty here.
 * @param {any} event - Article event (kind 30023)
 * @returns {import('$lib/stores/educational-actions.svelte.js').Creator[]}
 */
export function articlePeopleToForm(event) {
  return getArticlePeople(event).map((p) => {
    /** @type {any} */
    const entry = p.pubkey
      ? { name: '', type: 'Person', pubkey: p.pubkey }
      : { name: p.name, type: p.type || 'Person' };
    if (p.affiliationName) entry.affiliationName = p.affiliationName;
    if (p.honorificPrefix) entry.honorificPrefix = p.honorificPrefix;
    if (p.id) entry.orcid = p.id;
    if (p.role === 'contributor') entry.role = 'contributor';
    return entry;
  });
}
