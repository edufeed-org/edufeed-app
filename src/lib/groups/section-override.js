// src/lib/groups/section-override.js
//
// Admin-editable content sections for MODERATED communities — pure half.
//
// A community's content sections live on its kind 10222, which is addressable
// by the community pubkey and therefore signable only by whoever holds the
// community key. The people actually running a moderated community are its
// root-group admins, who do not. This module gives them a second, separately
// signed home for the SECTION BLOCK ONLY:
//
//   kind 30223
//   ["d", <communityPubkey>]      addressable per (author, community)
//   ["h", <communityPubkey>]      so ordinary community relay routing carries it
//   ["content", <Name>] ["k", <kind>]… ["access", …]   same grammar as 10222
//
// Deliberately NOT on a NIP-29 event: 39000 is relay-signed, and anything on
// the auth-gated group relay would be invisible to the logged-out readers who
// need the section config to render the community's tabs at all. So it is an
// ordinary public event, bound to the group only by the authorship check
// below — the same trust model the NIP draft already uses for `access`, where
// display filtering is what clients are told to enforce.
//
// What the override deliberately CANNOT carry: per-section `r ... content`
// relays, profile lists, badge requirements and form refs. Infrastructure and
// legacy gating stay with the owner on the 10222; an admin reshaping the
// content surface must not be able to redirect where content is stored.
// Strictness (["strict","content"]) likewise stays a property of the 10222 —
// consumers keep calling hasStrictContentMarker on the community event.
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';
import { deriveCommunityType } from './community-membership.js';

export const SECTION_OVERRIDE_KIND = 30223;

/**
 * @typedef {import('$lib/helpers/communityRelays.js').ContentTypeConfig} ContentTypeConfig
 * @typedef {{tier:'all'}|{tier:'members'}|{tier:'role', role?: string}} AccessTier
 * @typedef {{name: string, kinds?: number[], access?: AccessTier, [key: string]: any}} SectionInput
 *   Extra properties are tolerated and IGNORED — the real call site feeds
 *   whole ContentTypeConfig objects straight back in, and stripping the
 *   fields an override may not carry is precisely this module's job.
 */

/**
 * The section block as 10222-grammar tags. Shared by the builder and, by
 * construction, parsed back by parseCommunityContentTypes.
 * @param {SectionInput[]} sections
 * @returns {string[][]}
 */
function sectionTags(sections) {
  /** @type {string[][]} */
  const tags = [];
  for (const section of sections ?? []) {
    const name = (section?.name ?? '').trim();
    if (!name) continue;
    tags.push(['content', name]);
    for (const kind of section.kinds ?? []) {
      if (Number.isFinite(kind)) tags.push(['k', String(kind)]);
    }
    const access = section.access;
    if (access?.tier === 'members') {
      tags.push(['access', 'members']);
    } else if (access?.tier === 'role') {
      // A role tier with a blank role parses back as 'all' — i.e. silently
      // opens the section. Emit nothing rather than a broken gate (same rule
      // as withSectionAccess in ./section-access.js).
      const role = (access.role ?? '').trim();
      if (role) tags.push(['access', 'role', role]);
    }
  }
  return tags;
}

/**
 * Unsigned kind-30223 template. The caller signs it with their OWN key — the
 * point of the override is that it needs no community signer.
 * @param {string} communityPubkey
 * @param {SectionInput[]} sections
 * @returns {{kind: number, content: string, tags: string[][]}}
 */
export function buildSectionOverrideTemplate(communityPubkey, sections) {
  return {
    kind: SECTION_OVERRIDE_KIND,
    content: '',
    tags: [['d', communityPubkey], ['h', communityPubkey], ...sectionTags(sections)]
  };
}

/**
 * Whether this event may speak for the community's content sections.
 *
 * Judged against the CURRENT roster, never against who was an admin when the
 * event was signed: demoting an admin revokes their override on the spot,
 * with nothing to delete. Same retroactive rule as roster-access.js.
 *
 * While the roster is still loading `admins` is empty, so every override is
 * rejected and the 10222's own sections show — failing toward the owner's
 * configuration, which is the safe direction.
 *
 * @param {{kind?: number, pubkey?: string, tags?: string[][]} | null | undefined} event
 * @param {{communityPubkey: string, admins: Set<string>}} ctx
 * @returns {boolean}
 */
export function isValidSectionOverride(event, { communityPubkey, admins }) {
  if (!event || event.kind !== SECTION_OVERRIDE_KIND) return false;
  if (!Array.isArray(event.tags)) return false;
  const identifier = event.tags.find((tag) => Array.isArray(tag) && tag[0] === 'd')?.[1];
  if (identifier !== communityPubkey) return false;
  const author = event.pubkey;
  if (!author) return false;
  return author === communityPubkey || !!admins?.has(author);
}

/**
 * The community's effective content sections.
 *
 * Precedence: the newest VALID override wins, but only if it is newer than
 * the 10222 itself — so an owner editing their community reasserts control
 * without having to demote anyone. That is safe because the owner's settings
 * form loads these resolved sections, so an owner save absorbs the admin's
 * configuration into the 10222 rather than discarding it.
 *
 * Ties on created_at break on the lower event id, so every client picks the
 * same winner (mirrors foldPublisherConsents in ../concord/publisher-window.js).
 *
 * Only moderated communities have a roster to judge authorship against, so
 * open and closed communities ignore overrides entirely.
 *
 * @param {any} communityEvent kind 10222 (or null while loading)
 * @param {any[]} overrideEvents candidate kind-30223 events, unfiltered
 * @param {Iterable<string>} admins current root-group admin pubkeys
 * @returns {{sections: ContentTypeConfig[], source: 'community'|'override', author: string | null, event: any}}
 */
export function resolveCommunitySections(communityEvent, overrideEvents, admins) {
  const fallback = {
    sections: parseCommunityContentTypes(communityEvent),
    source: /** @type {'community'} */ ('community'),
    author: null,
    event: communityEvent
  };
  if (!communityEvent) return fallback;
  if (deriveCommunityType(communityEvent) !== 'moderated') return fallback;

  const communityPubkey = communityEvent.pubkey;
  // Built once here rather than by the caller, so the reactive wrapper can
  // stay free of mutable Sets (eslint svelte/prefer-svelte-reactivity) and
  // the lookup structure lives with the code that needs it.
  const adminSet = admins instanceof Set ? admins : new Set(admins ?? []);
  const valid = (overrideEvents ?? []).filter((event) =>
    isValidSectionOverride(event, { communityPubkey, admins: adminSet })
  );
  if (valid.length === 0) return fallback;

  const winner = valid.reduce((best, candidate) => {
    if (candidate.created_at !== best.created_at) {
      return candidate.created_at > best.created_at ? candidate : best;
    }
    return String(candidate.id ?? '') < String(best.id ?? '') ? candidate : best;
  });

  if ((winner.created_at ?? 0) <= (communityEvent.created_at ?? 0)) return fallback;

  // Re-parsing through the shared parser means an override that smuggled in
  // an `r`/profile-list/badge tag still yields those fields, so strip them
  // here rather than trusting the writer to have used our builder.
  const sections = parseCommunityContentTypes(winner).map((section) => ({
    ...section,
    relays: [],
    profileList: null,
    profileListRelay: null,
    badges: { read: null, write: null },
    formRef: null,
    formRefRelay: null
  }));

  return {
    sections,
    source: /** @type {'override'} */ ('override'),
    author: winner.pubkey,
    event: winner
  };
}

/**
 * Tag keys parseCommunityContentTypes consumes as belonging to the section it
 * is currently inside. Anything else encountered after a `content` tag —
 * `membership`, `concord`, unknown tags — is community-level and survives,
 * which matters because withMembershipPointer APPENDS, so a pointer can sit
 * after the section block.
 * @param {string[]} tag
 */
function isSectionScopedTag(tag) {
  switch (tag[0]) {
    case 'content':
    case 'k':
    case 'fee':
    case 'exclusive':
    case 'role':
    case 'access':
      return true;
    case 'a':
      return (
        typeof tag[1] === 'string' &&
        (tag[1].startsWith('30009:') || tag[1].startsWith('30000:') || tag[1].startsWith('30168:'))
      );
    case 'r':
      return tag[2] === 'content';
    default:
      return false;
  }
}

/**
 * The community event as the app should DISPLAY it: identical to the 10222
 * except that its content-section block is the effective one.
 *
 * Swapping the sections inside the event, rather than threading a separate
 * section list through every consumer, is what keeps this change small: tabs,
 * gating, share pickers and the FAB all keep taking one community event.
 * Everything that is not section-scoped — pointers, community relays,
 * blossom, the strict marker — is preserved verbatim, and the new section
 * block is appended last so parseCommunityMetadata (which stops at the first
 * `content` tag) still sees all of it.
 *
 * Callers that SIGN or EDIT the community must keep using the raw 10222:
 * absorbing an override into the owner's event is a deliberate act of the
 * settings form, not a side effect of rendering.
 *
 * @param {any} communityEvent kind 10222 (or null)
 * @param {any[]} overrideEvents candidate kind-30223 events, unfiltered
 * @param {Iterable<string>} admins current root-group admin pubkeys
 * @returns {{event: any, source: 'community'|'override', author: string | null}}
 */
export function applySectionOverride(communityEvent, overrideEvents, admins) {
  const resolved = resolveCommunitySections(communityEvent, overrideEvents, admins);
  if (resolved.source !== 'override') {
    return { event: communityEvent, source: 'community', author: null };
  }

  /** @type {string[][]} */
  const kept = [];
  let inSection = false;
  for (const tag of communityEvent.tags ?? []) {
    if (!Array.isArray(tag) || tag.length === 0) continue;
    if (tag[0] === 'content') {
      inSection = true;
      continue;
    }
    if (inSection && isSectionScopedTag(tag)) continue;
    kept.push(tag);
  }

  return {
    event: { ...communityEvent, tags: [...kept, ...sectionTags(resolved.sections)] },
    source: 'override',
    author: resolved.author
  };
}
