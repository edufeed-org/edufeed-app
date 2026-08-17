// Publisher window (Schaufenster) for concord communities — pure helpers.
// Spec: docs/nips/communikey-groups.md "Publisher window". A consented public
// subset of the E2E membership: CORD-04 role 'Publisher' (private grant) +
// kind 3320 consent rumor in the guestbook plane (private acceptance) →
// community-signed NIP-51 follow set `30000:d=publishers` (public roster)
// gating the community's public sections via the standard profile-list form.
//
// No applesauce-concord imports (src/lib/concord convention: pure modules
// stay dependency-free so any route can import them SSR-safely).

export const PUBLISHER_ROLE_NAME = 'Publisher';
export const PUBLISHER_CONSENT_KIND = 3320;
export const PUBLISHERS_LIST_D = 'publishers';

const now = () => Math.floor(Date.now() / 1000);
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The member's consent rumor (guestbook plane). Latest per member wins.
 * @param {'accepted' | 'revoked'} status
 */
export function buildPublisherConsentTemplate(status) {
  return {
    kind: PUBLISHER_CONSENT_KIND,
    content: '',
    created_at: now(),
    tags: [
      ['t', 'publisher-window'],
      ['status', status]
    ]
  };
}

/**
 * Fold guestbook consent rumors: latest per author wins. Deterministic on
 * same-second ties (lower id wins the tie, mirroring NIP-01 replaceables).
 * Malformed rumors (wrong kind/tag, unknown status) are ignored — rumor
 * content is authored by members, not trusted infrastructure.
 * @param {Array<{kind?: number, pubkey?: string, id?: string, created_at?: number, tags?: string[][]}>} rumors
 * @returns {Map<string, 'accepted' | 'revoked'>}
 */
export function foldPublisherConsents(rumors) {
  /** @type {Map<string, {status: 'accepted'|'revoked', created_at: number, id: string}>} */
  const latest = new Map();
  for (const rumor of rumors ?? []) {
    if (!rumor || rumor.kind !== PUBLISHER_CONSENT_KIND || !rumor.pubkey) continue;
    const tags = Array.isArray(rumor.tags) ? rumor.tags : [];
    if (!tags.some((t) => Array.isArray(t) && t[0] === 't' && t[1] === 'publisher-window'))
      continue;
    const status = tags.find((t) => Array.isArray(t) && t[0] === 'status')?.[1];
    if (status !== 'accepted' && status !== 'revoked') continue;
    const candidate = {
      status: /** @type {'accepted'|'revoked'} */ (status),
      created_at: rumor.created_at ?? 0,
      id: rumor.id ?? ''
    };
    const existing = latest.get(rumor.pubkey);
    const wins =
      !existing ||
      candidate.created_at > existing.created_at ||
      (candidate.created_at === existing.created_at && candidate.id < existing.id);
    if (wins) latest.set(rumor.pubkey, candidate);
  }
  return new Map([...latest].map(([pubkey, entry]) => [pubkey, entry.status]));
}

/**
 * The live 'Publisher' role's id, or null. Deleted roles confer nothing.
 * @param {Array<{role_id?: string, name?: string, deleted?: boolean}>} roles
 */
export function publisherRoleId(roles) {
  const role = (roles ?? []).find((r) => r && r.name === PUBLISHER_ROLE_NAME && !r.deleted);
  return role?.role_id ?? null;
}

/**
 * Members holding the given role id.
 * @param {Map<string, string[]> | Array<{member?: string, role_ids?: string[]}>} grants
 * @param {string | null} roleId
 * @returns {Set<string>}
 */
export function grantedPublishers(grants, roleId) {
  /** @type {Set<string>} */
  const holders = new Set();
  if (!roleId) return holders;
  const entries =
    grants instanceof Map
      ? [...grants].map(([member, roleIds]) => ({ member, role_ids: roleIds }))
      : (grants ?? []);
  for (const grant of entries) {
    if (grant?.member && (grant.role_ids ?? []).includes(roleId)) holders.add(grant.member);
  }
  return holders;
}

/**
 * The pubkeys that belong on the PUBLIC list: granted AND accepted. Consent
 * is load-bearing (spec: listing REQUIRES the member's acceptance) — a grant
 * alone or a revoked consent never lists anyone.
 * @param {{granted: Set<string>, consents: Map<string, 'accepted'|'revoked'>}} args
 * @returns {string[]}
 */
export function resolvePublisherListing({ granted, consents }) {
  return [...granted].filter((pubkey) => consents.get(pubkey) === 'accepted').sort();
}

/**
 * p-tag pubkeys of a publishers list event (untrusted input: validated hex,
 * deduped).
 * @param {{tags?: string[][]} | null | undefined} event
 * @returns {string[]}
 */
export function parsePublishersList(event) {
  /** @type {string[]} */
  const pubkeys = [];
  for (const tag of event?.tags ?? []) {
    if (!Array.isArray(tag) || tag[0] !== 'p' || !HEX64.test(tag[1] ?? '')) continue;
    if (!pubkeys.includes(tag[1])) pubkeys.push(tag[1]);
  }
  return pubkeys;
}

/**
 * Unsigned kind 30000 (d=publishers) replacement. created_at strictly newer
 * than the previous list — same-second updates otherwise lose the NIP-01
 * lowest-id tiebreak half the time (see the follow-set incident).
 * @param {string[]} pubkeys
 * @param {{created_at?: number} | null} [previous]
 */
export function buildPublishersListTemplate(pubkeys, previous = null) {
  return {
    kind: 30000,
    content: '',
    created_at: Math.max(now(), (previous?.created_at ?? 0) + 1),
    tags: [['d', PUBLISHERS_LIST_D], ...pubkeys.map((pubkey) => ['p', pubkey])]
  };
}

/**
 * The section-gating a-tag address for a community's publishers list.
 * @param {string} communityPubkey
 */
export function publishersListAddress(communityPubkey) {
  return `30000:${communityPubkey}:${PUBLISHERS_LIST_D}`;
}

/**
 * Return NEW tags with the publishers-list gate on every content section
 * (inserted directly after each `content` tag, the position the section
 * parser associates a-tags by). Idempotent: sections already carrying THIS
 * community's publishers gate are left untouched; other 30000 a-tags are
 * preserved (legacy) and not duplicated against.
 * @param {string[][]} tags
 * @param {string} communityPubkey
 * @param {string} [relay]
 */
export function withPublisherSectionGates(tags, communityPubkey, relay) {
  const address = publishersListAddress(communityPubkey);
  const gate = relay ? ['a', address, relay] : ['a', address];
  /** @type {string[][]} */
  const out = [];
  for (let i = 0; i < (tags ?? []).length; i++) {
    const tag = tags[i];
    out.push(tag);
    if (!Array.isArray(tag) || tag[0] !== 'content') continue;
    // Look ahead over this section's trailing tags for an existing gate.
    let hasGate = false;
    for (let j = i + 1; j < tags.length; j++) {
      const next = tags[j];
      if (!Array.isArray(next) || next[0] === 'content' || next[0] === 'strict') break;
      if (next[0] === 'a' && next[1] === address) hasGate = true;
    }
    if (!hasGate) out.push([...gate]);
  }
  return out;
}

/**
 * Return NEW tags with this community's publishers gates removed.
 * @param {string[][]} tags
 * @param {string} communityPubkey
 */
export function withoutPublisherSectionGates(tags, communityPubkey) {
  const address = publishersListAddress(communityPubkey);
  return (tags ?? []).filter(
    (tag) => !(Array.isArray(tag) && tag[0] === 'a' && tag[1] === address)
  );
}
