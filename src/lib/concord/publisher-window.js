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
 * The content types a window can expose. A deliberate subset of the
 * community wizard's vocabulary: chat (kind 9) and meet rooms are live,
 * interactive surfaces — a window shares CONTENT outward, it does not host
 * conversation. Names/kinds mirror communityTagBuilder's registry so window
 * sections parse identically to wizard-built ones.
 * @type {Array<{key: string, name: string, kinds: string[]}>}
 */
export const WINDOW_CONTENT_TYPES = [
  { key: 'learning', name: 'Learning', kinds: ['30142'] },
  { key: 'articles', name: 'Articles', kinds: ['30023'] },
  { key: 'calendar', name: 'Calendar', kinds: ['31922', '31923', '31924'] },
  { key: 'posts', name: 'Forum', kinds: ['1', '11'] },
  { key: 'wikis', name: 'Wikis', kinds: ['30818'] },
  { key: 'polls', name: 'Polls', kinds: ['1068'] },
  { key: 'bookmarks', name: 'Social Bookmarks', kinds: ['39701'] }
];

/**
 * Split tags into the prelude (everything before the first `content` tag)
 * and positional sections (a `content` tag plus its trailing tags).
 * @param {string[][]} tags
 * @returns {{prelude: string[][], sections: string[][][]}}
 */
function splitSections(tags) {
  /** @type {string[][]} */
  const prelude = [];
  /** @type {string[][][]} */
  const sections = [];
  /** @type {string[][] | null} */
  let current = null;
  for (const tag of tags ?? []) {
    if (Array.isArray(tag) && tag[0] === 'content') {
      current = [tag];
      sections.push(current);
    } else if (current) {
      current.push(tag);
    } else {
      prelude.push(tag);
    }
  }
  return { prelude, sections };
}

/** @param {string[][]} section @param {string} address */
const sectionHasGate = (section, address) =>
  section.some((tag) => Array.isArray(tag) && tag[0] === 'a' && tag[1] === address);

/**
 * WINDOW_CONTENT_TYPES keys of the sections gated by THIS community's
 * publishers list. Unknown section names gated by the list are ignored —
 * the picker can only offer what it can rebuild.
 * @param {string[][]} tags
 * @param {string} communityPubkey
 * @returns {string[]}
 */
export function windowSectionKeys(tags, communityPubkey) {
  const address = publishersListAddress(communityPubkey);
  const { sections } = splitSections(tags);
  return sections
    .filter((section) => sectionHasGate(section, address))
    .map((section) => WINDOW_CONTENT_TYPES.find((t) => t.name === section[0][1])?.key)
    .filter((key) => key !== undefined);
}

/**
 * Whether any content section is NOT gated by this community's publishers
 * list — the signal that separates a genuinely open community from one whose
 * only public surface is the window (deriveCommunityType keeps the latter
 * GESCHLOSSEN, displayed as "Privat mit Schaufenster").
 * @param {string[][]} tags
 * @param {string} communityPubkey
 */
export function hasUngatedPublicSections(tags, communityPubkey) {
  const address = publishersListAddress(communityPubkey);
  return splitSections(tags).sections.some((section) => !sectionHasGate(section, address));
}

/**
 * Return NEW tags where the window is exactly `selectedKeys`: previous
 * publisher-gated sections are dropped, sections owned by no one else are
 * kept verbatim, and a fresh gated section is appended per selected type
 * (content + k tags + the publishers-list gate, the same grammar
 * communityTagBuilder writes).
 * @param {string[][]} tags
 * @param {string} communityPubkey
 * @param {string | undefined} relay hint for the gate a-tag
 * @param {string[]} selectedKeys WINDOW_CONTENT_TYPES keys
 */
export function withWindowSections(tags, communityPubkey, relay, selectedKeys) {
  const address = publishersListAddress(communityPubkey);
  const { prelude, sections } = splitSections(tags);
  const kept = sections.filter((section) => !sectionHasGate(section, address));
  const gate = relay ? ['a', address, relay] : ['a', address];
  const added = WINDOW_CONTENT_TYPES.filter((t) => selectedKeys.includes(t.key)).map((t) => [
    ['content', t.name],
    ...t.kinds.map((kind) => ['k', kind]),
    [...gate]
  ]);
  return [...prelude, ...kept.flat(), ...added.flat()];
}
