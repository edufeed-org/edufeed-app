/**
 * Claiming a credit: a person named as creator/contributor by name only asks
 * the publisher to link that credit to their Nostr account, and the publisher
 * accepts by re-publishing the event (wiki article `edufeed-attribution-claims`).
 *
 * The claim is a NIP-32 label (kind 1985). It proves nothing — only the
 * publisher's new version of the content counts, so the status of a claim is
 * always derived from the current content event. Pure helpers, no I/O.
 */
import { nip19 } from 'nostr-tools';
import { getAMBCreators, getAMBContributors } from './educational/ambHelpers.js';

export const CLAIM_KIND = 1985;
export const CLAIM_NAMESPACE = 'org.edufeed.attribution';
const ROLES = ['creator', 'contributor'];
const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

/**
 * @typedef {Object} AttributionClaim
 * @property {string} pubkey - claimant (hex)
 * @property {'creator' | 'contributor'} role
 * @property {string} address - `kind:pubkey:d` of the content
 * @property {string} name - credited name exactly as written
 */

/** @param {any} event */
function addressOf(event) {
  const d = (event?.tags || []).find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] ?? '';
  return `${event?.kind}:${event?.pubkey}:${d}`;
}

/**
 * Unsigned claim for a name-only credit on `event`.
 * @param {any} event - the content (addressable)
 * @param {{ role: 'creator' | 'contributor', name: string, relayHint?: string }} claim
 */
export function buildClaimTemplate(event, { role, name, relayHint = '' }) {
  return {
    kind: CLAIM_KIND,
    content: '',
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['L', CLAIM_NAMESPACE],
      ['l', role, CLAIM_NAMESPACE],
      ['a', addressOf(event), relayHint],
      ['p', event.pubkey, relayHint],
      ['name', name]
    ]
  };
}

/**
 * @param {any} event - kind 1985 from the network (untrusted)
 * @returns {AttributionClaim | null}
 */
export function parseClaim(event) {
  if (event?.kind !== CLAIM_KIND || !HEX_PUBKEY.test(event.pubkey || '')) return null;
  /** @param {string} k */
  const tag = (k) => (event.tags || []).find((/** @type {string[]} */ t) => t[0] === k);
  const label = (event.tags || []).find(
    (/** @type {string[]} */ t) => t[0] === 'l' && t[2] === CLAIM_NAMESPACE
  );
  const role = label?.[1];
  const address = tag('a')?.[1];
  const name = tag('name')?.[1];
  if (!ROLES.includes(role) || !address || !name) return null;
  return { pubkey: event.pubkey.toLowerCase(), role, address, name };
}

/**
 * @param {AttributionClaim} claim
 * @param {any} event - current version of the content
 * @returns {'accepted' | 'open' | 'outdated'}
 */
export function claimStatus(claim, event) {
  if (addressOf(event) !== claim.address) return 'outdated';
  const accepted = (event.tags || []).some(
    (/** @type {string[]} */ t) =>
      t[0] === 'p' && (t[1] || '').toLowerCase() === claim.pubkey && t[3] === claim.role
  );
  if (accepted) return 'accepted';
  const runs = claim.role === 'creator' ? getAMBCreators(event) : getAMBContributors(event);
  return runs.some((r) => r.name === claim.name && !r.pubkey) ? 'open' : 'outdated';
}

/**
 * The content's tags with the claim accepted: the claimed run gets the
 * claimant's `nostr:npub…` as its id (replacing any other id — a credit holds
 * one), and the companion p tag is appended. Every other tag is kept.
 * @param {string[][]} tags
 * @param {AttributionClaim} claim
 * @param {string} relayHint - for the p tag
 * @returns {string[][] | null} null when there is no such name-only credit
 */
export function acceptClaimTags(tags, claim, relayHint) {
  const nameKey = `${claim.role}:name`;
  const idKey = `${claim.role}:id`;
  const prefix = `${claim.role}:`;
  // Same grouping as getAMBPersons: a repeated field starts the next person.
  /** @type {Record<string, number>} */
  let run = {};
  /** @type {Record<string, number> | null} */
  let found = null;
  const matches = (/** @type {Record<string, number>} */ r) =>
    r[nameKey] !== undefined &&
    tags[r[nameKey]][1] === claim.name &&
    !/^nostr:/i.test(tags[r[idKey]]?.[1] ?? '');
  for (let i = 0; i < tags.length && !found; i++) {
    const key = tags[i][0];
    if (!key?.startsWith(prefix) || !tags[i][1]) continue;
    if (run[key] !== undefined) {
      if (matches(run)) found = run;
      run = {};
    }
    run[key] = i;
  }
  if (!found && matches(run)) found = run;
  if (!found) return null;

  const id = [idKey, `nostr:${nip19.npubEncode(claim.pubkey)}`];
  const next = tags.map((t) => [...t]);
  if (found[idKey] !== undefined) next[found[idKey]] = id;
  else next.splice(found[nameKey] + 1, 0, id);
  next.push(['p', claim.pubkey, relayHint, claim.role]);
  return next;
}
