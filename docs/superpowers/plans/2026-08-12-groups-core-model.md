# Groups Core Model & Roster Gating — Implementation Plan (1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the data model and gating semantics of the groups architecture design — community type derivation, `membership`/`access`/`application` tags, the NIP-29 root-group roster, and roster-based publish gating — behind the existing `ProfileListAccess` interface so every current consumer keeps working.

**Architecture:** Pure tag parsers/builders in `src/lib/groups/` and `src/lib/helpers/` (node-testable), one thin reactive hook (`useRootRoster`) that reuses the existing batched `useChannelRosters`, and a facade hook (`useCommunityAccess`) that presents the exact `ProfileListAccess` interface — backed by the NIP-29 roster for moderated communities and delegating to the legacy profile-list hook otherwise. One swap at the single instantiation site in the community layout.

**Tech Stack:** SvelteKit + Svelte 5 runes, JavaScript with JSDoc, Vitest, applesauce (`applesauce-common/helpers/groups` for NIP-29 event parsing).

**Spec:** `docs/superpowers/specs/2026-08-12-groups-architecture-design.md` (design) and `docs/nips/communikey-groups.md` (**normative tag semantics** — if implementation forces a deviation, update the NIP draft in the same commit).

**Roadmap context:** This is plan 1 of 3. Plan 2 (creation wizard, type flips, settings panes, `GROUPS_ENABLED` flag) and plan 3 (two-zone sidebar, join/application flows, shell page, E2E) are written after this plan lands — they build on the helpers produced here.

## Global Constraints

- Work in the worktree `/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer`, branch `feat/community-group-pointer`. All paths below are relative to that root.
- JavaScript with JSDoc only — no TypeScript syntax (type annotations in code fail to parse).
- Unit tests live in `src/lib/__tests__/`, annotated `/** @vitest-environment node */` (or `jsdom` where noted). Run a single file with `pnpm vitest run src/lib/__tests__/<file>`.
- TDD: write the failing test first, watch it fail, then implement.
- NIP-29 event parsing comes from `applesauce-common/helpers/groups` (`getGroupMembers`, `getGroupAdmins`, `GROUP_MEMBERS_KIND`, …). Do NOT use applesauce's `getPublicGroups` — it memoises onto a Symbol on the event and crashes inside `$derived` (commit 061c05c9).
- Never import `applesauce-concord` / `applesauce-core-concord` outside `src/lib/concord/` (lint-enforced). Importing the **pure** `$lib/concord/pointer.js` from groups code is fine — it has no applesauce-concord imports; keep it that way. (FYI: applesauce's own `concord` branch on github.com/hzrd149/applesauce is the upstream for the pinned concord aliases — irrelevant to this plan, relevant to plan 2/3 reviewers.)
- Malformed tags are untrusted network input: parsers fail open (`access` falls back to `all`, invalid pointers are skipped) and never throw.
- This plan adds **no user-visible strings** — if you find yourself adding one, add the key to BOTH `messages/de.json` and `messages/en.json` (German is the base locale).
- Commit after every task; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Do NOT push (the pre-push hook fans out 3×; laoc pushes).

---

### Task 1: `community-membership.js` — membership/application tags + type derivation

**Files:**
- Create: `src/lib/groups/community-membership.js`
- Test: `src/lib/__tests__/community-membership.test.js`

**Interfaces:**
- Consumes: `isValidRelayWebsocketUrl(relay)` from `src/lib/groups/groups.js:82`; `parseConcordPointer(event) → {communityId, relay?} | undefined` from `src/lib/concord/pointer.js:34`.
- Produces (used by Tasks 4–6 and by plans 2–3):
  - `parseMembershipPointer(event) → {id: string, relay: string} | null`
  - `buildMembershipTag(pointer) → string[]`
  - `withMembershipPointer(tags, pointer) → string[][]` / `withoutMembershipPointer(tags) → string[][]`
  - `parseApplicationRef(event) → {address: string, relay: string|null} | null`
  - `buildApplicationTag(ref) → string[]` / `withApplicationRef(tags, ref)` / `withoutApplicationRef(tags)`
  - `deriveCommunityType(event) → 'open' | 'moderated' | 'closed'`

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/community-membership.test.js
import { describe, it, expect } from 'vitest';
import {
  parseMembershipPointer,
  buildMembershipTag,
  withMembershipPointer,
  withoutMembershipPointer,
  parseApplicationRef,
  buildApplicationTag,
  withApplicationRef,
  withoutApplicationRef,
  deriveCommunityType
} from '$lib/groups/community-membership.js';

const RELAY = 'wss://groups.example.com';
const PK = 'a'.repeat(64);
const event = (tags) => ({ kind: 10222, pubkey: PK, tags });

describe('parseMembershipPointer', () => {
  it('parses a valid membership tag', () => {
    expect(parseMembershipPointer(event([['membership', 'root1', RELAY]]))).toEqual({
      id: 'root1',
      relay: RELAY
    });
  });
  it('returns null without a membership tag, without event, or without tags', () => {
    expect(parseMembershipPointer(event([['r', RELAY]]))).toBeNull();
    expect(parseMembershipPointer(null)).toBeNull();
    expect(parseMembershipPointer({})).toBeNull();
  });
  it('skips tags with empty id or invalid relay (fail open, first valid wins)', () => {
    expect(parseMembershipPointer(event([['membership', '', RELAY]]))).toBeNull();
    expect(parseMembershipPointer(event([['membership', 'root1', 'not-a-url']]))).toBeNull();
    expect(parseMembershipPointer(event([['membership', 'root1']]))).toBeNull();
    expect(
      parseMembershipPointer(
        event([
          ['membership', 'bad', 'http://x'],
          ['membership', 'good', RELAY],
          ['membership', 'second', RELAY]
        ])
      )
    ).toEqual({ id: 'good', relay: RELAY });
  });
});

describe('membership tag writers', () => {
  it('builds the tag', () => {
    expect(buildMembershipTag({ id: 'root1', relay: RELAY })).toEqual([
      'membership',
      'root1',
      RELAY
    ]);
  });
  it('withMembershipPointer replaces any existing membership tags (singular)', () => {
    const tags = [
      ['r', RELAY],
      ['membership', 'old', RELAY],
      ['membership', 'older', RELAY]
    ];
    const out = withMembershipPointer(tags, { id: 'new', relay: RELAY });
    expect(out.filter((t) => t[0] === 'membership')).toEqual([['membership', 'new', RELAY]]);
    expect(out).toContainEqual(['r', RELAY]);
    expect(tags).toHaveLength(3); // input untouched
  });
  it('withoutMembershipPointer strips all membership tags, leaves siblings', () => {
    const out = withoutMembershipPointer([
      ['membership', 'x', RELAY],
      ['group', 'chan', RELAY]
    ]);
    expect(out).toEqual([['group', 'chan', RELAY]]);
  });
});

describe('application ref', () => {
  const ADDR = `30168:${PK}:edufeed-membership`;
  it('parses address and optional relay hint', () => {
    expect(parseApplicationRef(event([['application', ADDR, RELAY]]))).toEqual({
      address: ADDR,
      relay: RELAY
    });
    expect(parseApplicationRef(event([['application', ADDR]]))).toEqual({
      address: ADDR,
      relay: null
    });
  });
  it('rejects non-30168 or malformed addresses', () => {
    expect(parseApplicationRef(event([['application', `30000:${PK}:x`]]))).toBeNull();
    expect(parseApplicationRef(event([['application', '30168:notenoughparts']]))).toBeNull();
    expect(parseApplicationRef(event([]))).toBeNull();
  });
  it('build/with/without round-trip', () => {
    const ref = { address: ADDR, relay: RELAY };
    expect(buildApplicationTag(ref)).toEqual(['application', ADDR, RELAY]);
    expect(buildApplicationTag({ address: ADDR })).toEqual(['application', ADDR]);
    const out = withApplicationRef([['application', `30168:${PK}:old`]], ref);
    expect(out.filter((t) => t[0] === 'application')).toEqual([['application', ADDR, RELAY]]);
    expect(withoutApplicationRef(out)).toEqual([]);
  });
});

describe('deriveCommunityType', () => {
  const CONCORD_ID = 'b'.repeat(64);
  it('is open without pointers, for null, and for events without tags', () => {
    expect(deriveCommunityType(event([['r', RELAY]]))).toBe('open');
    expect(deriveCommunityType(null)).toBe('open');
    expect(deriveCommunityType({})).toBe('open');
  });
  it('is moderated with a membership pointer', () => {
    expect(deriveCommunityType(event([['membership', 'root1', RELAY]]))).toBe('moderated');
  });
  it('is closed with a concord pointer', () => {
    expect(deriveCommunityType(event([['concord', CONCORD_ID, RELAY]]))).toBe('closed');
  });
  it('falls back to open on XOR violation (both pointers)', () => {
    expect(
      deriveCommunityType(
        event([
          ['concord', CONCORD_ID, RELAY],
          ['membership', 'root1', RELAY]
        ])
      )
    ).toBe('open');
  });
  it('an invalid membership tag does not make the community moderated', () => {
    expect(deriveCommunityType(event([['membership', 'root1', 'garbage']]))).toBe('open');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/community-membership.test.js`
Expected: FAIL — "Failed to resolve import" (module does not exist yet).

- [ ] **Step 3: Write the implementation**

```js
// src/lib/groups/community-membership.js
//
// Kind-10222 membership machinery per docs/nips/communikey-groups.md:
//   ["membership", <root-group-id>, <relay>]  — the NIP-29 root group whose
//     roster/roles ARE the community membership (moderated communities).
//   ["application", "30168:<pubkey>:<d>", <relay?>] — optional structured
//     intake form for joining.
// Both singular by design, like the concord pointer and unlike the plural
// channel `group` tags (src/lib/groups/community-pointer.js).
//
// Community TYPE is derived, never declared: concord pointer → closed,
// membership pointer → moderated, neither → open. XOR violation → open.
import { parseConcordPointer } from '$lib/concord/pointer.js';
import { isValidRelayWebsocketUrl } from './groups.js';

export const MEMBERSHIP_TAG = 'membership';
export const APPLICATION_TAG = 'application';

/** @typedef {{id: string, relay: string}} MembershipPointer */
/** @typedef {{address: string, relay?: string | null}} ApplicationRef */
/** @typedef {'open' | 'moderated' | 'closed'} CommunityType */

/**
 * First valid membership pointer on a community event, or null.
 * @param {{tags?: string[][]} | null | undefined} event
 * @returns {MembershipPointer | null}
 */
export function parseMembershipPointer(event) {
  if (!event || !Array.isArray(event.tags)) return null;
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== MEMBERSHIP_TAG) continue;
    const id = typeof tag[1] === 'string' ? tag[1].trim() : '';
    const relay = tag[2];
    if (!id || typeof relay !== 'string' || !isValidRelayWebsocketUrl(relay)) continue;
    return { id, relay };
  }
  return null;
}

/**
 * @param {MembershipPointer} pointer
 * @returns {string[]}
 */
export function buildMembershipTag(pointer) {
  return [MEMBERSHIP_TAG, pointer.id, pointer.relay];
}

/**
 * NEW tags array with every membership tag removed.
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function withoutMembershipPointer(tags) {
  return tags.filter((tag) => tag[0] !== MEMBERSHIP_TAG);
}

/**
 * NEW tags array with exactly one membership tag (singular by spec).
 * @param {string[][]} tags
 * @param {MembershipPointer} pointer
 * @returns {string[][]}
 */
export function withMembershipPointer(tags, pointer) {
  return [...withoutMembershipPointer(tags), buildMembershipTag(pointer)];
}

/** @param {unknown} address @returns {address is string} */
function isFormAddress(address) {
  if (typeof address !== 'string' || !address.startsWith('30168:')) return false;
  const parts = address.split(':');
  return parts.length === 3 && parts[1].length > 0 && parts[2].length > 0;
}

/**
 * First valid application-form reference on a community event, or null.
 * @param {{tags?: string[][]} | null | undefined} event
 * @returns {{address: string, relay: string | null} | null}
 */
export function parseApplicationRef(event) {
  if (!event || !Array.isArray(event.tags)) return null;
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== APPLICATION_TAG) continue;
    if (!isFormAddress(tag[1])) continue;
    return { address: tag[1], relay: typeof tag[2] === 'string' && tag[2] ? tag[2] : null };
  }
  return null;
}

/**
 * @param {ApplicationRef} ref
 * @returns {string[]}
 */
export function buildApplicationTag(ref) {
  const tag = [APPLICATION_TAG, ref.address];
  if (ref.relay) tag.push(ref.relay);
  return tag;
}

/**
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function withoutApplicationRef(tags) {
  return tags.filter((tag) => tag[0] !== APPLICATION_TAG);
}

/**
 * @param {string[][]} tags
 * @param {ApplicationRef} ref
 * @returns {string[][]}
 */
export function withApplicationRef(tags, ref) {
  return [...withoutApplicationRef(tags), buildApplicationTag(ref)];
}

/**
 * Community type, derived from the event's pointer tags — never declared.
 * XOR violation (both pointers) is invalid per the NIP draft: fail open.
 * @param {{tags?: string[][]} | null | undefined} event
 * @returns {CommunityType}
 */
export function deriveCommunityType(event) {
  if (!event) return 'open';
  const concord = parseConcordPointer(event);
  const membership = parseMembershipPointer(event);
  if (concord && membership) return 'open';
  if (concord) return 'closed';
  if (membership) return 'moderated';
  return 'open';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/community-membership.test.js`
Expected: PASS (all describes green). If `parseConcordPointer` behaves differently than the test assumes (e.g. requires 64-hex id — it does, `isConcordCommunityId`), the test's `CONCORD_ID` is already 64 hex chars; do not weaken the helper.

- [ ] **Step 5: Commit**

```bash
git add src/lib/groups/community-membership.js src/lib/__tests__/community-membership.test.js
git commit -m "feat(groups): membership/application tags + community type derivation"
```

---

### Task 2: `access` section tiers — parser, `sectionIsGated`, builder

**Files:**
- Modify: `src/lib/helpers/communityRelays.js` (typedef at `:7`, section init at `:68`, new parse branch after the `role` branch at `:87–88`; new export `sectionIsGated`)
- Modify: `src/lib/helpers/communityTagBuilder.js` (`ContentTypeFormData` typedef at `:9`, `createDefaultContentTypes` at `:64`, section emission inside the loop at `:144`)
- Test: extend `src/lib/__tests__/communityRelays.test.js` and `src/lib/__tests__/communityTagBuilder.test.js` (both exist)

**Interfaces:**
- Produces:
  - `ContentTypeConfig.access: {tier:'all'} | {tier:'members'} | {tier:'role', role: string}` — always present, defaults to `{tier:'all'}`
  - `sectionIsGated(section) → boolean` exported from `communityRelays.js` — true when `section.profileList` is set (legacy) OR `section.access.tier !== 'all'` (new)
  - `ContentTypeFormData.access` (same shape) consumed by `buildCommunityDefinitionTags`, emitted as `["access","members"]` / `["access","role",<name>]` inside the section (new-spec mode only)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/communityRelays.test.js`:

```js
import { sectionIsGated } from '$lib/helpers/communityRelays.js'; // extend existing import line

describe('access section tiers (communikey-groups NIP draft)', () => {
  const base = (extra) => ({
    kind: 10222,
    tags: [['content', 'Learning'], ['k', '30142'], ...extra, ['content', 'Chat'], ['k', '9']]
  });

  it('defaults to tier "all" when no access tag is present', () => {
    const [learning, chat] = parseCommunityContentTypes(base([]));
    expect(learning.access).toEqual({ tier: 'all' });
    expect(chat.access).toEqual({ tier: 'all' });
  });

  it('parses ["access","members"] scoped to its section only', () => {
    const [learning, chat] = parseCommunityContentTypes(base([['access', 'members']]));
    expect(learning.access).toEqual({ tier: 'members' });
    expect(chat.access).toEqual({ tier: 'all' });
  });

  it('parses ["access","role",<name>]', () => {
    const [learning] = parseCommunityContentTypes(base([['access', 'role', 'lehrkraft']]));
    expect(learning.access).toEqual({ tier: 'role', role: 'lehrkraft' });
  });

  it('fails open on malformed access tags; first valid tag wins', () => {
    expect(parseCommunityContentTypes(base([['access', 'bogus']]))[0].access).toEqual({
      tier: 'all'
    });
    expect(parseCommunityContentTypes(base([['access', 'role', '  ']]))[0].access).toEqual({
      tier: 'all'
    });
    expect(
      parseCommunityContentTypes(base([['access', 'members'], ['access', 'role', 'x']]))[0].access
    ).toEqual({ tier: 'members' });
  });

  it('ignores access tags before any content section', () => {
    const sections = parseCommunityContentTypes({
      kind: 10222,
      tags: [['access', 'members'], ['content', 'Learning'], ['k', '30142']]
    });
    expect(sections[0].access).toEqual({ tier: 'all' });
  });
});

describe('sectionIsGated', () => {
  it('true for legacy profile-list sections and for non-all access tiers', () => {
    expect(sectionIsGated({ profileList: '30000:x:y', access: { tier: 'all' } })).toBe(true);
    expect(sectionIsGated({ profileList: null, access: { tier: 'members' } })).toBe(true);
    expect(sectionIsGated({ profileList: null, access: { tier: 'role', role: 'r' } })).toBe(true);
  });
  it('false for open sections and robust against missing access field', () => {
    expect(sectionIsGated({ profileList: null, access: { tier: 'all' } })).toBe(false);
    expect(sectionIsGated({ profileList: null })).toBe(false);
    expect(sectionIsGated(null)).toBe(false);
  });
});
```

Append to `src/lib/__tests__/communityTagBuilder.test.js`:

```js
describe('access tier emission', () => {
  const data = (access) => ({
    relays: [],
    blossomServers: [],
    location: '',
    description: '',
    contentTypes: {
      learning: {
        name: 'Learning',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: '',
        access
      }
    }
  });
  const PK = 'a'.repeat(64);

  it('emits ["access","members"] inside the section (new-spec only)', () => {
    const tags = buildCommunityDefinitionTags(data({ tier: 'members' }), { communityPubkey: PK });
    const ci = tags.findIndex((t) => t[0] === 'content' && t[1] === 'Learning');
    const section = tags.slice(ci + 1);
    expect(section).toContainEqual(['access', 'members']);
  });

  it('emits ["access","role",<name>]', () => {
    const tags = buildCommunityDefinitionTags(data({ tier: 'role', role: 'lehrkraft' }), {
      communityPubkey: PK
    });
    expect(tags).toContainEqual(['access', 'role', 'lehrkraft']);
  });

  it('emits nothing for tier "all", missing access, or old-spec mode', () => {
    const all = buildCommunityDefinitionTags(data({ tier: 'all' }), { communityPubkey: PK });
    expect(all.some((t) => t[0] === 'access')).toBe(false);
    const missing = buildCommunityDefinitionTags(data(undefined), { communityPubkey: PK });
    expect(missing.some((t) => t[0] === 'access')).toBe(false);
    const oldSpec = buildCommunityDefinitionTags(data({ tier: 'members' }), {});
    expect(oldSpec.some((t) => t[0] === 'access')).toBe(false);
  });

  it('createDefaultContentTypes seeds access tier "all"', () => {
    const cts = createDefaultContentTypes(['learning']);
    expect(cts.learning.access).toEqual({ tier: 'all' });
  });
});
```

(Reuse the existing import lines of each test file; add `createDefaultContentTypes` to the builder-test import if not present.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/communityRelays.test.js src/lib/__tests__/communityTagBuilder.test.js`
Expected: FAIL — `access` is `undefined` on parsed sections, `sectionIsGated` not exported, builder emits no access tags.

- [ ] **Step 3: Implement**

In `src/lib/helpers/communityRelays.js`:

1. Extend the `ContentTypeConfig` typedef (after the `formRefRelay` line):

```js
 * @property {{tier: 'all'}|{tier: 'members'}|{tier: 'role', role: string}} access - Publish tier (communikey-groups NIP draft); 'all' when absent
```

2. In `parseCommunityContentTypes`, add `access: { tier: 'all' }` to the section literal created in the `key === 'content'` branch (line ~68–79).

3. Add a parse branch after the `role` branch (line ~87–88):

```js
    } else if (key === 'access' && currentContentType) {
      // First valid access tag per section wins; malformed → stays 'all' (fail open).
      if (currentContentType.access.tier === 'all') {
        if (tag[1] === 'members') {
          currentContentType.access = { tier: 'members' };
        } else if (tag[1] === 'role' && typeof tag[2] === 'string' && tag[2].trim()) {
          currentContentType.access = { tier: 'role', role: tag[2].trim() };
        }
      }
```

4. Add the exported predicate (near `hasStrictContentMarker`):

```js
/**
 * Whether a content section restricts who may publish — via a legacy
 * profile list OR a communikey-groups access tier. The one predicate every
 * gating consumer must use (tabs, filtering, member aggregation).
 * @param {Pick<ContentTypeConfig, 'profileList' | 'access'> | null | undefined} section
 * @returns {boolean}
 */
export function sectionIsGated(section) {
  if (!section) return false;
  if (section.profileList) return true;
  return !!section.access && section.access.tier !== 'all';
}
```

In `src/lib/helpers/communityTagBuilder.js`:

1. Extend `ContentTypeFormData` typedef:

```js
 * @property {{tier: 'all'}|{tier: 'members'}|{tier: 'role', role: string}} [access] - Publish tier (new-spec; omitted or 'all' → open)
```

2. In `createDefaultContentTypes`, add `access: { tier: 'all' }` to the per-key literal.

3. In `buildCommunityDefinitionTags`, right after the kind-tags loop inside the section loop (after line ~155), add:

```js
    // Publish tier per communikey-groups NIP draft (new-spec only)
    if (isNewSpec && ct.access && ct.access.tier !== 'all') {
      tags.push(
        ct.access.tier === 'members' ? ['access', 'members'] : ['access', 'role', ct.access.role]
      );
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/communityRelays.test.js src/lib/__tests__/communityTagBuilder.test.js`
Expected: PASS, including all pre-existing tests (the new `access` field must not break existing shape assertions — if an existing test does exact-object comparison on sections, extend its expected object with `access: { tier: 'all' }`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/communityRelays.js src/lib/helpers/communityTagBuilder.js src/lib/__tests__/communityRelays.test.js src/lib/__tests__/communityTagBuilder.test.js
git commit -m "feat(communikey): access section tiers + sectionIsGated predicate"
```

---

### Task 3: Route gating predicates through `sectionIsGated`

**Files:**
- Modify: `src/lib/helpers/contentTypes.js` — `getRestrictedTabIds` (`:414`, the `if (!section.profileList) continue;` at `:419`), `getAccessibleTabIds` (`:434`, same check at `:439`), `getVerifiedMembers` (`:506`, same check at `:518`)
- Test: Create `src/lib/__tests__/contentTypes-access-tiers.test.js`

**Interfaces:**
- Consumes: `sectionIsGated` from Task 2.
- Produces: no signature changes — `getRestrictedTabIds(communikeyEvent)`, `getAccessibleTabIds(communikeyEvent, profileAccess)`, `getVerifiedMembers(profileAccess, communityEvent)` now treat `access`-tiered sections as gated. (`filterEventsByAccess` needs NO change — it asks `profileAccess.getAllowedAuthors`, which Task 6's facade answers.)

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/contentTypes-access-tiers.test.js
import { describe, it, expect } from 'vitest';
import {
  getRestrictedTabIds,
  getAccessibleTabIds,
  getVerifiedMembers
} from '$lib/helpers/contentTypes.js';

const OWNER = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const moderatedEvent = {
  kind: 10222,
  pubkey: OWNER,
  tags: [
    ['membership', 'root1', 'wss://groups.example.com'],
    ['strict', 'content'],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'role', 'lehrkraft'],
    ['content', 'Calendar'],
    ['k', '31922'],
    ['k', '31923'],
    ['access', 'members'],
    ['content', 'Forum'],
    ['k', '11']
  ]
};

/** Minimal ProfileListAccess stub */
const access = (canNames, membersByName = {}) => ({
  isLoading: false,
  canPublish: (name) => canNames.includes(name),
  getMembers: (name) => membersByName[name] ?? [],
  getAllowedAuthors: () => null,
  getFormRef: () => null
});

describe('access tiers gate tabs and members', () => {
  it('getRestrictedTabIds includes access-tiered sections', () => {
    const restricted = getRestrictedTabIds(moderatedEvent);
    expect(restricted.has('learning')).toBe(true);
    expect(restricted.has('calendar')).toBe(true);
    expect(restricted.has('forum')).toBe(false);
  });

  it('getAccessibleTabIds respects canPublish on tiered sections', () => {
    const accessible = getAccessibleTabIds(moderatedEvent, access(['Calendar']));
    expect(accessible.has('calendar')).toBe(true);
    expect(accessible.has('learning')).toBe(false);
  });

  it('getVerifiedMembers aggregates members of tiered sections (owner always included)', () => {
    const { allMembers, perSection } = getVerifiedMembers(
      access([], { Calendar: [MEMBER] }),
      moderatedEvent
    );
    expect(allMembers).toContain(OWNER);
    expect(allMembers).toContain(MEMBER);
    expect(perSection.get('Calendar')).toEqual([MEMBER]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/contentTypes-access-tiers.test.js`
Expected: FAIL — restricted/accessible sets are empty (sections have no `profileList`).

- [ ] **Step 3: Implement**

In `src/lib/helpers/contentTypes.js`: import `sectionIsGated` from `./communityRelays.js` (extend the existing import of `parseCommunityContentTypes`/`hasStrictContentMarker`), then replace all three occurrences of

```js
    if (!section.profileList) continue;
```

with

```js
    if (!sectionIsGated(section)) continue;
```

(at `getRestrictedTabIds:419`, `getAccessibleTabIds:439`, `getVerifiedMembers:518`).

- [ ] **Step 4: Run the new test and the neighbors**

Run: `pnpm vitest run src/lib/__tests__/contentTypes-access-tiers.test.js src/lib/__tests__/communityRelays.test.js`
Expected: PASS. Also run any existing contentTypes tests: `pnpm vitest run src/lib --silent 2>&1 | tail -20` should show no new failures (pre-existing flaky inbox/DM files excepted — see memory `flaky-inbox-tests-parallel`; rerun such files in isolation before blaming this change).

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/contentTypes.js src/lib/__tests__/contentTypes-access-tiers.test.js
git commit -m "feat(communikey): tab/member gating recognizes access tiers via sectionIsGated"
```

---

### Task 4: Root roster — pure view + thin reactive hook

**Files:**
- Create: `src/lib/groups/root-roster.js` (pure)
- Create: `src/lib/groups/root-roster.svelte.js` (thin hook)
- Test: `src/lib/__tests__/root-roster.test.js` (node; covers the pure view — the hook is a 3-line composition of already-tested pieces and gets exercised by Task 6's facade test)

**Interfaces:**
- Consumes: `channelKey(pointer)` from `src/lib/groups/community-pointer.js:36`; `useChannelRosters(getPointers)` from `src/lib/groups/channel-rosters.svelte.js:74` (returns `() => ({membersByKey, adminsByKey, refresh})`); `parseMembershipPointer` from Task 1. `GroupAdmin` objects from applesauce are `{pubkey: string, roles: string[]}` (39001 p-tag: pubkey + role names).
- Produces:
  - `rosterView(pointer, membersByKey, adminsByKey) → {members: Set<string>, admins: GroupAdmin[], isLoading: boolean, isMember(pubkey): boolean, rolesOf(pubkey): string[]}`
  - `useRootRoster(getCommunikeyEvent) → () => ({pointer, refresh, ...rosterView})` — MUST be called during component init (wraps `useChannelRosters`, which uses `$effect`)

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/root-roster.test.js
import { describe, it, expect } from 'vitest';
import { rosterView } from '$lib/groups/root-roster.js';
import { channelKey } from '$lib/groups/community-pointer.js';

const RELAY = 'wss://groups.example.com';
const POINTER = { id: 'root1', relay: RELAY };
const KEY = channelKey(POINTER);
const ADMIN = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);

describe('rosterView', () => {
  it('unions 39002 members with 39001 admins (admins are members per NIP-29)', () => {
    const view = rosterView(
      POINTER,
      { [KEY]: new Set([MEMBER]) },
      { [KEY]: [{ pubkey: ADMIN, roles: ['lehrkraft'] }] }
    );
    expect(view.isMember(MEMBER)).toBe(true);
    expect(view.isMember(ADMIN)).toBe(true);
    expect(view.isMember(STRANGER)).toBe(false);
    expect(view.members).toEqual(new Set([MEMBER, ADMIN]));
    expect(view.isLoading).toBe(false);
  });

  it('rolesOf reads roles from 39001; non-admins have no roles', () => {
    const view = rosterView(POINTER, { [KEY]: new Set([MEMBER]) }, {
      [KEY]: [{ pubkey: ADMIN, roles: ['lehrkraft', 'mod'] }]
    });
    expect(view.rolesOf(ADMIN)).toEqual(['lehrkraft', 'mod']);
    expect(view.rolesOf(MEMBER)).toEqual([]);
  });

  it('isLoading while neither roster event has arrived for the key', () => {
    const loading = rosterView(POINTER, {}, {});
    expect(loading.isLoading).toBe(true);
    expect(loading.isMember(MEMBER)).toBe(false);
    // a 39001 alone ends loading (some relays withhold 39002 — NIP-29 says
    // clients must not assume it exists)
    expect(rosterView(POINTER, {}, { [KEY]: [{ pubkey: ADMIN, roles: [] }] }).isLoading).toBe(
      false
    );
  });

  it('null pointer → empty, not loading', () => {
    const view = rosterView(null, {}, {});
    expect(view.isLoading).toBe(false);
    expect(view.members.size).toBe(0);
    expect(view.admins).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/root-roster.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both files**

```js
// src/lib/groups/root-roster.js
//
// Pure projection of the batched roster records (channel-rosters.svelte.js)
// onto ONE root group — the community's membership engine per
// docs/nips/communikey-groups.md. Admins (39001) are unioned into members:
// NIP-29 counts users with privileged roles as members, and some relays
// return 39001 without a 39002.
import { channelKey } from './community-pointer.js';

/**
 * @typedef {import('applesauce-common/helpers/groups').GroupAdmin} GroupAdmin
 * @typedef {Object} RosterView
 * @property {Set<string>} members
 * @property {GroupAdmin[]} admins
 * @property {boolean} isLoading - true until at least one roster event arrived
 * @property {(pubkey: string) => boolean} isMember
 * @property {(pubkey: string) => string[]} rolesOf
 */

/**
 * @param {{id: string, relay: string} | null} pointer
 * @param {Record<string, Set<string>>} membersByKey
 * @param {Record<string, GroupAdmin[]>} adminsByKey
 * @returns {RosterView}
 */
export function rosterView(pointer, membersByKey, adminsByKey) {
  const key = pointer ? channelKey(pointer) : null;
  const memberSet = key ? membersByKey[key] : undefined;
  const admins = (key && adminsByKey[key]) || [];
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain derived value, never $state
  const members = new Set(memberSet ?? []);
  for (const admin of admins) members.add(admin.pubkey);
  const isLoading = !!key && memberSet === undefined && !(key && adminsByKey[key]);
  return {
    members,
    admins,
    isLoading,
    isMember: (pubkey) => members.has(pubkey),
    rolesOf: (pubkey) => admins.find((admin) => admin.pubkey === pubkey)?.roles ?? []
  };
}
```

```js
// src/lib/groups/root-roster.svelte.js
//
// Reactive roster of a moderated community's ROOT group. Reuses the batched
// useChannelRosters loader (one REQ per relay, debounced, refresh self-heal)
// with a single pointer — no second subscription pattern.
// MUST be called during component init (it wraps a $effect-based hook).
import { useChannelRosters } from './channel-rosters.svelte.js';
import { parseMembershipPointer } from './community-membership.js';
import { rosterView } from './root-roster.js';

/**
 * @param {() => any} getCommunikeyEvent - Getter for the kind 10222 event
 * @returns {() => import('./root-roster.js').RosterView & {
 *   pointer: {id: string, relay: string} | null,
 *   refresh: () => void
 * }}
 */
export function useRootRoster(getCommunikeyEvent) {
  const getRosters = useChannelRosters(() => {
    const pointer = parseMembershipPointer(getCommunikeyEvent());
    return pointer ? [pointer] : [];
  });
  return () => {
    const pointer = parseMembershipPointer(getCommunikeyEvent());
    const { membersByKey, adminsByKey, refresh } = getRosters();
    return { pointer, refresh, ...rosterView(pointer, membersByKey, adminsByKey) };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/root-roster.test.js`
Expected: PASS. Note: if the `isLoading` expression reads awkwardly, simplify to `const hasAdmins = !!(key && adminsByKey[key]); const isLoading = !!key && memberSet === undefined && !hasAdmins;` — same semantics, must keep all four test cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/groups/root-roster.js src/lib/groups/root-roster.svelte.js src/lib/__tests__/root-roster.test.js
git commit -m "feat(groups): root-group roster view + useRootRoster hook"
```

---

### Task 5: Pure roster gating — `roster-access.js`

**Files:**
- Create: `src/lib/groups/roster-access.js`
- Test: `src/lib/__tests__/roster-access.test.js`

**Interfaces:**
- Consumes: `RosterView` from Task 4; `ContentTypeConfig` (with `access`) from Task 2.
- Produces:
  - `sectionAllowedAuthors(section, roster, ownerPubkey) → string[] | null` — null = open (tier `all`); otherwise the allowed author pubkeys (owner always included)
  - `canPublishSection(section, {pubkey, ownerPubkey, roster}) → boolean`

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/roster-access.test.js
import { describe, it, expect } from 'vitest';
import { sectionAllowedAuthors, canPublishSection } from '$lib/groups/roster-access.js';
import { rosterView } from '$lib/groups/root-roster.js';
import { channelKey } from '$lib/groups/community-pointer.js';

const RELAY = 'wss://groups.example.com';
const POINTER = { id: 'root1', relay: RELAY };
const KEY = channelKey(POINTER);
const OWNER = 'f'.repeat(64);
const TEACHER = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);

const roster = rosterView(
  POINTER,
  { [KEY]: new Set([MEMBER, TEACHER]) },
  { [KEY]: [{ pubkey: TEACHER, roles: ['lehrkraft'] }] }
);
const loadingRoster = rosterView(POINTER, {}, {});
const section = (access) => ({ name: 'Learning', access, profileList: null });

describe('sectionAllowedAuthors', () => {
  it('tier all → null (open, no filtering)', () => {
    expect(sectionAllowedAuthors(section({ tier: 'all' }), roster, OWNER)).toBeNull();
    expect(sectionAllowedAuthors(section(undefined), roster, OWNER)).toBeNull();
  });
  it('tier members → roster members plus owner', () => {
    const allowed = sectionAllowedAuthors(section({ tier: 'members' }), roster, OWNER);
    expect(allowed).toEqual(expect.arrayContaining([OWNER, MEMBER, TEACHER]));
    expect(allowed).not.toContain(STRANGER);
  });
  it('tier role → only role holders plus owner', () => {
    const allowed = sectionAllowedAuthors(
      section({ tier: 'role', role: 'lehrkraft' }),
      roster,
      OWNER
    );
    expect(allowed).toEqual(expect.arrayContaining([OWNER, TEACHER]));
    expect(allowed).not.toContain(MEMBER);
  });
});

describe('canPublishSection', () => {
  const args = (pubkey, r = roster) => ({ pubkey, ownerPubkey: OWNER, roster: r });
  it('owner always may publish; anonymous never', () => {
    expect(canPublishSection(section({ tier: 'role', role: 'x' }), args(OWNER))).toBe(true);
    expect(canPublishSection(section({ tier: 'all' }), args(undefined))).toBe(false);
  });
  it('tier all → any signed-in user', () => {
    expect(canPublishSection(section({ tier: 'all' }), args(STRANGER))).toBe(true);
  });
  it('tier members / role check the roster', () => {
    expect(canPublishSection(section({ tier: 'members' }), args(MEMBER))).toBe(true);
    expect(canPublishSection(section({ tier: 'members' }), args(STRANGER))).toBe(false);
    expect(canPublishSection(section({ tier: 'role', role: 'lehrkraft' }), args(TEACHER))).toBe(
      true
    );
    expect(canPublishSection(section({ tier: 'role', role: 'lehrkraft' }), args(MEMBER))).toBe(
      false
    );
  });
  it('while the roster is loading, non-owners are denied (conservative, like profile lists)', () => {
    expect(canPublishSection(section({ tier: 'members' }), args(MEMBER, loadingRoster))).toBe(
      false
    );
    expect(canPublishSection(section({ tier: 'members' }), args(OWNER, loadingRoster))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/roster-access.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/lib/groups/roster-access.js
//
// Publish gating against the root-group roster, per the communikey-groups
// NIP draft: `access` tiers are WRITE gating evaluated against the CURRENT
// roster (moderation is retroactive by design — removing a member removes
// their content from the community view). The owner is always allowed:
// the community keypair moderates its own surface.

/**
 * @typedef {import('./root-roster.js').RosterView} RosterView
 * @typedef {{tier: 'all'}|{tier: 'members'}|{tier: 'role', role: string}} AccessTier
 */

/**
 * Allowed author pubkeys for a section, or null when the section is open.
 * @param {{access?: AccessTier} | null | undefined} section
 * @param {RosterView} roster
 * @param {string} ownerPubkey
 * @returns {string[] | null}
 */
export function sectionAllowedAuthors(section, roster, ownerPubkey) {
  const access = section?.access;
  if (!access || access.tier === 'all') return null;
  const allowed = new Set(ownerPubkey ? [ownerPubkey] : []);
  if (access.tier === 'members') {
    for (const pubkey of roster.members) allowed.add(pubkey);
  } else {
    for (const admin of roster.admins) {
      if (admin.roles?.includes(access.role)) allowed.add(admin.pubkey);
    }
  }
  return [...allowed];
}

/**
 * Whether `pubkey` may publish this section's content types to the community.
 * Conservative while the roster loads: only the owner passes.
 * @param {{access?: AccessTier} | null | undefined} section
 * @param {{pubkey?: string, ownerPubkey: string, roster: RosterView}} ctx
 * @returns {boolean}
 */
export function canPublishSection(section, { pubkey, ownerPubkey, roster }) {
  if (!pubkey) return false;
  if (pubkey === ownerPubkey) return true;
  const allowed = sectionAllowedAuthors(section, roster, ownerPubkey);
  if (allowed === null) return true;
  if (roster.isLoading) return false;
  return allowed.includes(pubkey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/roster-access.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/groups/roster-access.js src/lib/__tests__/roster-access.test.js
git commit -m "feat(groups): roster-based publish gating (sectionAllowedAuthors/canPublishSection)"
```

---

### Task 6: `useCommunityAccess` facade + layout swap

**Files:**
- Create: `src/lib/stores/community-access.svelte.js`
- Modify: `src/routes/c/[pubkey]/+layout.svelte` — the `useProfileListAccess(...)` call at `:138` (context key `'profileAccess'` set at `:161` stays UNCHANGED)
- Test: `src/lib/__tests__/community-access.svelte.test.js` (jsdom, hooks mocked)

**Interfaces:**
- Consumes: `useProfileListAccess(getCommunityEvent, getRelays)` from `src/lib/stores/profile-list-access.svelte.js:34` (interface `ProfileListAccess`: `isLoading`, `canPublish(name)`, `getMembers(name)`, `getAllowedAuthors(name)`, `getFormRef(name)`); `useRootRoster` (Task 4); `deriveCommunityType`, `parseApplicationRef` (Task 1); `parseCommunityContentTypes`, `sectionIsGated` (Task 2); `sectionAllowedAuthors`, `canPublishSection` (Task 5); `manager` from `$lib/stores/accounts.svelte`.
- Produces: `useCommunityAccess(getCommunityEvent, getRelays) → ProfileListAccess` — the SAME interface; moderated communities answer from the root roster, everything else delegates to the legacy hook. Every consumer of the `'profileAccess'` context (`getVerifiedMembers`, `getAccessibleTabIds`, `filterEventsByAccess`, `ChannelCreateWizard`, …) keeps working untouched.

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment jsdom */
// src/lib/__tests__/community-access.svelte.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const legacy = {
  isLoading: false,
  canPublish: vi.fn(() => 'legacy-canPublish'),
  getMembers: vi.fn(() => ['legacy-member']),
  getAllowedAuthors: vi.fn(() => ['legacy-author']),
  getFormRef: vi.fn(() => 'legacy-form')
};
let rosterState;

vi.mock('$lib/stores/profile-list-access.svelte.js', () => ({
  useProfileListAccess: vi.fn(() => legacy)
}));
vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: vi.fn(() => () => rosterState)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { get active() { return { pubkey: ACTIVE }; } }
}));

const ACTIVE = 'b'.repeat(64);
const OWNER = 'f'.repeat(64);
const TEACHER = 'a'.repeat(64);
const RELAY = 'wss://groups.example.com';

const { useCommunityAccess } = await import('$lib/stores/community-access.svelte.js');

const moderatedEvent = {
  kind: 10222,
  pubkey: OWNER,
  tags: [
    ['membership', 'root1', RELAY],
    ['application', `30168:${OWNER}:beitritt`, RELAY],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'role', 'lehrkraft'],
    ['content', 'Calendar'],
    ['k', '31922'],
    ['access', 'members'],
    ['content', 'Forum'],
    ['k', '11']
  ]
};
const openEvent = { kind: 10222, pubkey: OWNER, tags: [['content', 'Forum'], ['k', '11']] };

beforeEach(() => {
  rosterState = {
    pointer: { id: 'root1', relay: RELAY },
    refresh: vi.fn(),
    members: new Set([ACTIVE, TEACHER]),
    admins: [{ pubkey: TEACHER, roles: ['lehrkraft'] }],
    isLoading: false,
    isMember: (pk) => new Set([ACTIVE, TEACHER]).has(pk),
    rolesOf: (pk) => (pk === TEACHER ? ['lehrkraft'] : [])
  };
  vi.clearAllMocks();
});

describe('useCommunityAccess — moderated communities', () => {
  const access = useCommunityAccess(() => moderatedEvent, () => [RELAY]);

  it('answers canPublish from the roster (active user is member, not lehrkraft)', () => {
    expect(access.canPublish('Calendar')).toBe(true);
    expect(access.canPublish('Learning')).toBe(false);
    expect(access.canPublish('Forum')).toBe(true); // tier all
    expect(legacy.canPublish).not.toHaveBeenCalled();
  });

  it('getAllowedAuthors: null for open sections, roster-derived otherwise', () => {
    expect(access.getAllowedAuthors('Forum')).toBeNull();
    expect(access.getAllowedAuthors('Calendar')).toEqual(
      expect.arrayContaining([OWNER, ACTIVE, TEACHER])
    );
    expect(access.getAllowedAuthors('Learning')).toEqual(
      expect.arrayContaining([OWNER, TEACHER])
    );
    expect(access.getAllowedAuthors('Learning')).not.toContain(ACTIVE);
    expect(access.getAllowedAuthors('NoSuchSection')).toBeNull();
  });

  it('getMembers: roster members for gated sections, empty for open ones', () => {
    expect(access.getMembers('Calendar')).toEqual(expect.arrayContaining([ACTIVE, TEACHER]));
    expect(access.getMembers('Forum')).toEqual([]);
  });

  it('getFormRef: the community-level application address for gated sections only', () => {
    expect(access.getFormRef('Calendar')).toBe(`30168:${OWNER}:beitritt`);
    expect(access.getFormRef('Forum')).toBeNull();
  });

  it('isLoading follows the roster', () => {
    rosterState = { ...rosterState, isLoading: true };
    expect(access.isLoading).toBe(true);
  });
});

describe('useCommunityAccess — open/legacy communities delegate wholesale', () => {
  const access = useCommunityAccess(() => openEvent, () => [RELAY]);
  it('delegates every method to useProfileListAccess', () => {
    expect(access.canPublish('Forum')).toBe('legacy-canPublish');
    expect(access.getMembers('Forum')).toEqual(['legacy-member']);
    expect(access.getAllowedAuthors('Forum')).toEqual(['legacy-author']);
    expect(access.getFormRef('Forum')).toBe('legacy-form');
    expect(access.isLoading).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/community-access.svelte.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the facade**

```js
// src/lib/stores/community-access.svelte.js
//
// ONE access checker for community sections, behind the exact
// ProfileListAccess interface every existing consumer already speaks
// (layout context 'profileAccess'). Backend chosen per call from the
// community type (docs/nips/communikey-groups.md):
//   moderated → NIP-29 root-group roster + access tiers
//   open / legacy-gated → the kind-30000 profile-list hook, unchanged
// Both wrapped hooks no-op internally when their trigger tags are absent,
// so instantiating both costs nothing.
// MUST be called during component init (both wrapped hooks use $effect).
import { manager } from '$lib/stores/accounts.svelte';
import { useProfileListAccess } from './profile-list-access.svelte.js';
import { useRootRoster } from '$lib/groups/root-roster.svelte.js';
import { deriveCommunityType, parseApplicationRef } from '$lib/groups/community-membership.js';
import { parseCommunityContentTypes, sectionIsGated } from '$lib/helpers/communityRelays.js';
import { sectionAllowedAuthors, canPublishSection } from '$lib/groups/roster-access.js';

/**
 * @param {() => any} getCommunityEvent - Getter for the kind 10222 event
 * @param {() => string[]} getRelays - Relays for legacy profile-list loading
 * @returns {import('./profile-list-access.svelte.js').ProfileListAccess}
 */
export function useCommunityAccess(getCommunityEvent, getRelays) {
  const legacy = useProfileListAccess(getCommunityEvent, getRelays);
  const getRoster = useRootRoster(getCommunityEvent);

  const isModerated = () => deriveCommunityType(getCommunityEvent()) === 'moderated';
  /** @param {string} sectionName */
  const sectionByName = (sectionName) =>
    parseCommunityContentTypes(getCommunityEvent()).find((s) => s.name === sectionName) ?? null;

  return {
    get isLoading() {
      return isModerated() ? getRoster().isLoading : legacy.isLoading;
    },
    canPublish(sectionName) {
      if (!isModerated()) return legacy.canPublish(sectionName);
      return canPublishSection(sectionByName(sectionName), {
        pubkey: manager.active?.pubkey,
        ownerPubkey: getCommunityEvent()?.pubkey,
        roster: getRoster()
      });
    },
    getMembers(sectionName) {
      if (!isModerated()) return legacy.getMembers(sectionName);
      const section = sectionByName(sectionName);
      if (!sectionIsGated(section)) return [];
      return [...getRoster().members];
    },
    getAllowedAuthors(sectionName) {
      if (!isModerated()) return legacy.getAllowedAuthors(sectionName);
      return sectionAllowedAuthors(
        sectionByName(sectionName),
        getRoster(),
        getCommunityEvent()?.pubkey
      );
    },
    getFormRef(sectionName) {
      if (!isModerated()) return legacy.getFormRef(sectionName);
      if (!sectionIsGated(sectionByName(sectionName))) return null;
      return parseApplicationRef(getCommunityEvent())?.address ?? null;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/community-access.svelte.test.js`
Expected: PASS. (If the top-level-await import trips the runner, move the `await import` into a `beforeAll` — mocks must be registered before the module loads either way.)

- [ ] **Step 5: Swap the instantiation site**

In `src/routes/c/[pubkey]/+layout.svelte`: replace the import of `useProfileListAccess` with

```js
import { useCommunityAccess } from '$lib/stores/community-access.svelte.js';
```

and change the call at `:138` from `useProfileListAccess(` to `useCommunityAccess(` (same two getter arguments, same variable, same `setContext('profileAccess', …)` at `:161`).

- [ ] **Step 6: Run the blast-radius tests**

Run: `pnpm vitest run src/routes/c/\[pubkey\]/__tests__ src/lib/components/__tests__/ContentNavSidebar.group-channels.test.svelte.js src/lib/__tests__/profile-list-access.test.js`
Expected: PASS — the facade is interface-identical; any failure here means the delegation broke, not the consumers.

- [ ] **Step 7: Full verification + spec sync**

```bash
pnpm test        # full unit+component suite (flaky inbox/DM files: rerun in isolation before blaming this change)
pnpm run check   # svelte-check
pnpm run lint
```

Then re-read `docs/nips/communikey-groups.md` against what was built. This plan implements it verbatim (membership/application/access tags, XOR fallback, current-roster write gating, owner always allowed, 39001∪39002 membership); if any detail had to deviate, update the NIP draft in this commit.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/community-access.svelte.js src/routes/c/\[pubkey\]/+layout.svelte src/lib/__tests__/community-access.svelte.test.js
git commit -m "feat(communikey): useCommunityAccess facade — roster gating behind the ProfileListAccess interface"
```

---

## Out of scope for this plan (→ plans 2 and 3)

- `GROUPS_ENABLED` feature flag, creation-wizard type step, type flips, settings panes (plan 2)
- Two-zone sidebar, join button / 9021, application-form intake p-tagged to 39001 admins, approvals→put-user, Geschlossen shell page, E2E vs live buzz relay, handoff UX-debt items #5–#12 (plan 3)
- Live-relay verification of role visibility in 39001 for non-privileged roles (e.g. `lehrkraft`) on buzz happens at the START of plan 3's gating E2E — if buzz omits such roles from 39001, the `role` tier needs a put-user-with-role round-trip test and possibly a spec note.
