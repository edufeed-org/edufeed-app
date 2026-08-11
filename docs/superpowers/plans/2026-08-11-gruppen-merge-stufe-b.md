# Gruppen-Merge Stufe B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One channel wizard for both area kinds (design B2's three-level access question), area-level member management with Stufe-2 put-user fan-out, and the disclosure line above the composer — per `docs/superpowers/specs/2026-08-11-gruppen-merge-stufe-b-design.md`.

**Architecture:** Pure logic first (`access-choice.js` mapping, `area-members.js` union/deviation/fan-out planning), a roster hook (`useChannelRosters`, stable-key + debounce like host-unread), then three UI wirings: `ChannelCreateWizard` gains a NIP-29 backend branch, a new `AreaMembersModal` on the channels tab, and a disclosure line in both chat surfaces. All NIP-29 publishes ride `publishToGroupRelay`.

**Tech Stack:** Svelte 5 runes, applesauce-relay pool, existing groups-lane helpers (`createGroupOnRelay`, `attachGroupChannel`, `publishToGroupRelay`, `channelKey`, `parseGroupPointers`, `sharedRelayOf`), paraglide (de+en), vitest.

## Global Constraints

- Branch `feat/community-group-pointer`, worktree `.worktrees/group-pointer`. TDD everywhere (failing test first, watch it fail).
- `set -a; . ./.env; set +a` before every vitest run; jsdom flag for component tests.
- Wording: categories, never protocols — „Alle in dieser Community" / „Nur ausgewählte Mitglieder" / „Von außen lesbar"; protocol names appear at most once, small. All strings in BOTH `messages/en.json` and `messages/de.json`; no literal `@` before `{param}`.
- 9007 signs with the acting user's personal key. `restricted` is always set (already in `metadataTags`). Wizard-created groups are always `closed` (joining is an admin action).
- Fan-out failures aggregate into one report — never N toasts.
- Effects that subscribe per pointer-set MUST use a value-stable key + 300 ms debounce (the host-unread lesson; a REQ storm took down a relay connection once already).
- `pnpm run check` must stay at 0 errors (test files need typed mocks — the `[e]` destructure and `.checked` traps recur; annotate).
- Commit after each green task: `feat(groups)|fix(groups)|test(groups): …` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Access-choice mapping + disclosure selection (pure)

**Files:**
- Create: `src/lib/groups/access-choice.js`
- Test: `src/lib/__tests__/access-choice.test.js`

**Interfaces (produces):**
- `accessChoiceToNip29({tier, worldReadable}) -> {isPublic: boolean, isOpen: boolean, access: 'members'|'invited'}`
  — `tier: 'members'|'invited'`; `worldReadable` only meaningful with `tier==='members'`. `isOpen` is ALWAYS false. `isPublic` true only for `tier==='members' && worldReadable`.
- `disclosureKind(metadataEvent, access) -> 'world'|'members'|'invited'|'unknown'`
  — from the RAW 39000 tags (`private` absence ⇒ 'world'; the applesauce parser is untrustworthy here, same rule as channel-access.js) and the pointer's access slot for the members/invited split; null metadata ⇒ 'unknown'.

- [ ] **Step 1: failing test** (`/** @vitest-environment node */`):

```javascript
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { accessChoiceToNip29, disclosureKind } from '$lib/groups/access-choice.js';

const meta = (/** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', 'x'], ...extra]
});

describe('accessChoiceToNip29', () => {
  it('Stufe 2: private, closed, access members', () => {
    expect(accessChoiceToNip29({ tier: 'members', worldReadable: false })).toEqual({
      isPublic: false,
      isOpen: false,
      access: 'members'
    });
  });
  it('weltoffen: public to READ, still closed to join', () => {
    expect(accessChoiceToNip29({ tier: 'members', worldReadable: true })).toEqual({
      isPublic: true,
      isOpen: false,
      access: 'members'
    });
  });
  it('Stufe 3: private, closed, access invited — weltoffen has no effect', () => {
    expect(accessChoiceToNip29({ tier: 'invited', worldReadable: true })).toEqual({
      isPublic: false,
      isOpen: false,
      access: 'invited'
    });
  });
});

describe('disclosureKind', () => {
  it('reads world from the RAW tags, not the applesauce parse', () => {
    expect(disclosureKind(meta(), 'members')).toBe('world');
  });
  it('splits members vs invited on the pointer access slot', () => {
    expect(disclosureKind(meta([['private']]), 'members')).toBe('members');
    expect(disclosureKind(meta([['private']]), 'invited')).toBe('invited');
    expect(disclosureKind(meta([['private']]), undefined)).toBe('invited');
  });
  it('unknown while metadata has not loaded', () => {
    expect(disclosureKind(null, 'members')).toBe('unknown');
  });
});
```

- [ ] **Step 2: run, expect FAIL** — `set -a; . ./.env; set +a; npx vitest run src/lib/__tests__/access-choice.test.js`
- [ ] **Step 3: implement** `src/lib/groups/access-choice.js`:

```javascript
// Design B2 (buzz thread, round 4): two answers plus a weltoffen sub-toggle
// map onto NIP-29's markers. Joining is ALWAYS an admin action for
// wizard-created channels (`closed`), and `restricted` rides along in
// metadataTags (group-management.js) — open only ever means open to READ.

/**
 * @param {{tier: 'members'|'invited', worldReadable?: boolean}} choice
 * @returns {{isPublic: boolean, isOpen: boolean, access: 'members'|'invited'}}
 */
export function accessChoiceToNip29({ tier, worldReadable = false }) {
  return {
    isPublic: tier === 'members' && worldReadable,
    isOpen: false,
    access: tier
  };
}

/**
 * What the disclosure line should say. World is the ABSENCE of `private` on
 * the raw 39000 (same rule as channel-access.js — applesauce's isPublic
 * reads a dead draft); members vs invited is the community's intent from the
 * pointer's access slot, defaulting to the stricter reading.
 * @param {{kind?: number, tags?: string[][]} | null | undefined} metadataEvent
 * @param {string | undefined} access
 * @returns {'world'|'members'|'invited'|'unknown'}
 */
export function disclosureKind(metadataEvent, access) {
  if (!metadataEvent || metadataEvent.kind !== 39000 || !Array.isArray(metadataEvent.tags)) {
    return 'unknown';
  }
  const isPrivate = metadataEvent.tags.some((t) => t[0] === 'private');
  if (!isPrivate) return 'world';
  return access === 'members' ? 'members' : 'invited';
}
```

- [ ] **Step 4: run, expect PASS.**
- [ ] **Step 5: commit** — `feat(groups): access-choice mapping and disclosure selection`

### Task 2: Area members — union, deviations, fan-out plan (pure)

**Files:**
- Create: `src/lib/groups/area-members.js`
- Test: `src/lib/__tests__/area-members.test.js`

**Interfaces:**
- Consumes: `parseGroupPointers(event)`, `channelKey(pointer)` from `./community-pointer.js`.
- Produces:
  - `stufe2Pointers(communikeyEvent) -> pointer[]` — group pointers whose `access === 'members'`.
  - `areaMemberRows({pointers, membersByKey}) -> Array<{pubkey, inKeys: string[], missingKeys: string[]}>` — union of members over the pointers; `membersByKey: Record<channelKey, Set<string>>`; a channel whose roster has NOT loaded (`membersByKey[key] === undefined`) is excluded from BOTH lists (unknown ≠ missing); rows sorted by pubkey for stable rendering.
  - `fanOutPlan({pubkey, pointers, membersByKey}) -> pointer[]` — the Stufe-2 channels this pubkey is missing from (loaded rosters only).
  - `aggregateFanOut(results: Array<{key: string, ok: boolean}>) -> {ok: string[], failed: string[]}`.

- [ ] **Step 1: failing tests:**

```javascript
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  stufe2Pointers,
  areaMemberRows,
  fanOutPlan,
  aggregateFanOut
} from '$lib/groups/area-members.js';
import { channelKey } from '$lib/groups/community-pointer.js';

const R = 'wss://groups.example';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const community = {
  kind: 10222,
  tags: [
    ['group', 'g1', R, 'Allgemein', 'members'],
    ['group', 'g2', R, 'Planung', 'members'],
    ['group', 'g3', R, 'Vorstand', 'invited']
  ]
};
const [p1, p2] = stufe2Pointers(community);
const k1 = /** @type {string} */ (channelKey(p1));
const k2 = /** @type {string} */ (channelKey(p2));

describe('stufe2Pointers', () => {
  it('keeps only access=members pointers', () => {
    expect(stufe2Pointers(community).map((p) => p.id)).toEqual(['g1', 'g2']);
  });
});

describe('areaMemberRows', () => {
  it('unions members and names where each is missing', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A, B]), [k2]: new Set([A]) }
    });
    expect(rows).toEqual([
      { pubkey: A, inKeys: [k1, k2], missingKeys: [] },
      { pubkey: B, inKeys: [k1], missingKeys: [k2] }
    ]);
  });
  it('treats an unloaded roster as unknown, not missing', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A]) }
    });
    expect(rows).toEqual([{ pubkey: A, inKeys: [k1], missingKeys: [] }]);
  });
});

describe('fanOutPlan', () => {
  it('targets only channels the pubkey is missing from', () => {
    const plan = fanOutPlan({
      pubkey: B,
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A, B]), [k2]: new Set([A]) }
    });
    expect(plan.map((p) => p.id)).toEqual(['g2']);
  });
});

describe('aggregateFanOut', () => {
  it('splits ok from failed', () => {
    expect(
      aggregateFanOut([
        { key: k1, ok: true },
        { key: k2, ok: false }
      ])
    ).toEqual({ ok: [k1], failed: [k2] });
  });
});
```

- [ ] **Step 2: run, FAIL.**
- [ ] **Step 3: implement:**

```javascript
// Stufe-2 membership is OUR client's promise, not the relay's (NIP-29 has no
// cascade — buzz design thread, round 4). These pure functions compute the
// area member union, where each member is missing, and what a fan-out must
// send. Unknown rosters are excluded on both sides: "we have not heard" and
// "not a member" are different sentences (same rule as host-unread).
import { parseGroupPointers, channelKey } from './community-pointer.js';

/** @param {{tags?: string[][]} | null | undefined} communikeyEvent */
export function stufe2Pointers(communikeyEvent) {
  return parseGroupPointers(communikeyEvent).filter((p) => p.access === 'members');
}

/**
 * @param {{pointers: any[], membersByKey: Record<string, Set<string>>}} args
 * @returns {Array<{pubkey: string, inKeys: string[], missingKeys: string[]}>}
 */
export function areaMemberRows({ pointers, membersByKey }) {
  const loadedKeys = pointers
    .map((p) => channelKey(p))
    .filter((key) => key !== null && membersByKey[key] !== undefined);
  /** @type {Map<string, {inKeys: string[], missingKeys: string[]}>} */
  const rows = new Map();
  for (const key of loadedKeys) {
    for (const pubkey of membersByKey[/** @type {string} */ (key)]) {
      if (!rows.has(pubkey)) rows.set(pubkey, { inKeys: [], missingKeys: [] });
    }
  }
  for (const [pubkey, row] of rows) {
    for (const key of loadedKeys) {
      const k = /** @type {string} */ (key);
      if (membersByKey[k].has(pubkey)) row.inKeys.push(k);
      else row.missingKeys.push(k);
    }
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pubkey, row]) => ({ pubkey, ...row }));
}

/**
 * @param {{pubkey: string, pointers: any[], membersByKey: Record<string, Set<string>>}} args
 */
export function fanOutPlan({ pubkey, pointers, membersByKey }) {
  return pointers.filter((p) => {
    const key = channelKey(p);
    if (key === null) return false;
    const roster = membersByKey[key];
    return roster !== undefined && !roster.has(pubkey);
  });
}

/** @param {Array<{key: string, ok: boolean}>} results */
export function aggregateFanOut(results) {
  return {
    ok: results.filter((r) => r.ok).map((r) => r.key),
    failed: results.filter((r) => !r.ok).map((r) => r.key)
  };
}
```

- [ ] **Step 4: run, PASS.**
- [ ] **Step 5: commit** — `feat(groups): area-member union, deviations, fan-out planning`

### Task 3: `useChannelRosters` hook

**Files:**
- Create: `src/lib/groups/channel-rosters.svelte.js`
- Test: `src/lib/__tests__/channel-rosters.svelte.test.js` (runes file — copy the `$effect.root` idiom from `src/lib/__tests__/host-unread-stability.svelte.test.js`, including its `vi.mock` of `$lib/stores/nostr-infrastructure.svelte` with a counting `pool.relay(...).request`)

**Interfaces:**
- Consumes: `channelKey` from `./community-pointer.js`; `getGroupMembers, getGroupAdmins, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND` from `applesauce-common/helpers/groups`; `pool` from `$lib/stores/nostr-infrastructure.svelte`.
- Produces: `useChannelRosters(getPointers) -> () => {membersByKey: Record<string, Set<string>>, adminsByKey: Record<string, {pubkey: string, roles: string[]}[]>, refresh: () => void}`
  — one `pool.relay(relay).request({kinds: [39001, 39002], '#d': ids}, {timeout: 8000})` per RELAY over the pointer set (group ids batched per relay), results keyed by `channelKey({id: <d-tag>, relay})`. Value-stable key (`sorted keys joined '\x1f'`) + 300 ms debounce, exactly the host-unread pattern. `refresh()` bumps an internal seq with the same immediate+800 ms double-bump as GroupChat's `onRosterChanged`.

- [ ] **Step 1: failing tests** — three cases, full code in the test file:
  1. serves rosters: two pointers on one relay → ONE request whose filter has `kinds [39001, 39002]` and `'#d'` containing both ids; fixture 39002 events resolve into `membersByKey` sets and a 39001 into `adminsByKey`.
  2. same-content pointer array with fresh identity → no second request (stable key).
  3. `refresh()` → a new request fires (after the debounce; use `await new Promise(r => setTimeout(r, 500))` waits, no fake timers).
- [ ] **Step 2: run, FAIL. Step 3: implement** (mirror `host-unread.svelte.js`'s effect shape: read key first, debounce timer, cleanup unsubscribes; group pointers per relay with a plain object; parse events in `next:` writing `$state.raw` records reassigned wholesale).
- [ ] **Step 4: run, PASS. `pnpm check` clean. Step 5: commit** — `feat(groups): batched 39001/39002 roster hook per relay`

### Task 4: One wizard — NIP-29 branch + access question

**Files:**
- Modify: `src/lib/components/community/channels/ChannelCreateWizard.svelte`
- Modify: `src/lib/components/community/channels/AreaAttachModal.svelte` (remove the create sub-mode; keep attach-existing + tabs)
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte` (wizard opener must show for NIP-29-area communities; gate on `communitySigner` presence instead of Concord tier where needed — read lines ~370-415 where `overlay = 'create'` is set)
- Modify: `messages/en.json`, `messages/de.json`
- Test: extend `src/lib/components/__tests__/ChannelCreateWizard.test.js`; delete `src/lib/components/__tests__/AreaAttachModal.create-tab.test.svelte.js` (its behaviors move here); adjust `AreaAttachModal.group-tab.test.svelte.js` if it references the sub-mode.

**Interfaces:**
- Consumes: `accessChoiceToNip29` (Task 1); `stufe2Pointers` (Task 2); `useChannelRosters` (Task 3) for the initial fan-out targets; `createGroupOnRelay, generateGroupId, publishToGroupRelay, buildPutUserTemplate` from `$lib/groups/group-management.js`; `attachGroupChannel` from `$lib/groups/community-attach.js`; `parseGroupPointers, sharedRelayOf` from `$lib/groups/community-pointer.js`; `attachableAreaModes` from `$lib/groups/community-attach.js`; `pool`.
- Produces: the ONE wizard. Behavior contract:
  - Area detection: `parseGroupPointers(communikeyEvent).length > 0` ⇒ NIP-29 mode; else Concord mode (existing code path unchanged, including founding).
  - The visibility step becomes the access question: radio „Alle in dieser Community" (tier `members`) / „Nur ausgewählte Mitglieder" (tier `invited`), testids `wizard-access-members` / `wizard-access-invited`; a `wizard-access-worldreadable` checkbox indented under the first radio, rendered ONLY in NIP-29 mode AND when tier is `members`. Subtitles from new message keys; no protocol names.
  - NIP-29 create flow: `relay = sharedRelayOf(parseGroupPointers(communikeyEvent))` (abort with error toast if null — mixed-relay pointer lists are unaddressable); `id = generateGroupId()`; `const {isPublic, isOpen, access} = accessChoiceToNip29({tier, worldReadable})`; `createGroupOnRelay({relayConn: pool.relay(relay), id, metadata: {name, isPublic, isOpen}, user: manager.active})`; `attachGroupChannel({communikeyEvent, pointer: {id, relay, name, access}, communitySigner})`; then put-user fan-out to `selected` invitees PLUS (tier `members` only) every pubkey from the area's current member union (Task 2's `areaMemberRows` over Task 3's rosters, `inKeys` rows) — each in try/catch counting failures, one aggregate toast (reuse the existing `concord_channel_created_partial` / `concord_channel_created` keys — they are category-neutral).
  - Concord mode: existing behavior byte-for-byte, only the radio labels/subtitles change to the shared category wording (`isPrivate` maps: tier `members` ⇒ `private: false` — "everyone in the area" — and tier `invited` ⇒ `private: true`; the weltoffen toggle never renders).
- Message keys (en / de) — add:

```json
"wizard_access_members": "Everyone in this community",
"wizard_access_members_hint_closed": "Every member of this community can read and write here.",
"wizard_access_members_hint_encrypted": "Every member of this area can read and write here.",
"wizard_access_invited": "Only selected members",
"wizard_access_invited_hint": "Only people you add can read this channel.",
"wizard_access_worldreadable": "Readable from outside (weltoffen)",
"wizard_access_worldreadable_hint": "Anyone on the network can read along — writing stays members-only.",
"wizard_no_shared_relay": "This community's channels live on different relays — cannot create here."
```

```json
"wizard_access_members": "Alle in dieser Community",
"wizard_access_members_hint_closed": "Jedes Mitglied dieser Community kann hier mitlesen und schreiben.",
"wizard_access_members_hint_encrypted": "Jedes Mitglied dieses Bereichs kann hier mitlesen und schreiben.",
"wizard_access_invited": "Nur ausgewählte Mitglieder",
"wizard_access_invited_hint": "Nur Personen, die du hinzufügst, können diesen Kanal lesen.",
"wizard_access_worldreadable": "Von außen lesbar (weltoffen)",
"wizard_access_worldreadable_hint": "Alle im Netz können mitlesen — schreiben können nur Mitglieder.",
"wizard_no_shared_relay": "Die Kanäle dieser Community liegen auf verschiedenen Relays — Anlegen hier nicht möglich."
```

- [ ] **Step 1: failing tests** (extend `ChannelCreateWizard.test.js` — READ its harness first and reuse its mocks; add `vi.mock('$lib/groups/group-management.js', …)` with `vi.hoisted` spies as in the deleted create-tab test):
  1. NIP-29 community fixture (10222 with two `['group', id, R, name, 'members']` tags): the access step shows both radios and the weltoffen checkbox appears only while `members` is selected.
  2. Concord fixture: no weltoffen checkbox in either state.
  3. NIP-29 create: name + tier members + weltoffen → `createGroupOnRelay` called with `metadata: expect.objectContaining({isPublic: true, isOpen: false})` and `attachGroupChannel` with `pointer: expect.objectContaining({access: 'members'})`; put-user templates built for each selected invitee.
  4. Mixed-relay pointers fixture → error toast `wizard_no_shared_relay`, no create call.
- [ ] **Step 2: FAIL. Step 3: implement wizard + modal sub-mode removal + PCV gating + messages (+ paraglide compile).**
- [ ] **Step 4: run wizard tests + `AreaAttachModal.group-tab` + `GroupCreateModal.test.js` (must stay green — the relay page keeps its modal). `pnpm check` clean.**
- [ ] **Step 5: commit** — `feat(groups): one channel wizard — the access question decides the backend`

### Task 5: AreaMembersModal + channels-tab entry

**Files:**
- Create: `src/lib/components/community/channels/AreaMembersModal.svelte`
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte` (entry button `data-testid="area-members-open"` beside the channel overview, NIP-29-area communities only)
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/AreaMembersModal.test.js`

**Interfaces:**
- Consumes: Tasks 1–3 outputs; `buildPutUserTemplate, buildRemoveUserTemplate, publishToGroupRelay` from `$lib/groups/group-management.js`; `useProfileMap`; `ContactSearchInput` (same call shape as GroupMembersModal); `pool`; `useActiveUser`.
- Produces: props `{communikeyEvent, onClose}`. Inside: `pointers = stufe2Pointers(communikeyEvent)` (plus, display-only, the invited-channel count in the lead text); `rosters = useChannelRosters(() => pointers)`; rows from `areaMemberRows`. Per row: profile, deviation badge „fehlt in N Kanälen" (`missingKeys.length > 0`, title lists channel names), repair button `data-testid="area-member-repair"` (fan-out put-user over `fanOutPlan`), remove button `data-testid="area-member-remove"` (remove-user to every `inKeys` channel). Add-member via ContactSearchInput → fan-out put-user to ALL Stufe-2 pointers. Every fan-out: per-channel try/catch, ONE retry on failure, `aggregateFanOut` → single toast (success, or „N von M Kanälen fehlgeschlagen" warning) → `rosters().refresh()`. Admin capability is per-channel (the acting user in that channel's 39001 from `adminsByKey`); action buttons render when the user is admin in at least one target channel, and the aggregate report names channels that refused.
- Message keys (en / de):

```json
"area_members_title": "Members of this area",
"area_members_lead": "Everyone here is in the community's shared channels. Selected-members channels manage their own lists.",
"area_members_missing": "missing in {count} channels",
"area_members_repair": "Repair",
"area_members_remove": "Remove",
"area_members_sync": "Check members",
"area_members_add_placeholder": "Add member by name or npub",
"area_members_fanout_ok": "Added to {count} channels",
"area_members_fanout_partial": "{failed} of {total} channels refused — see the badges",
"area_members_removed": "Removed from {count} channels"
```

```json
"area_members_title": "Mitglieder des Bereichs",
"area_members_lead": "Alle hier sind in den gemeinsamen Kanälen der Community. Kanäle für ausgewählte Mitglieder verwalten ihre Listen selbst.",
"area_members_missing": "fehlt in {count} Kanälen",
"area_members_repair": "Nachtragen",
"area_members_remove": "Entfernen",
"area_members_sync": "Mitglieder abgleichen",
"area_members_add_placeholder": "Mitglied per Name oder npub hinzufügen",
"area_members_fanout_ok": "In {count} Kanäle eingetragen",
"area_members_fanout_partial": "{failed} von {total} Kanälen abgelehnt — siehe Markierungen",
"area_members_removed": "Aus {count} Kanälen entfernt"
```

- [ ] **Step 1: failing tests** (jsdom; mock group-management with hoisted spies, mock `$lib/groups/channel-rosters.svelte.js` returning a controllable `{membersByKey, adminsByKey, refresh}`):
  1. renders the union with a deviation badge on the member missing from one channel
  2. repair fans out put-user ONLY to the missing channels, then `refresh` fires
  3. add-member fans out to every Stufe-2 pointer; a rejected channel produces the partial-warning toast and NO unhandled rejection
  4. non-admin (empty adminsByKey): no add input, no repair/remove buttons
- [ ] **Step 2: FAIL. Step 3: implement modal + PCV entry + messages.**
- [ ] **Step 4: green + `pnpm check`. Step 5: commit** — `feat(groups): area members with Stufe-2 fan-out and deviation repair`

### Task 6: Disclosure line

**Files:**
- Modify: `src/lib/components/groups/GroupChat.svelte` (line above the composer)
- Modify: `src/lib/components/community/channels/ChannelChat.svelte` (constant Concord line)
- Modify: `messages/en.json`, `messages/de.json`
- Test: extend `src/lib/components/__tests__/GroupChat.test.js` + `src/lib/components/__tests__/ChannelChat.test.js`

**Interfaces:**
- Consumes: `disclosureKind` (Task 1). In GroupChat the pointer's access comes from the linked community when one exists: `getJoinedCommunities()` (already instantiated) → first event whose `parseGroupPointers` contains a matching `channelKey` → that pointer's `access`; standalone groups pass `undefined` (⇒ stricter 'invited' reading).
- Produces: `<p data-testid="disclosure-line">` in the composer block (part of the block — no layout shift; hidden while kind is 'unknown'). Keys (en / de):

```json
"disclosure_world": "Anyone on the network can read along — even without an account.",
"disclosure_members": "Readable by all {count} members.",
"disclosure_invited": "Readable by {count} selected members.",
"disclosure_encrypted": "End-to-end encrypted — only members can read along."
```

```json
"disclosure_world": "Alle im Netz können mitlesen — auch ohne Konto.",
"disclosure_members": "Mitlesen können: alle {count} Mitglieder.",
"disclosure_invited": "Mitlesen können: {count} ausgewählte Mitglieder.",
"disclosure_encrypted": "Ende-zu-Ende verschlüsselt — nur Mitglieder können mitlesen."
```

`{count}` = `members.size` (GroupChat's existing roster). ChannelChat renders `disclosure_encrypted` unconditionally.

- [ ] **Step 1: failing tests:** GroupChat — with the members fixture and a private 39000, the line renders the members count; with a 39000 lacking `private`, the world line. ChannelChat — the encrypted line is present. (Extend both files' paraglide mocks with the four keys; the GroupChat mock functions take `({count})` and interpolate so the assertion can check the number.)
- [ ] **Step 2: FAIL. Step 3: implement.** GroupChat: `const disclosure = $derived(disclosureKind(metadataEvent, linkedAccess))` where `linkedAccess` is a `$derived.by` doing the joined-communities pointer lookup.
- [ ] **Step 4: green + `pnpm check`. Step 5: commit** — `feat(chat): the disclosure line says who can read, in numbers`

### Task 7: Housekeeping + live verification

- [ ] **Step 1:** full sweep `set -a; . ./.env; set +a; npx vitest run src/lib/` — only the documented baseline failures (pomegranate env; inbox flaky-in-parallel, green in isolation) are acceptable.
- [ ] **Step 2:** `pnpm run check` → 0 errors; `pnpm run lint` on touched files.
- [ ] **Step 3:** live smoke against the buzz relay is laoc's (membership); note in the final report exactly which flows to click: wizard both tiers + weltoffen, area members add/repair, disclosure lines in a weltoffen vs closed channel.
- [ ] **Step 4:** commit any fixups; do NOT push.

---

## Self-Review (2026-08-11)

- Spec coverage: §1 wizard ✓(T4, incl. sub-mode removal + PCV gating + initial fan-out), §2 area members ✓(T2 logic, T3 data, T5 UI incl. sync=repair-per-row + add/remove fan-out + aggregate reporting + per-channel admin capability), §3 disclosure ✓(T1 selection, T6 render), error handling ✓(publishToGroupRelay everywhere, aggregate-not-N-toasts in T4/T5), testing ✓, out-of-scope respected (relay-page modal untouched — T4 keeps `GroupCreateModal.test.js` green).
- Placeholder scan: T3 step 1 and T4 step 3 describe rather than quote full code — both name the exact file to copy the idiom from and the exact assertions; acceptable rolling detail, no TBDs.
- Type consistency: `{tier, worldReadable}` (T1) used in T4; `membersByKey: Record<string, Set<string>>` consistent across T2/T3/T5; `refresh()` naming consistent T3/T5; pointer shape `{id, relay, name?, access?}` throughout.
- Note: T4's Concord `isPrivate` mapping (members ⇒ private:false) preserves today's semantics — Concord "public" already means "everyone in the area" (`community.js:363`, per the design thread).
