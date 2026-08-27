# Groups Plan 3: Settings, Type Flips & Membership Management — Implementation Plan (3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give community owners the settings surfaces the design promises — a Typ pane with open↔moderated flips, a per-section access editor, root-group member/role management, and application-form management — while closing the legacy-write and double-tag hazards and unifying owner gating.

**Architecture:** All 10222 mutations in this plan are **surgical tag edits** on the live event (pure `with*`/`strip*` helpers + `publishCommunityUpdate`), never full rebuilds — that structurally avoids the `preservePointerTags`+`opts` double-tag hazard (design follow-up #8). UI panes live in the existing `SettingsView.svelte` card list; roster management reuses `GroupMembersModal` fed by `useRootRoster`.

**Tech Stack:** SvelteKit + Svelte 5 runes, JavaScript with JSDoc, Vitest, applesauce.

**Spec:** `docs/superpowers/specs/2026-08-12-groups-architecture-design.md` (settings panes §, follow-ups #2/#4/#5/#8) and `docs/nips/communikey-groups.md` (type transitions, legacy MUST-NOT-write).

**Controller scope decisions (do not re-litigate):**
- Owner gating unifies on **key-holding**: `manager.getAccountForPubkey(communityPubkey)` (handoff #12). Sites keeping a *social* meaning (MembersView owner badge, roster-access owner-always rules) stay on pubkey comparison.
- Flip to moderated strips legacy section ACL tags (`30000:` a-tags + `'form'`-marked a-tags) — follow-up #2. Flip to open strips `membership`/`application`/all `access` tags/all `group` channel tags (NIP "type transitions"), with a confirm dialog listing affected channels.
- The **create** wizard stops offering legacy form-gating entirely (design's wizard has no ACL step); the kind-30000 creation loop is deleted. `EditCommunityModal` keeps the legacy UI for open communities (existing gated communities stay manageable) but is hard-guarded for moderated ones.
- Role vocabulary: no kind-39003 reads yet (nothing in the wild uses it here). Role suggestions = union of role names present in the root group's 39001 plus `'admin'`; free-text entry allowed.
- Invite codes (9009) and the wizard Personen step stay deferred to Plan 4 (join flows). Settings invites = put-user by npub (already in GroupMembersModal).
- Deferred plan-2 minors taken here: founding-marker admin check (#9 of plan-2 final review), orphaned `concord_create_with_area_*` keys (key hint surfaces on the Geschlossen type card), `getCommunityWideFormRef` tier-awareness (follow-up #4).
- One-shot dashboard roster REQ (follow-up #6 adjunct) stays deferred to Plan 4.

## Global Constraints

- Worktree `/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer`, branch `feat/community-group-pointer`. Paths relative to it.
- JavaScript with JSDoc only. `pnpm run check` MUST exit 0 after every task (currently 0 errors / 7 pre-existing warnings). Malformed test fixtures use `/** @type {any} */` casts (see `src/lib/__tests__/concord-pointer.test.js`).
- Unit tests in `src/lib/__tests__/` (node) or `src/lib/components/__tests__/` (jsdom), TDD, `pnpm vitest run <path>`.
- Every user-visible string: Paraglide key in BOTH `messages/de.json` (German source) and `messages/en.json`. Settings keys extend the `community_views_settings_*` family; copy style of `concord_settings_*`.
- NIP-29 admin ops (9000/9001/9002/9007) sign with the ACTIVE HUMAN's signer (`publishToGroupRelay(pool.relay(relay), template, user)`); 10222 updates sign with the COMMUNITY signer via `publishCommunityUpdate(template, communitySigner)` (`src/lib/helpers/publishCommunityUpdate.js:18`).
- Tag parsers/builders fail open on malformed input, never throw. Tag-derived arrays feeding keyed `{#each}` go through `unique()`/`uniqueBy()`.
- Never import applesauce-concord outside `src/lib/concord/`.
- Commit per task with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; do NOT push.

---

### Task 1: `getCommunitySigner` helper + unified owner gating

**Files:**
- Create: `src/lib/helpers/community-signer.js`
- Modify: `src/lib/components/community/views/SettingsView.svelte:39-43,68-70`; `src/lib/components/community/channels/PrivateChannelsView.svelte:127-129`; `src/lib/components/community/layout/ContentNavSidebar.svelte:90`; `src/lib/components/community/layout/BottomTabBar.svelte:89`; `src/lib/components/community/views/HomeView.svelte:72`; `src/lib/components/EditCommunityModal.svelte:423-431`; `src/lib/components/community/DeleteCommunityModal.svelte:38-41`; `src/lib/components/community/channels/AreaAttachModal.svelte:147`; `src/lib/components/community/channels/ChannelCreateWizard.svelte:141`; `src/lib/components/groups/GroupChat.svelte:548`
- Test: Create `src/lib/__tests__/community-signer.test.js`; Modify `src/lib/components/__tests__/PrivateChannelsView.test.js` (the `:51` founding-pane gate assertion pins the OLD naive behavior — update it to the new key-holding semantics, plus one new case: active account ≠ community pubkey but manager holds the community key → owner UI visible)

**Interfaces:**
- Produces: `getCommunitySigner(communityPubkey) → signer | null` and `isCommunityOwner(communityPubkey) → boolean` (`!!getCommunitySigner(...)`). Components call them inside `$derived.by` so manager reactivity applies. All ELEVEN sites above route through the helper (the six existing signer-lookup copies AND the five naive `pubkey === activeUser.pubkey` gates — handoff #12: owners running a community from a separate keypair get admin UI everywhere).

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/community-signer.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @type {Map<string, any>} */
let accounts;
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    getAccountForPubkey: (/** @type {string} */ pk) => accounts.get(pk) ?? undefined
  }
}));

const { getCommunitySigner, isCommunityOwner } = await import('$lib/helpers/community-signer.js');

const PK = 'a'.repeat(64);
const SIGNER = { signEvent: () => {} };

beforeEach(() => {
  accounts = new Map();
});

describe('getCommunitySigner / isCommunityOwner', () => {
  it('returns the signer when the manager holds the community key', () => {
    accounts.set(PK, { signer: SIGNER });
    expect(getCommunitySigner(PK)).toBe(SIGNER);
    expect(isCommunityOwner(PK)).toBe(true);
  });
  it('null/false when the key is not held, for empty input, and for accounts without signer', () => {
    expect(getCommunitySigner(PK)).toBeNull();
    expect(isCommunityOwner(PK)).toBe(false);
    expect(getCommunitySigner(undefined)).toBeNull();
    accounts.set(PK, {});
    expect(getCommunitySigner(PK)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/lib/__tests__/community-signer.test.js` → module not found.

- [ ] **Step 3: Implement the helper**

```js
// src/lib/helpers/community-signer.js
//
// ONE definition of "may act as this community": the signed-in manager holds
// the community's key. Communities run from a separate keypair (owner logged
// in with their personal account, community key also imported) count as
// owned — the old `activeUser.pubkey === communityPubkey` checks did not
// (handoff issue #12). Call inside $derived.by so manager reactivity applies.
import { manager } from '$lib/stores/accounts.svelte';

/**
 * @param {string | undefined | null} communityPubkey
 * @returns {any | null} the community account's signer, or null
 */
export function getCommunitySigner(communityPubkey) {
  if (!communityPubkey) return null;
  return manager.getAccountForPubkey(communityPubkey)?.signer ?? null;
}

/**
 * @param {string | undefined | null} communityPubkey
 * @returns {boolean}
 */
export function isCommunityOwner(communityPubkey) {
  return getCommunitySigner(communityPubkey) !== null;
}
```

- [ ] **Step 4: Swap all eleven sites.** Replace each naive `=== activeUser.pubkey`-style gate with `isCommunityOwner(<community pubkey>)` and each inline `manager.getAccountForPubkey(pk)?.signer` derivation with `getCommunitySigner(pk)` — keeping every surrounding `$derived.by` wrapper. Do NOT touch `MembersView.svelte:28` (badge = social role, not capability) or `roster-access.js` (protocol semantics). In `PrivateChannelsView.svelte`, `isConcordOwner` (`:130-132`) stays as-is — it reads the Concord material owner, a different concept (the rationale comment at `:112-126` explains it; extend that comment with one line noting `isCommunikeyOwner` is now key-holding-based).

- [ ] **Step 5: Update the pinned component test** per the Interfaces note (new behavior: founding pane shows when the manager holds the community key, regardless of which account is active).

- [ ] **Step 6: Verify** — `pnpm vitest run src/lib/__tests__/community-signer.test.js src/lib/components/__tests__/PrivateChannelsView.test.js src/lib/components/__tests__/ContentNavSidebar.group-channels.test.svelte.js` green; `pnpm run check` exit 0; `pnpm run lint` clean.

- [ ] **Step 7: Commit** — `fix(community): unify owner gating on key-holding (getCommunitySigner)`

---

### Task 2: Section access surgery — `withSectionAccess`

**Files:**
- Create: `src/lib/groups/section-access.js`
- Test: `src/lib/__tests__/section-access.test.js`

**Interfaces:**
- Produces: `withSectionAccess(tags, sectionName, access) → string[][]` — NEW array; finds the section span (`['content', sectionName]` up to the next `content` tag or end), removes every `access` tag inside it, and (when `access.tier !== 'all'`) inserts the new tag directly after the `content` tag. Unknown section name → tags returned unchanged (copy). `access: {tier:'all'} | {tier:'members'} | {tier:'role', role: string}`; a `role` tier with empty/whitespace role is treated as `'all'` (parity with builder/parser).

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/section-access.test.js
import { describe, it, expect } from 'vitest';
import { withSectionAccess } from '$lib/groups/section-access.js';
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';

const TAGS = [
  ['membership', 'root1', 'wss://g.example.com'],
  ['strict', 'content'],
  ['content', 'Learning'],
  ['k', '30142'],
  ['access', 'members'],
  ['content', 'Calendar'],
  ['k', '31922'],
  ['content', 'Forum'],
  ['k', '11']
];
const parse = (/** @type {string[][]} */ tags) =>
  parseCommunityContentTypes({ kind: 10222, tags });

describe('withSectionAccess', () => {
  it('replaces an existing tier without touching sibling sections', () => {
    const out = withSectionAccess(TAGS, 'Learning', { tier: 'role', role: 'lehrkraft' });
    const [learning, calendar, forum] = parse(out);
    expect(learning.access).toEqual({ tier: 'role', role: 'lehrkraft' });
    expect(calendar.access).toEqual({ tier: 'all' });
    expect(forum.access).toEqual({ tier: 'all' });
    expect(out.filter((t) => t[0] === 'access')).toHaveLength(1);
    expect(TAGS.filter((t) => t[0] === 'access')).toHaveLength(1); // input untouched
  });

  it('adds a tier to a section that had none, inside that section only', () => {
    const out = withSectionAccess(TAGS, 'Calendar', { tier: 'members' });
    const [learning, calendar] = parse(out);
    expect(calendar.access).toEqual({ tier: 'members' });
    expect(learning.access).toEqual({ tier: 'members' }); // untouched original
    const contentIdx = out.findIndex((t) => t[0] === 'content' && t[1] === 'Calendar');
    expect(out[contentIdx + 1]).toEqual(['access', 'members']);
  });

  it('tier all removes the tag; last section works; unknown section is a no-op copy', () => {
    const cleared = withSectionAccess(TAGS, 'Learning', { tier: 'all' });
    expect(parse(cleared)[0].access).toEqual({ tier: 'all' });
    expect(cleared.some((t) => t[0] === 'access')).toBe(false);

    const last = withSectionAccess(TAGS, 'Forum', { tier: 'members' });
    expect(parse(last)[2].access).toEqual({ tier: 'members' });

    const noop = withSectionAccess(TAGS, 'NoSuch', { tier: 'members' });
    expect(noop).toEqual(TAGS);
    expect(noop).not.toBe(TAGS);
  });

  it('empty role means all; membership tag and strict marker are never disturbed', () => {
    const out = withSectionAccess(TAGS, 'Learning', { tier: 'role', role: '  ' });
    expect(out.some((t) => t[0] === 'access')).toBe(false);
    expect(out).toContainEqual(['membership', 'root1', 'wss://g.example.com']);
    expect(out).toContainEqual(['strict', 'content']);
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```js
// src/lib/groups/section-access.js
//
// Surgical edit of ONE content section's access tier on a live kind-10222
// tag array (docs/nips/communikey-groups.md `access`). Never rebuilds the
// event — sibling sections, pointer tags, and unknown tags pass through
// verbatim, which is what keeps settings edits free of the
// preservePointerTags/opts double-tag hazard.

/** @typedef {{tier:'all'}|{tier:'members'}|{tier:'role', role?: string}} AccessTier */

/**
 * @param {string[][]} tags
 * @param {string} sectionName
 * @param {AccessTier} access
 * @returns {string[][]} a new array; unchanged copy when the section is absent
 */
export function withSectionAccess(tags, sectionName, access) {
  const start = tags.findIndex(
    (tag) => Array.isArray(tag) && tag[0] === 'content' && tag[1] === sectionName
  );
  if (start === -1) return [...tags];
  let end = tags.length;
  for (let i = start + 1; i < tags.length; i++) {
    if (Array.isArray(tags[i]) && tags[i][0] === 'content') {
      end = i;
      break;
    }
  }
  const section = tags
    .slice(start, end)
    .filter((tag) => !(Array.isArray(tag) && tag[0] === 'access'));
  const role = access.tier === 'role' ? (access.role ?? '').trim() : '';
  if (access.tier === 'members') {
    section.splice(1, 0, ['access', 'members']);
  } else if (access.tier === 'role' && role) {
    section.splice(1, 0, ['access', 'role', role]);
  }
  return [...tags.slice(0, start), ...section, ...tags.slice(end)];
}
```

- [ ] **Step 4: Run to verify pass**, plus `pnpm vitest run src/lib/__tests__/communityRelays.test.js`.

- [ ] **Step 5: Commit** — `feat(groups): withSectionAccess surgical tier editor`

---

### Task 3: Flip builders — `community-flips.js`

**Files:**
- Create: `src/lib/groups/community-flips.js`
- Test: `src/lib/__tests__/community-flips.test.js`

**Interfaces:**
- Consumes: `withoutMembershipPointer`, `withoutApplicationRef`, `buildMembershipTag` (`src/lib/groups/community-membership.js`); `parseGroupPointers` (for the UI's channel list, not the builders).
- Produces:
  - `stripLegacySectionAcl(tags) → string[][]` — removes every `['a','30000:...']` tag and every `'form'`-marked `['a','30168:...', *, 'form']` tag (legacy per-section gating; NIP: MUST NOT write).
  - `buildFlipToModeratedTags(tags, rootPointer) → string[][]` — `stripLegacySectionAcl`, then removes any pre-existing membership tags, then INSERTS `['membership', id, relay]` before the first `content` tag (or before `['strict','content']` if that comes first, or appends when neither exists). Sections keep no `access` tags — flipping never retroactively gates.
  - `buildFlipToOpenTags(tags) → string[][]` — removes `membership`, `application`, every `access` tag, and every `group` channel tag. Legacy `30000:` a-tags are ALSO stripped (they were unreachable state on a moderated event).
  - `communityUpdateTemplate(sourceEvent, tags) → {kind:10222, content, tags, created_at}` — `created_at = max(now, source.created_at + 1)` (same bump rule as `buildGroupAttachTemplate`, `src/lib/groups/community-attach.js:62`).

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/community-flips.test.js
import { describe, it, expect } from 'vitest';
import {
  stripLegacySectionAcl,
  buildFlipToModeratedTags,
  buildFlipToOpenTags,
  communityUpdateTemplate
} from '$lib/groups/community-flips.js';
import { deriveCommunityType, parseMembershipPointer } from '$lib/groups/community-membership.js';
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';

const PK = 'a'.repeat(64);
const RELAY = 'wss://g.example.com';
const OPEN_TAGS = [
  ['r', 'wss://relay.example.com'],
  ['strict', 'content'],
  ['content', 'Learning'],
  ['k', '30142'],
  ['a', `30000:${PK}:Learning`],
  ['a', `30168:${PK}:membership`, '', 'form'],
  ['content', 'Forum'],
  ['k', '11']
];
const MODERATED_TAGS = [
  ['r', 'wss://relay.example.com'],
  ['membership', 'root1', RELAY],
  ['application', `30168:${PK}:beitritt`, RELAY],
  ['strict', 'content'],
  ['content', 'Learning'],
  ['k', '30142'],
  ['access', 'role', 'lehrkraft'],
  ['group', 'chan1', RELAY, 'Kanal', 'members']
];

describe('stripLegacySectionAcl', () => {
  it('removes 30000 and form-marked 30168 a-tags, keeps everything else', () => {
    const out = stripLegacySectionAcl(OPEN_TAGS);
    expect(out.some((t) => t[0] === 'a')).toBe(false);
    expect(out).toContainEqual(['content', 'Learning']);
    expect(out).toContainEqual(['strict', 'content']);
    expect(OPEN_TAGS.filter((t) => t[0] === 'a')).toHaveLength(2); // input untouched
  });
  it('keeps non-form 30168 a-tags and badge a-tags out of scope', () => {
    const tags = [['content', 'X'], ['a', `30168:${PK}:x`], ['a', `30009:${PK}:writer`, 'write']];
    const out = stripLegacySectionAcl(tags);
    expect(out).toContainEqual(['a', `30168:${PK}:x`]);
    expect(out).toContainEqual(['a', `30009:${PK}:writer`, 'write']);
  });
});

describe('buildFlipToModeratedTags', () => {
  const flipped = buildFlipToModeratedTags(OPEN_TAGS, { id: 'root1', relay: RELAY });
  it('derives moderated, membership sits before the first content/strict tag', () => {
    expect(deriveCommunityType({ tags: flipped })).toBe('moderated');
    const membershipIdx = flipped.findIndex((t) => t[0] === 'membership');
    const strictIdx = flipped.findIndex((t) => t[0] === 'strict');
    const contentIdx = flipped.findIndex((t) => t[0] === 'content');
    expect(membershipIdx).toBeGreaterThan(-1);
    expect(membershipIdx).toBeLessThan(strictIdx);
    expect(membershipIdx).toBeLessThan(contentIdx);
  });
  it('strips legacy ACL, keeps sections ungated (never retroactively gates)', () => {
    expect(flipped.some((t) => t[0] === 'a')).toBe(false);
    const sections = parseCommunityContentTypes({ kind: 10222, tags: flipped });
    expect(sections.every((s) => s.access.tier === 'all')).toBe(true);
  });
  it('replaces a pre-existing membership tag instead of doubling', () => {
    const again = buildFlipToModeratedTags(flipped, { id: 'root2', relay: RELAY });
    expect(again.filter((t) => t[0] === 'membership')).toHaveLength(1);
    expect(parseMembershipPointer({ tags: again })).toEqual({ id: 'root2', relay: RELAY });
  });
});

describe('buildFlipToOpenTags', () => {
  const opened = buildFlipToOpenTags(MODERATED_TAGS);
  it('derives open; membership/application/access/group all gone; sections kept', () => {
    expect(deriveCommunityType({ tags: opened })).toBe('open');
    for (const key of ['membership', 'application', 'access', 'group']) {
      expect(opened.some((t) => t[0] === key)).toBe(false);
    }
    expect(opened).toContainEqual(['content', 'Learning']);
    expect(opened).toContainEqual(['k', '30142']);
  });
});

describe('communityUpdateTemplate', () => {
  it('bumps created_at past the source event', () => {
    const future = Math.floor(Date.now() / 1000) + 999;
    const template = communityUpdateTemplate(
      { kind: 10222, content: 'desc', created_at: future, tags: MODERATED_TAGS },
      buildFlipToOpenTags(MODERATED_TAGS)
    );
    expect(template.kind).toBe(10222);
    expect(template.content).toBe('desc');
    expect(template.created_at).toBe(future + 1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```js
// src/lib/groups/community-flips.js
//
// Type transitions per docs/nips/communikey-groups.md: open ↔ moderated as
// surgical tag edits on the live 10222 (closed never transitions). Flip to
// moderated also sunsets legacy per-section ACL (the spec's MUST-NOT-write
// tags) so mixed legacy+roster state cannot exist.
import { buildMembershipTag, withoutMembershipPointer, withoutApplicationRef } from './community-membership.js';

const isTag = (/** @type {unknown} */ tag) => Array.isArray(tag);

/**
 * Remove legacy per-section gating: profile-list a-tags and 'form'-marked
 * preferred-form a-tags. Badge (30009) and unmarked 30168 a-tags stay.
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function stripLegacySectionAcl(tags) {
  return tags.filter((tag) => {
    if (!isTag(tag) || tag[0] !== 'a' || typeof tag[1] !== 'string') return true;
    if (tag[1].startsWith('30000:')) return false;
    if (tag[1].startsWith('30168:') && tag[3] === 'form') return false;
    return true;
  });
}

/**
 * @param {string[][]} tags
 * @param {{id: string, relay: string}} rootPointer
 * @returns {string[][]}
 */
export function buildFlipToModeratedTags(tags, rootPointer) {
  const cleaned = withoutMembershipPointer(stripLegacySectionAcl(tags));
  const membershipTag = buildMembershipTag(rootPointer);
  const anchor = cleaned.findIndex(
    (tag) => isTag(tag) && (tag[0] === 'content' || tag[0] === 'strict')
  );
  if (anchor === -1) return [...cleaned, membershipTag];
  return [...cleaned.slice(0, anchor), membershipTag, ...cleaned.slice(anchor)];
}

/**
 * @param {string[][]} tags
 * @returns {string[][]}
 */
export function buildFlipToOpenTags(tags) {
  return stripLegacySectionAcl(withoutApplicationRef(withoutMembershipPointer(tags))).filter(
    (tag) => !(isTag(tag) && (tag[0] === 'access' || tag[0] === 'group'))
  );
}

/**
 * Unsigned 10222 replacement carrying the given tags. Same created_at bump
 * rule as buildGroupAttachTemplate: strictly newer than the source event.
 * @param {{kind: number, content: string, created_at: number}} sourceEvent
 * @param {string[][]} tags
 * @returns {{kind: number, content: string, tags: string[][], created_at: number}}
 */
export function communityUpdateTemplate(sourceEvent, tags) {
  return {
    kind: 10222,
    content: sourceEvent.content ?? '',
    tags,
    created_at: Math.max(Math.floor(Date.now() / 1000), (sourceEvent.created_at ?? 0) + 1)
  };
}
```

- [ ] **Step 4: Run to verify pass**, plus `pnpm vitest run src/lib/__tests__/community-membership.test.js`.

- [ ] **Step 5: Commit** — `feat(groups): open↔moderated flip tag builders + legacy ACL sunset`

---

### Task 4: Harden edit + provisioning against moderated legacy leaks

**Files:**
- Modify: `src/lib/components/EditCommunityModal.svelte` (load effect `~:117-193`, the kind-30000 loop `~:385-402`)
- Modify: `src/lib/groups/provision-root-group.js` (reuse path)
- Test: extend `src/lib/__tests__/provision-root-group.test.js`; create `src/lib/__tests__/edit-modal-moderated-guards.test.js` only if you extract logic — otherwise the two modal guards are one-line conditions verified by `pnpm run check` + existing modal-adjacent tests (state which you did in the report)

**Interfaces / required behavior:**
1. `EditCommunityModal` load effect: when `deriveCommunityType(communityEvent) === 'moderated'`, clear every loaded `contentTypes[key].formRef` to `''` after `applyParsedAccessTiers` runs (legacy remnants must not round-trip into `30000:` a-tags via the builder's `isNewSpec && formRef` branch).
2. `EditCommunityModal` kind-30000 publish loop (`~:385`): wrap in `if (!isModerated)` (the `isModerated` derived exists at `:48`).
3. `provisionRootGroup` reuse path: after `confirmGroupMetadata` confirms an `existingId`, ALSO fetch the group's 39001 (one `pool.relay(relay).request({kinds:[39001],'#d':[existingId]},{timeout:8000})` firstValueFrom-style read — mirror `confirmGroupMetadata`'s shape at `src/lib/groups/group-management.js:112`) and verify `user.pubkey` is listed via `getGroupAdmins` (`applesauce-common/helpers/groups`); if not an admin, ignore the marker and create fresh (poisoned/stale marker must not point the community at a foreign roster).

- [ ] **Step 1: Failing tests for the provisioning hardening** — extend `provision-root-group.test.js`: mock the 39001 fetch (extend the existing pool mock so `request` is controllable); cases: (a) existingId confirmed + user IS admin → reused, no create; (b) existingId confirmed + user NOT admin → fresh create; (c) 39001 fetch fails/empty → fresh create (fail safe). Update the one existing reuse test to provide an admin-listing 39001.
- [ ] **Step 2: Run to verify the new cases fail.**
- [ ] **Step 3: Implement all three behaviors.**
- [ ] **Step 4: Verify** — `pnpm vitest run src/lib/__tests__/provision-root-group.test.js src/lib/__tests__/communityTagBuilder.test.js`; `pnpm run check` exit 0; `pnpm run lint`.
- [ ] **Step 5: Commit** — `fix(groups): moderated edit guards + founding-marker admin verification`

---

### Task 5: `getCommunityWideFormRef` becomes tier-aware (follow-up #4)

**Files:**
- Modify: `src/lib/helpers/communityFormDefaults.js:77` (`getCommunityWideFormRef`)
- Test: extend `src/lib/__tests__/communityFormDefaults.test.js`

**Interfaces:** the function keeps its `(profileAccess, communityEvent)` signature but filters sections with `sectionIsGated` (import from `communityRelays.js`) instead of `s.profileList` — for a moderated community it then asks `profileAccess.getFormRef(section.name)`, which the facade answers with the `application` address. Behavior for legacy communities unchanged.

- [ ] **Step 1: Failing test** — moderated event (membership + one `access:members` section, `application` tag) + a stub profileAccess whose `getFormRef` returns the application address → function returns it; open event without gating → null; legacy profileList section behavior unchanged (reuse existing test fixtures in the file).
- [ ] **Step 2: Verify failure.** **Step 3: Implement (swap the filter + keep the first-non-null-formRef logic).** **Step 4: Verify** — the file's suite + `contentTypes-access-tiers.test.js`. **Step 5: Commit** — `fix(community): community-wide form ref recognizes access-tier gating`

---

### Task 6: SettingsView — spinner fix + Typ pane (flips UI)

**Files:**
- Modify: `src/lib/components/community/views/SettingsView.svelte`
- Modify: `messages/de.json` + `messages/en.json`
- Test: Create `src/lib/components/__tests__/SettingsView.test.js` (greenfield — no existing SettingsView test; mock `$lib/stores/accounts.svelte`, `$lib/concord/community.svelte.js`'s `useConcordCommunity`, `$lib/helpers/publishCommunityUpdate.js`, `$lib/groups/provision-root-group.js`; mount with a moderated and an open `communikeyEvent`)

**Interfaces:**
- Consumes: `deriveCommunityType`, `parseGroupPointers`; `buildFlipToModeratedTags`, `buildFlipToOpenTags`, `communityUpdateTemplate` (Task 3); `provisionRootGroup` + markers (Task 4 hardened); `moderatedCreationAvailable` (`$lib/groups/feature.js`); `getCommunitySigner`/`isCommunityOwner` (Task 1); `publishCommunityUpdate`; `getGroupsRelays`; `getDisplayName` (`applesauce-core/helpers`) on `profileEvent` for the root-group name (fallback `'Community'`).
- Produces / behavior:
  1. **Spinner fix (#9):** the gate at `:120` becomes `{#if communikeyEvent}`; the description card already guards on content; anything needing `profileEvent` guards itself locally.
  2. **Typ card** (owner-gated via `isCommunityOwner`), directly above the Concord card: shows the derived type using the existing `community_type_{open,moderated,closed}_title` keys and a body line. For **open** + `moderatedCreationAvailable()`: button "Auf Moderiert umstellen" → confirm dialog → `provisionRootGroup({relay: getGroupsRelays()[0], name: getDisplayName(profileEvent) || 'Community', user: {pubkey, signer} of the ACTIVE account, existingId: readRootGroupMarker(communityId)})` (write marker) → `publishCommunityUpdate(communityUpdateTemplate(communikeyEvent, buildFlipToModeratedTags(communikeyEvent.tags, pointer)), communitySigner)` → clear marker → success toast. For **moderated**: button "Auf Offen umstellen" → confirm dialog that LISTS the channels being detached (`parseGroupPointers(communikeyEvent).map(p => p.name || p.id)`, deduped) and warns membership stops gating → `publishCommunityUpdate(communityUpdateTemplate(..., buildFlipToOpenTags(...)), communitySigner)`. For **closed**: static text `community_type_closed_hint` (endgültig), no actions. Errors → toast, never partial UI state.
  3. The flip-to-moderated button requires BOTH `isCommunityOwner(communityId)` (10222 signer) and an active account (group admin signer) — disable with a hint otherwise.

**i18n keys** (de values; write English equivalents): `community_views_settings_type_title: "Community-Typ"`, `_type_current: "Aktueller Typ"`, `_flip_to_moderated: "Auf Moderiert umstellen"`, `_flip_to_moderated_confirm: "Es wird eine Mitgliederverwaltung angelegt. Bestehende Inhalte bleiben unverändert; Veröffentlichungsrechte kannst du danach pro Inhaltstyp einschränken."`, `_flip_to_open: "Auf Offen umstellen"`, `_flip_to_open_confirm: "Mitgliederverwaltung und Kanäle werden von der Community getrennt (Kanäle: {channels}). Alle Veröffentlichungs-Beschränkungen entfallen."`, `_flip_failed: "Umstellung fehlgeschlagen: {reason}"`, `_flip_done: "Community-Typ umgestellt."`, `_flip_needs_account: "Zum Umstellen musst du zusätzlich mit deinem persönlichen Konto angemeldet sein."`

- [ ] **Step 1: Failing component test** — moderated event renders the Typ card with the flip-to-open button; open event + mocked `moderatedCreationAvailable → true` renders flip-to-moderated; non-owner sees no Typ card; flip-to-open click → confirm → `publishCommunityUpdate` called with tags that derive to `'open'` (assert via `deriveCommunityType` on the captured template). Mirror the harness style of `src/lib/components/__tests__/PrivateChannelsView.management.test.svelte.js`.
- [ ] **Step 2: Verify failure.** **Step 3: Implement (card + handlers + i18n).** **Step 4: Verify** — new test + `pnpm run check` 0 + lint. **Step 5: Commit** — `feat(community): settings Typ pane with open↔moderated flips (+ kind-0 spinner fix)`

---

### Task 7: Inhalte & Rechte pane — per-section access editor

**Files:**
- Create: `src/lib/components/community/settings/AccessTierEditor.svelte`
- Modify: `src/lib/components/community/views/SettingsView.svelte` (render the card for moderated communities, owner-gated)
- Modify: `messages/de.json` + `messages/en.json`
- Test: Create `src/lib/components/__tests__/AccessTierEditor.test.js`

**Interfaces:**
- Props: `{ communikeyEvent, communitySigner, roleSuggestions = [] }`. Renders one row per section from `parseCommunityContentTypes(communikeyEvent)`: section name, a `<select>` with `alle` / `nur Mitglieder` / `Rolle` (values `all|members|role`), and — when `role` — a text input with a `<datalist>` fed by `roleSuggestions`. Saving a row calls `publishCommunityUpdate(communityUpdateTemplate(communikeyEvent, withSectionAccess(communikeyEvent.tags, section.name, chosen)), communitySigner)` (Tasks 2+3). Per-row save button, disabled while publishing; toast on error. Reuse `community_access_*` keys for tier labels; new keys: `community_access_editor_title: "Inhalte & Rechte"`, `_lead: "Wer darf welche Inhaltstypen veröffentlichen?"`, `_role_placeholder: "Rollenname"`, `_save: "Speichern"`, `_saved: "Gespeichert."`, `_save_failed: "Speichern fehlgeschlagen: {reason}"`.
- SettingsView passes `roleSuggestions` from Task 8's roster (union of `admins.flatMap(a => a.roles)` + `'admin'`, deduped via `unique()`); until Task 8 lands in the same plan, wire `roleSuggestions={[]}` and update in Task 8.

- [ ] **Step 1: Failing component test** — renders one row per section with the current tier preselected (fixture: moderated event with `members` + `role lehrkraft` + ungated sections); switching Learning to `role`+`lehrkraft` and saving calls `publishCommunityUpdate` with a template whose parsed Learning section is `{tier:'role', role:'lehrkraft'}` AND whose Calendar section is untouched; `all` save removes the tag.
- [ ] **Step 2: Verify failure.** **Step 3: Implement.** **Step 4: Verify + check + lint.** **Step 5: Commit** — `feat(community): per-section access tier editor in settings`

---

### Task 8: Mitglieder & Rollen pane — roster management + application form

**Files:**
- Modify: `src/lib/components/groups/GroupMembersModal.svelte` (optional role assignment)
- Create: `src/lib/components/community/settings/MembershipPane.svelte`
- Modify: `src/lib/components/community/views/SettingsView.svelte` (render for moderated, owner-gated; pass roleSuggestions to Task 7's editor)
- Modify: `messages/de.json` + `messages/en.json`
- Test: extend `src/lib/components/__tests__/GroupMembersModal.test.js`; create `src/lib/components/__tests__/MembershipPane.test.js`

**Interfaces:**
1. **GroupMembersModal extension:** new optional prop `roleOptions: string[] = []`. When non-empty, each admin/member row gains a compact role assign control (a `<select>` of `roleOptions` + free-text via the existing pattern, and an "Assign" button) calling the EXISTING `putUser(pubkey, [role])`. Existing promote/demote/add/remove behavior unchanged when `roleOptions` is empty (all current tests must pass unmodified). New i18n: `groups_members_assign_role: "Rolle zuweisen"`, `groups_members_role_placeholder: "Rolle"`.
2. **MembershipPane** props `{ communikeyEvent, communityId, profileEvent }`. Instantiates `useRootRoster(() => communikeyEvent)` (the `'profileAccess'` context deliberately does not expose the roster). Renders: member/admin counts; a "Mitglieder verwalten" button opening `GroupMembersModal` with `pointer` = roster pointer, `admins`/`members` from the roster, `myPubkey` = active user, `isAdmin` = active user in admins OR `isCommunityOwner(communityId)`, `onRosterChanged` = roster `refresh`, `roleOptions` = union of admin roles + `'admin'` (deduped). Below it the **application form card**: shows the current `parseApplicationRef(communikeyEvent)` (resolve display name via `useFormTemplates(() => [communityId, activeUser?.pubkey])` like `CreateCommunityModal.getFormName`), a select of available 30168 templates, a "Standard-Formular erstellen" button (`createDefaultMembershipForm(communitySigner)` → publish → select it), Save → `publishCommunityUpdate(communityUpdateTemplate(communikeyEvent, withApplicationRef(communikeyEvent.tags, {address, relay: getGroupsRelays()[0] ?? undefined})), communitySigner)`, Remove → same with `withoutApplicationRef`. New i18n keys: `community_membership_pane_title: "Mitglieder & Rollen"`, `_manage: "Mitglieder verwalten"`, `_member_count: "{count} Mitglieder"`, `_application_title: "Beitrittsformular"`, `_application_lead: "Wer beitreten möchte, füllt dieses Formular aus; Admins entscheiden über die Aufnahme."`, `_application_none: "Kein Formular hinterlegt — Beitritt per Einladung."`, `_application_save: "Übernehmen"`, `_application_remove: "Formular entfernen"`, `_application_create_default: "Standard-Formular erstellen"`, `_application_saved: "Gespeichert."`, `_application_failed: "Speichern fehlgeschlagen: {reason}"`.
3. Application `relay` hint: use the membership pointer's relay from the roster (fallback: first `getCommunikeyRelays()`), not GROUPS_RELAYS — the form must be findable where the community lives. (Correction to the sketch above: prefer `parseApplicationRef`'s existing relay when editing; for new refs use the form template's seen relay if cheaply available, else the first community relay. Keep it one line and comment it.)

- [ ] **Step 1: Failing tests** — GroupMembersModal: with `roleOptions={['lehrkraft','admin']}` an admin sees the assign control and assigning fires put-user with `['lehrkraft']` (extend the existing mock harness); with the prop omitted the previous suite passes byte-identical. MembershipPane: mocked `useRootRoster` (members/admins/pointer/refresh) renders counts and passes correct props to a stubbed GroupMembersModal; saving an application form calls `publishCommunityUpdate` with tags whose `parseApplicationRef` matches.
- [ ] **Step 2: Verify failure.** **Step 3: Implement.** **Step 4: Verify + check + lint.** **Step 5: Commit** — `feat(community): membership & roles pane on the root group + application form management`

---

### Task 9: Creation wizard sunset + closed-card key hint

**Files:**
- Modify: `src/lib/components/CreateCommunityModal.svelte`
- Modify: `messages/de.json` + `messages/en.json` (only if a key must change; the key hint reuses `concord_create_with_area_key_hint`)
- Modify: `e2e/community-creation.test.js` + `e2e/COVERAGE.md` (only if any spec references the removed ACL UI — check first)
- Test: run the wizard-adjacent suites; extend `src/lib/__tests__/community-wizard-logic.test.js` only if logic moves there

**Required behavior (design: the wizard has no legacy ACL step):**
1. Remove the ACL configuration from the CREATE modal for all types: the `ContentTypesAndACL` usage passes `hideAccessToggle={true}` (or the ACL block is dropped from the create path entirely — choose the smaller diff), `showAccessConfig`/`defaultFormRef`/`handleCreateDefaultForm` and the `getFormTemplates` wiring are removed from CreateCommunityModal (they live on in EditCommunityModal and Task 8's pane), and the `communityType === 'open'`-gated kind-30000 creation loop (`~:593-618`) is DELETED — creation never writes profile lists anymore.
2. The Geschlossen type card gains the key-ownership hint line: render `concord_create_with_area_key_hint` as small print on the closed card (this un-orphans the `concord_create_with_area_*` family; delete `concord_create_with_area_title`/`_body` from BOTH message files if nothing references them after this change — grep first).
3. Flags-off collapse must still hold: with the type step hidden, an open community's creation flow simply no longer offers ACL config (deliberate product change, design-approved) — update any e2e that asserted the ACL toggle's presence (check `grep -n "form_config\|access control\|Configure access" e2e/`), and note the change in `e2e/COVERAGE.md`.

- [ ] **Step 1: Grep e2e + component tests for references to the removed UI; list them in the report.**
- [ ] **Step 2: Implement the removal + hint.**
- [ ] **Step 3: Verify** — `pnpm vitest run src/lib/__tests__/community-wizard-logic.test.js src/lib/__tests__/communityTagBuilder.test.js`; `pnpm run check` 0; `pnpm run lint`; then the e2e spec: `pnpm run test:e2e -- community-creation` (host env: `CHROMIUM_BIN=google-chrome E2E_DISABLE_LNA_CHECKS=1` if nix chromium is still broken) — all green.
- [ ] **Step 4: Commit** — `feat(community): creation wizard sunsets legacy form-gating; closed card carries key-ownership hint`

---

### Task 10: Full verification + docs sync

- [ ] **Step 1:** `pnpm test` (expect only the pre-existing pomegranate collection failure; known-flaky files rerun in isolation), `pnpm run check` exit 0, `pnpm run lint`.
- [ ] **Step 2: Docs sync.** `docs/nips/communikey-groups.md`: in the Legacy section add: "Clients SHOULD NOT offer creating new profile-list gating; they MAY preserve existing profile-list tags when editing a legacy community. Flipping a community to moderated MUST strip them." `docs/superpowers/specs/2026-08-12-groups-architecture-design.md`: mark follow-ups #2, #4, #5 (shape divergence now moot where the facade serves the application address — verify and state), #8 (structurally avoided: settings use tag surgery, never builder opts — note the remaining rule for future builder callers), plan-2 minors (founding-marker check, orphaned keys) as DONE with commit refs; keep #6 (roster REQ one-shot) and handoff UX-debt items for Plan 4.
- [ ] **Step 3: Commit docs** (`git add -f`) — `docs: sync NIP draft + follow-ups after plan 3`

---

## Out of scope (→ Plan 4)

Two-zone sidebar, join button (9021) + application-form INTAKE flow (respond + approvals→put-user + fan-out), invite codes (9009) + wizard Personen step, Geschlossen shell page, "erste Kanäle" step, moderated-lifecycle live E2E, roster live-updates (follow-up #6), handoff UX debt #5/#6/#7/#8/#10/#11.
