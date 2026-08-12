# Groups Plan 2: Community Types at Creation — Implementation Plan (2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three community types real at creation time — `GROUPS_ENABLED` flag, a wizard "Typ" step (Offen/Moderiert/Geschlossen), NIP-29 root-group provisioning for moderated communities, the default publish-access question — plus two correctness fixes: EditCommunityModal's pointer-tag data loss and the dashboard's legacy-only ACL path.

**Architecture:** Pure helpers first (tag preservation, wizard step lists, default-access application, provisioning service, roster-access subscription), then the modal surgery consumes them. The type step is flag-gated: with both flags off the wizard collapses to today's exact flow. Moderated provisioning runs with the HUMAN's signer BEFORE the account switch (same constraint and founding-marker idempotency pattern as the Concord flow).

**Tech Stack:** SvelteKit + Svelte 5 runes, JavaScript with JSDoc, Vitest, Playwright (nix shell), applesauce.

**Spec:** `docs/superpowers/specs/2026-08-12-groups-architecture-design.md` (incl. its "Binding follow-ups" section) and `docs/nips/communikey-groups.md` (normative tags).

**Roadmap note (renumbering):** the design doc's follow-ups say "Plan 2 (wizard, flips, settings)". Flips + settings panes + the legacy-a-tag sunset moved to Plan 3 (settings & membership management); page IA + join flows are Plan 4. This plan covers follow-ups #1 (dashboard ACL) and #3 (top-level tags before sections); follow-up #2 (flip strips legacy a-tags + builder sunset) explicitly moves to Plan 3 with the flip work.

**Scope decisions fixed by the controller (do not re-litigate):**
- Config shape: flat `groupsEnabled` key beside the existing flat `groupsRelays` (no nested `groups:{}` object — `appRelays.groups` already carries the relays).
- The Moderiert card shows only when `groupsEnabled && getGroupsRelays().length > 0`; the Geschlossen card only when `runtimeConfig.concord?.enabled`. Both hidden → the Typ step is skipped entirely and the wizard behaves exactly as today.
- Root group: hosted on `getGroupsRelays()[0]`, metadata `{name: <community name>, isPublic: true, isOpen: false}` (world-readable metadata/roster, `closed` — join via invite/approval only; Plan 4's join-request work revisits `open` semantics per live buzz behavior).
- Geschlossen in the wizard: no content sections are written (10222 = shell + concord pointer); the design's "erste Kanäle" wizard step is deferred to Plan 4 (channels are creatable right after via the Kanäle tab).
- Moderated wizard: ContentTypesAndACL's form-gating UI is hidden; instead one radio question (Alle / Nur Mitglieder) applies a default `access` tier to every enabled section. Open communities keep today's UI untouched until Plan 3.

## Global Constraints

- Work in the worktree `/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer`, branch `feat/community-group-pointer`. All paths relative to that root.
- JavaScript with JSDoc only — no TypeScript syntax.
- `pnpm run check` must exit 0 after every task (it is currently 0 ERRORS / 7 pre-existing warnings — new test files need proper JSDoc annotations; deliberately-malformed fixtures use `/** @type {any} */` casts, see `src/lib/__tests__/concord-pointer.test.js` for the convention).
- Unit tests in `src/lib/__tests__/`, `/** @vitest-environment node */` (or jsdom where noted); run one file with `pnpm vitest run <path>`. TDD: failing test first.
- Every user-visible string is a Paraglide key added to BOTH `messages/de.json` (German, source locale) AND `messages/en.json`. Flat snake_case keys.
- Never import `applesauce-concord`/`applesauce-core-concord` outside `src/lib/concord/`; the pure `$lib/concord/pointer.js` and `$lib/concord/founding.js` are importable (no applesauce-concord deps).
- Malformed tags are untrusted input: parsers fail open, never throw.
- Do not use applesauce's `getPublicGroups` (Symbol cache crash in `$derived`).
- E2E tests run inside the nix shell (`pnpm run test:e2e`); e2e must stay green with feature flags OFF (hermeticity: the worktree `.env` may carry `CONCORD_ENABLED=true` — the community-creation spec must force flags off, see Task 7).
- Commit after every task with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; do NOT push.

---

### Task 1: EditCommunityModal pointer-tag preservation (data-loss fix)

**Files:**
- Modify: `src/lib/helpers/communityTagBuilder.js` (new export `preservePointerTags`)
- Modify: `src/lib/components/EditCommunityModal.svelte` (`saveCommunity()` at `:325-397`, the `buildCommunityDefinitionTags` call at `:352-355`)
- Test: extend `src/lib/__tests__/communityTagBuilder.test.js`

**Interfaces:**
- Produces: `preservePointerTags(sourceTags, rebuiltTags) → string[][]` — returns a NEW array: all `membership`, `application`, `concord`, and `group` tags from `sourceTags` prepended (in original order) to `rebuiltTags`. Rationale: `buildCommunityDefinitionTags` rebuilds the tag array wholesale, so any pointer tag the form doesn't model is silently dropped on save (live bug — the concord pointer, group channel tags, and Plan-1's membership/application tags all vanish when an owner edits their community). Prepended, not appended: top-level tags must precede content sections (design follow-up #3; section parsers absorb same-key tags positionally).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/communityTagBuilder.test.js` (extend the existing import line with `preservePointerTags`):

```js
describe('preservePointerTags', () => {
  const RELAY = 'wss://groups.example.com';
  const source = [
    ['r', 'wss://relay.example.com'],
    ['membership', 'root1', RELAY],
    ['application', '30168:aa:beitritt', RELAY],
    ['concord', 'c'.repeat(64), RELAY],
    ['group', 'chan1', RELAY, 'Kanal', 'members'],
    ['content', 'Learning'],
    ['k', '30142']
  ];
  const rebuilt = [
    ['r', 'wss://relay.example.com'],
    ['strict', 'content'],
    ['content', 'Learning'],
    ['k', '30142']
  ];

  it('prepends every pointer tag from the source, before all rebuilt tags', () => {
    const out = preservePointerTags(source, rebuilt);
    expect(out.slice(0, 4)).toEqual([
      ['membership', 'root1', RELAY],
      ['application', '30168:aa:beitritt', RELAY],
      ['concord', 'c'.repeat(64), RELAY],
      ['group', 'chan1', RELAY, 'Kanal', 'members']
    ]);
    expect(out.slice(4)).toEqual(rebuilt);
    expect(rebuilt).toHaveLength(4); // inputs untouched
  });

  it('is a no-op prepend when the source has no pointer tags', () => {
    expect(preservePointerTags([['r', 'wss://x.example.com']], rebuilt)).toEqual(rebuilt);
  });

  it('tolerates malformed source entries without throwing', () => {
    const out = preservePointerTags(/** @type {any} */ ([null, ['membership', 'x', RELAY]]), rebuilt);
    expect(out[0]).toEqual(['membership', 'x', RELAY]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/communityTagBuilder.test.js`
Expected: FAIL — `preservePointerTags` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/helpers/communityTagBuilder.js`, add:

```js
/** Tag keys the community modals do not model — carried over verbatim on
 * every rebuild so an edit cannot silently drop a community's group,
 * membership engine, application form, or private-area pointer. */
const POINTER_TAG_KEYS = ['membership', 'application', 'concord', 'group'];

/**
 * Prepend the source event's pointer tags to a rebuilt tag array.
 * Prepended (not appended) so top-level pointers stay ahead of content
 * sections, which absorb same-key tags positionally.
 * @param {string[][]} sourceTags - tags of the event being edited
 * @param {string[][]} rebuiltTags - fresh output of buildCommunityDefinitionTags
 * @returns {string[][]}
 */
export function preservePointerTags(sourceTags, rebuiltTags) {
  const preserved = (Array.isArray(sourceTags) ? sourceTags : []).filter(
    (tag) => Array.isArray(tag) && POINTER_TAG_KEYS.includes(tag[0])
  );
  return [...preserved, ...rebuiltTags];
}
```

In `src/lib/components/EditCommunityModal.svelte`, in `saveCommunity()`, wrap the builder output (the call at `:352-355`): import `preservePointerTags` alongside the existing `communityTagBuilder` imports (`:12-14`) and change

```js
const tags = buildCommunityDefinitionTags(communityData, hasBadges ? {} : { communityPubkey: communityEvent.pubkey });
```

to

```js
const rebuiltTags = buildCommunityDefinitionTags(
  communityData,
  hasBadges ? {} : { communityPubkey: communityEvent.pubkey }
);
const tags = preservePointerTags(communityEvent.tags, rebuiltTags);
```

(keep the local variable name the rest of the function expects — read the surrounding lines and preserve them).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/__tests__/communityTagBuilder.test.js src/lib/__tests__/community-tag-builder.test.js`
Expected: PASS (both builder suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/communityTagBuilder.js src/lib/components/EditCommunityModal.svelte src/lib/__tests__/communityTagBuilder.test.js
git commit -m "fix(communikey): community edit no longer drops membership/application/concord/group tags"
```

---

### Task 2: `GROUPS_ENABLED` config plumbing + feature helper

**Files:**
- Modify: `src/routes/api/config/+server.js` (add `groupsEnabled` beside `groupsRelays` at `:173`)
- Modify: `src/lib/stores/config.svelte.js` (defaultConfig, `initializeConfig` merge at `:247+`, getter beside `get concord()` at `:494`)
- Modify: `.env.example` (beside `GROUPS_RELAYS=` at `:100`)
- Create: `src/lib/groups/feature.js`
- Test: Create `src/lib/__tests__/api-config-groups.test.js` and `src/lib/__tests__/groups-feature.test.js`

**Interfaces:**
- Produces: `/api/config` response gains top-level `groupsEnabled: boolean` (env `GROUPS_ENABLED`, default false); `runtimeConfig.groupsEnabled` getter; pure `groupsFeatureAvailable({enabled, relays}) → boolean` (true iff `enabled === true` and `relays` is a non-empty array) and thin `moderatedCreationAvailable() → boolean` reading `runtimeConfig.groupsEnabled` + `getGroupsRelays()`.

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/api-config-groups.test.js` (mirror the `vi.doMock('$env/dynamic/private')` + dynamic-import-GET pattern from `src/lib/__tests__/api-config-login-methods.test.js` — read that file first and copy its harness verbatim, adjusting only env + assertions):

```js
/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';

/** @param {Record<string, string>} env */
async function getConfig(env) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const { GET } = await import('../../routes/api/config/+server.js');
  const response = await GET();
  return response.json();
}

afterEach(() => vi.doUnmock('$env/dynamic/private'));

describe('/api/config groups flag', () => {
  it('defaults groupsEnabled to false', async () => {
    const config = await getConfig({});
    expect(config.groupsEnabled).toBe(false);
  });
  it('parses GROUPS_ENABLED=true and keeps groupsRelays flat', async () => {
    const config = await getConfig({
      GROUPS_ENABLED: 'true',
      GROUPS_RELAYS: 'wss://groups.example.com'
    });
    expect(config.groupsEnabled).toBe(true);
    expect(config.groupsRelays).toEqual(['wss://groups.example.com']);
  });
});
```

(If the login-methods harness differs — e.g. it passes a request/url argument to `GET()` — copy ITS call shape; the assertion block above is what matters.)

`src/lib/__tests__/groups-feature.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { groupsFeatureAvailable } from '$lib/groups/feature.js';

describe('groupsFeatureAvailable', () => {
  it('requires the flag AND at least one relay', () => {
    expect(groupsFeatureAvailable({ enabled: true, relays: ['wss://g.example.com'] })).toBe(true);
    expect(groupsFeatureAvailable({ enabled: true, relays: [] })).toBe(false);
    expect(groupsFeatureAvailable({ enabled: false, relays: ['wss://g.example.com'] })).toBe(false);
    expect(groupsFeatureAvailable({ enabled: undefined, relays: undefined })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/api-config-groups.test.js src/lib/__tests__/groups-feature.test.js`
Expected: FAIL — `groupsEnabled` undefined in config; feature module missing.

- [ ] **Step 3: Implement**

1. `src/routes/api/config/+server.js` — directly beside `groupsRelays: parseArray(env.GROUPS_RELAYS)` (`:173`), add:

```js
    groupsEnabled: parseBool(env.GROUPS_ENABLED, false),
```

2. `src/lib/stores/config.svelte.js`:
   - defaultConfig: add top-level `groupsEnabled: false` (near the `appRelays` block).
   - `initializeConfig`: add `groupsEnabled: runtimeConfig.groupsEnabled ?? defaultConfig.groupsEnabled,` in the merged object (same zone as the `appRelays` merge at `:274`).
   - Getter object (beside `get concord()` at `:494`): `get groupsEnabled() { return config.groupsEnabled; }` — match the exact accessor style of the neighboring getters (read them first; they may read a different local variable name than `config`).

3. `.env.example` — under `GROUPS_RELAYS=` (`:100`):

```
# Enable NIP-29 moderated communities (requires GROUPS_RELAYS)
GROUPS_ENABLED=false
```

4. `src/lib/groups/feature.js`:

```js
// Moderated communities need both the deployment flag and a group host.
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';

/**
 * @param {{enabled?: boolean, relays?: string[]}} input
 * @returns {boolean}
 */
export function groupsFeatureAvailable({ enabled, relays } = {}) {
  return enabled === true && Array.isArray(relays) && relays.length > 0;
}

/** @returns {boolean} */
export function moderatedCreationAvailable() {
  return groupsFeatureAvailable({
    enabled: runtimeConfig.groupsEnabled,
    relays: getGroupsRelays()
  });
}
```

(If importing `runtimeConfig` at module scope trips the config-timing rule in tests, keep the import — `groupsFeatureAvailable` stays pure and is what the unit test covers; `moderatedCreationAvailable` is exercised via the wizard.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/__tests__/api-config-groups.test.js src/lib/__tests__/groups-feature.test.js src/lib/__tests__/relay-helper-groups.test.js`
Expected: PASS (including the pre-existing relay-helper suite).

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/config/+server.js src/lib/stores/config.svelte.js .env.example src/lib/groups/feature.js src/lib/__tests__/api-config-groups.test.js src/lib/__tests__/groups-feature.test.js
git commit -m "feat(groups): GROUPS_ENABLED flag + groupsFeatureAvailable helper"
```

---

### Task 3: Root-group provisioning service with founding-marker idempotency

**Files:**
- Create: `src/lib/groups/provision-root-group.js`
- Test: `src/lib/__tests__/provision-root-group.test.js`

**Interfaces:**
- Consumes: `generateGroupId`, `createGroupOnRelay({relayConn, id, metadata, user})`, `confirmGroupMetadata(relayConn, groupId)` from `src/lib/groups/group-management.js` (verify `confirmGroupMetadata` is exported; if not, export it — it is a plain function at `:112`); `pool` from `$lib/stores/nostr-infrastructure.svelte`.
- Produces:
  - `readRootGroupMarker(communityPubkey, storage?) → string | null` / `writeRootGroupMarker(communityPubkey, groupId, storage?)` / `clearRootGroupMarker(communityPubkey, storage?)` — localStorage key `` `groups:root-founding:${communityPubkey}` ``, `storage` injectable for tests (mirrors `src/lib/concord/founding.js`).
  - `provisionRootGroup({relay, name, user, existingId?}) → Promise<{id: string, relay: string}>` — if `existingId` is set and `confirmGroupMetadata` finds its 39000 on the relay, returns it WITHOUT creating; otherwise generates a fresh id and calls `createGroupOnRelay` with metadata `{name, isPublic: true, isOpen: false}`. Throws upward on relay failure (caller handles).

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/provision-root-group.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createGroupOnRelay = vi.fn();
const confirmGroupMetadata = vi.fn();
vi.mock('$lib/groups/group-management.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateGroupId: () => 'fresh-id-16chars',
    createGroupOnRelay: (/** @type {any} */ args) => createGroupOnRelay(args),
    confirmGroupMetadata: (/** @type {any} */ ...args) => confirmGroupMetadata(...args)
  };
});
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => ({ mocked: true })) }
}));

const { provisionRootGroup, readRootGroupMarker, writeRootGroupMarker, clearRootGroupMarker } =
  await import('$lib/groups/provision-root-group.js');

const RELAY = 'wss://groups.example.com';
const USER = { pubkey: 'a'.repeat(64), signer: {} };

beforeEach(() => {
  createGroupOnRelay.mockReset().mockResolvedValue({ kind: 39000 });
  confirmGroupMetadata.mockReset();
});

describe('provisionRootGroup', () => {
  it('creates a fresh group with the fixed root metadata', async () => {
    const result = await provisionRootGroup({ relay: RELAY, name: 'Musterschule', user: USER });
    expect(result).toEqual({ id: 'fresh-id-16chars', relay: RELAY });
    expect(createGroupOnRelay).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fresh-id-16chars',
        metadata: { name: 'Musterschule', isPublic: true, isOpen: false },
        user: USER
      })
    );
  });

  it('reuses a confirmed existing id without creating (idempotent re-run)', async () => {
    confirmGroupMetadata.mockResolvedValue({ kind: 39000 });
    const result = await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      existingId: 'pending-id'
    });
    expect(result).toEqual({ id: 'pending-id', relay: RELAY });
    expect(createGroupOnRelay).not.toHaveBeenCalled();
  });

  it('creates fresh when the pending id is not confirmed on the relay', async () => {
    confirmGroupMetadata.mockResolvedValue(null);
    const result = await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      existingId: 'gone-id'
    });
    expect(result.id).toBe('fresh-id-16chars');
    expect(createGroupOnRelay).toHaveBeenCalledOnce();
  });

  it('propagates relay failures', async () => {
    createGroupOnRelay.mockRejectedValue(new Error('group not confirmed by relay'));
    await expect(provisionRootGroup({ relay: RELAY, name: 'x', user: USER })).rejects.toThrow(
      'group not confirmed by relay'
    );
  });
});

describe('root-group founding marker', () => {
  /** @type {Map<string, string>} */
  let map;
  const storage = {
    getItem: (/** @type {string} */ k) => map.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, v),
    removeItem: (/** @type {string} */ k) => void map.delete(k)
  };
  beforeEach(() => {
    map = new Map();
  });

  it('write/read/clear round-trip, keyed by community pubkey', () => {
    expect(readRootGroupMarker('pk1', storage)).toBeNull();
    writeRootGroupMarker('pk1', 'gid1', storage);
    expect(readRootGroupMarker('pk1', storage)).toBe('gid1');
    expect(readRootGroupMarker('pk2', storage)).toBeNull();
    clearRootGroupMarker('pk1', storage);
    expect(readRootGroupMarker('pk1', storage)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/provision-root-group.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

First check `src/lib/groups/group-management.js:112` — if `confirmGroupMetadata` lacks `export`, add it (no other change).

```js
// src/lib/groups/provision-root-group.js
//
// Mints the NIP-29 ROOT group for a moderated community — the group whose
// roster/roles ARE the membership (docs/nips/communikey-groups.md). Runs with
// the HUMAN creator's signer, and BEFORE any account switch in the creation
// flow (same constraint as Concord founding: src/lib/concord/founding.js).
//
// Founding marker: if the group is created but the 10222 publish fails,
// re-running the wizard must reuse the pending group instead of littering
// the relay — identical shape to Concord's readFoundingMarker.
import {
  generateGroupId,
  createGroupOnRelay,
  confirmGroupMetadata
} from './group-management.js';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';

const MARKER_PREFIX = 'groups:root-founding:';

/** @returns {Storage | null} */
function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {string} communityPubkey
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'> | null} [storage]
 * @returns {string | null}
 */
export function readRootGroupMarker(communityPubkey, storage = defaultStorage()) {
  return storage?.getItem(MARKER_PREFIX + communityPubkey) ?? null;
}

/**
 * @param {string} communityPubkey
 * @param {string} groupId
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'> | null} [storage]
 */
export function writeRootGroupMarker(communityPubkey, groupId, storage = defaultStorage()) {
  storage?.setItem(MARKER_PREFIX + communityPubkey, groupId);
}

/**
 * @param {string} communityPubkey
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'> | null} [storage]
 */
export function clearRootGroupMarker(communityPubkey, storage = defaultStorage()) {
  storage?.removeItem(MARKER_PREFIX + communityPubkey);
}

/**
 * @param {{relay: string, name: string, user: {pubkey: string, signer: any}, existingId?: string | null}} args
 * @returns {Promise<{id: string, relay: string}>}
 */
export async function provisionRootGroup({ relay, name, user, existingId = null }) {
  const relayConn = pool.relay(relay);
  if (existingId) {
    const confirmed = await confirmGroupMetadata(relayConn, existingId);
    if (confirmed) return { id: existingId, relay };
  }
  const id = generateGroupId();
  // isOpen: false → `closed`: join requests are relay-ignored for now; Plan 4's
  // join flow decides open-vs-closed against live relay behavior. isPublic:
  // true → metadata/roster world-readable, which the public gating verifiability
  // story depends on.
  await createGroupOnRelay({
    relayConn,
    id,
    metadata: { name, isPublic: true, isOpen: false },
    user
  });
  return { id, relay };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/__tests__/provision-root-group.test.js src/lib/__tests__/group-management.test.js`
Expected: PASS (group-management suite unaffected, or updated import list only).

- [ ] **Step 5: Commit**

```bash
git add src/lib/groups/provision-root-group.js src/lib/groups/group-management.js src/lib/__tests__/provision-root-group.test.js
git commit -m "feat(groups): provisionRootGroup service with founding-marker idempotency"
```

---

### Task 4: Builder emits `membership`/`application` in the global tag zone

**Files:**
- Modify: `src/lib/helpers/communityTagBuilder.js` (`buildCommunityDefinitionTags` opts, emission in the global-metadata zone BEFORE `['strict','content']` at `:142`)
- Test: extend `src/lib/__tests__/communityTagBuilder.test.js`

**Interfaces:**
- Produces: `buildCommunityDefinitionTags(data, opts)` accepts `opts.membership?: {id: string, relay: string}` and `opts.application?: {address: string, relay?: string|null}`; when set (new-spec mode only), emits `['membership', id, relay]` and `['application', address, relay?]` after the livekit block and before the strict marker — satisfying design follow-up #3 (top-level tags before sections).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/communityTagBuilder.test.js`:

```js
describe('membership/application emission', () => {
  const PK = 'a'.repeat(64);
  const RELAY = 'wss://groups.example.com';
  const data = {
    relays: ['wss://relay.example.com'],
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
        access: { tier: 'members' }
      }
    }
  };

  it('emits both pointers before the strict marker and all content sections', () => {
    const tags = buildCommunityDefinitionTags(data, {
      communityPubkey: PK,
      membership: { id: 'root1', relay: RELAY },
      application: { address: `30168:${PK}:beitritt`, relay: RELAY }
    });
    const membershipIdx = tags.findIndex((t) => t[0] === 'membership');
    const applicationIdx = tags.findIndex((t) => t[0] === 'application');
    const strictIdx = tags.findIndex((t) => t[0] === 'strict');
    const contentIdx = tags.findIndex((t) => t[0] === 'content');
    expect(tags[membershipIdx]).toEqual(['membership', 'root1', RELAY]);
    expect(tags[applicationIdx]).toEqual(['application', `30168:${PK}:beitritt`, RELAY]);
    expect(membershipIdx).toBeLessThan(strictIdx);
    expect(applicationIdx).toBeLessThan(strictIdx);
    expect(strictIdx).toBeLessThan(contentIdx);
  });

  it('application relay hint is optional; omitted opts emit nothing', () => {
    const withBare = buildCommunityDefinitionTags(data, {
      communityPubkey: PK,
      application: { address: `30168:${PK}:beitritt` }
    });
    expect(withBare).toContainEqual(['application', `30168:${PK}:beitritt`]);
    const none = buildCommunityDefinitionTags(data, { communityPubkey: PK });
    expect(none.some((t) => t[0] === 'membership' || t[0] === 'application')).toBe(false);
  });

  it('never emits pointers in old-spec mode', () => {
    const tags = buildCommunityDefinitionTags(data, {
      membership: { id: 'root1', relay: RELAY }
    });
    expect(tags.some((t) => t[0] === 'membership')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/communityTagBuilder.test.js`
Expected: FAIL — no membership/application tags emitted.

- [ ] **Step 3: Implement**

In `buildCommunityDefinitionTags`, destructure the new opts (`const { communityPubkey, membership, application } = opts;`), extend the JSDoc `@param {{ communityPubkey?: string, membership?: {id: string, relay: string}, application?: {address: string, relay?: string|null} }} [opts]`, and insert after the livekit block / before the strict marker (`:140-142`):

```js
  // Moderated-community pointers (communikey-groups NIP draft) — top-level,
  // and BEFORE the sections: section parsers absorb same-key tags positionally.
  if (isNewSpec && membership) {
    tags.push(['membership', membership.id, membership.relay]);
  }
  if (isNewSpec && application) {
    const applicationTag = ['application', application.address];
    if (application.relay) applicationTag.push(application.relay);
    tags.push(applicationTag);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/__tests__/communityTagBuilder.test.js src/lib/__tests__/community-tag-builder.test.js src/lib/__tests__/community-membership.test.js`
Expected: PASS — and `parseMembershipPointer`/`parseApplicationRef` (Plan 1) can read what this emits (the membership suite already covers those parsers).

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/communityTagBuilder.js src/lib/__tests__/communityTagBuilder.test.js
git commit -m "feat(communikey): builder emits membership/application pointers in the global tag zone"
```

---

### Task 5: Wizard pure logic — step list + default access application

**Files:**
- Create: `src/lib/components/community/create/wizard-logic.js`
- Test: `src/lib/__tests__/community-wizard-logic.test.js`

**Interfaces:**
- Produces (consumed by Task 6's modal surgery):
  - `communityWizardSteps({useCurrentKeypair, typeStepVisible}) → string[]` — ordered step ids AFTER the keypair-choice screen (which stays step 0): current-keypair `['type'?, 'settings', 'confirm']`, new-keypair `['profile', 'keys', 'type'?, 'settings', 'confirm']` (`'type'` present iff `typeStepVisible`). The design's order: type comes after identity, before content.
  - `applyDefaultAccess(contentTypes, tier) → contentTypes` — returns a NEW record where every entry's `access` is `{tier}` (`tier` is `'all'` or `'members'`); non-enabled entries updated too (harmless, builder skips them).
  - `disableAllContentTypes(contentTypes) → contentTypes` — NEW record with every `enabled: false` (used for Geschlossen: shell 10222, no sections).

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/community-wizard-logic.test.js
import { describe, it, expect } from 'vitest';
import {
  communityWizardSteps,
  applyDefaultAccess,
  disableAllContentTypes
} from '$lib/components/community/create/wizard-logic.js';
import { createDefaultContentTypes } from '$lib/helpers/communityTagBuilder.js';

describe('communityWizardSteps', () => {
  it('collapses to the legacy flows when the type step is hidden', () => {
    expect(communityWizardSteps({ useCurrentKeypair: true, typeStepVisible: false })).toEqual([
      'settings',
      'confirm'
    ]);
    expect(communityWizardSteps({ useCurrentKeypair: false, typeStepVisible: false })).toEqual([
      'profile',
      'keys',
      'settings',
      'confirm'
    ]);
  });
  it('inserts the type step after identity, before settings', () => {
    expect(communityWizardSteps({ useCurrentKeypair: true, typeStepVisible: true })).toEqual([
      'type',
      'settings',
      'confirm'
    ]);
    expect(communityWizardSteps({ useCurrentKeypair: false, typeStepVisible: true })).toEqual([
      'profile',
      'keys',
      'type',
      'settings',
      'confirm'
    ]);
  });
});

describe('applyDefaultAccess / disableAllContentTypes', () => {
  it('sets every entry access to the tier, immutably', () => {
    const input = createDefaultContentTypes(['learning', 'chat']);
    const out = applyDefaultAccess(input, 'members');
    expect(out.learning.access).toEqual({ tier: 'members' });
    expect(out.chat.access).toEqual({ tier: 'members' });
    expect(input.learning.access).toEqual({ tier: 'all' });
  });
  it('disables everything, immutably', () => {
    const input = createDefaultContentTypes(['learning']);
    const out = disableAllContentTypes(input);
    expect(Object.values(out).every((ct) => ct.enabled === false)).toBe(true);
    expect(input.learning.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/community-wizard-logic.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/lib/components/community/create/wizard-logic.js
//
// Pure step/content-type logic for CreateCommunityModal, extracted so the
// wizard's flow is unit-testable without mounting the 1100-line modal.

/**
 * Ordered step ids after the keypair-choice screen (screen 0 of the modal).
 * @param {{useCurrentKeypair: boolean, typeStepVisible: boolean}} args
 * @returns {string[]}
 */
export function communityWizardSteps({ useCurrentKeypair, typeStepVisible }) {
  const identity = useCurrentKeypair ? [] : ['profile', 'keys'];
  const type = typeStepVisible ? ['type'] : [];
  return [...identity, ...type, 'settings', 'confirm'];
}

/**
 * @template {Record<string, {access?: object}>} T
 * @param {T} contentTypes
 * @param {'all' | 'members'} tier
 * @returns {T}
 */
export function applyDefaultAccess(contentTypes, tier) {
  return /** @type {T} */ (
    Object.fromEntries(
      Object.entries(contentTypes).map(([key, ct]) => [key, { ...ct, access: { tier } }])
    )
  );
}

/**
 * @template {Record<string, {enabled?: boolean}>} T
 * @param {T} contentTypes
 * @returns {T}
 */
export function disableAllContentTypes(contentTypes) {
  return /** @type {T} */ (
    Object.fromEntries(
      Object.entries(contentTypes).map(([key, ct]) => [key, { ...ct, enabled: false }])
    )
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/__tests__/community-wizard-logic.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/community/create/wizard-logic.js src/lib/__tests__/community-wizard-logic.test.js
git commit -m "feat(community): pure wizard step/access logic for the type step"
```

---

### Task 6: Wizard type step + moderated provisioning (modal surgery)

**Files:**
- Modify: `src/lib/components/CreateCommunityModal.svelte` (throughout — anchors below are from HEAD `fa8de360`; locate by content)
- Modify: `messages/de.json` + `messages/en.json` (new keys below)
- Test: manual `pnpm vitest run` blast radius + Task 7's e2e (no component test exists for this modal; the flow logic is Task 5's unit-tested module)

**Interfaces:**
- Consumes: `communityWizardSteps`, `applyDefaultAccess`, `disableAllContentTypes` (Task 5); `moderatedCreationAvailable` (Task 2); `provisionRootGroup`, `readRootGroupMarker`, `writeRootGroupMarker`, `clearRootGroupMarker` (Task 3); builder `opts.membership` (Task 4); `getGroupsRelays` from `$lib/helpers/relay-helper.js`.
- Produces: `communityType: 'open'|'moderated'|'closed'` wizard state; a moderated creation publishes a 10222 whose tags contain `['membership', id, relay]` before `['strict','content']`, with every enabled section carrying the chosen default `access`; a closed creation publishes a section-less 10222 with the concord pointer (existing founding flow, `withPrivateArea` replaced by the type card).

**i18n keys** (add to BOTH `messages/de.json` — German values below — and `messages/en.json` with English equivalents; follow flat snake_case, place near `create_community_modal_*` at `de.json:608-676`):

```
"create_community_modal_step_type": "Typ"
"community_type_question": "Was für eine Community soll das werden?"
"community_type_open_title": "Offen"
"community_type_open_body": "Alle können Inhalte mit der Community teilen. Gut für lose Netzwerke und Themensammlungen."
"community_type_open_hint": "Später auf „Moderiert“ umstellbar."
"community_type_moderated_title": "Moderiert"
"community_type_moderated_body": "Für alle sichtbar — aber ihr entscheidet, wer veröffentlicht. Mit Mitgliedern, Rollen und Beitrittsanfragen."
"community_type_moderated_hint": "Später auf „Offen“ umstellbar."
"community_type_recommended": "empfohlen"
"community_type_closed_title": "Geschlossen"
"community_type_closed_body": "Nur auf Einladung. Alles Ende-zu-Ende-verschlüsselt — nach außen ist nur sichtbar, dass es die Community gibt."
"community_type_closed_hint": "Endgültig — kann später nicht geändert werden."
"community_access_question": "Wer darf hier veröffentlichen?"
"community_access_all": "Alle"
"community_access_all_hint": "Jede*r kann Inhalte mit der Community teilen."
"community_access_members": "Nur Mitglieder"
"community_access_members_hint": "Nur Mitglieder dürfen veröffentlichen. Feinabstimmung pro Inhaltstyp folgt in den Einstellungen."
"community_type_provisioning_error": "Die Gruppe für die Mitgliederverwaltung konnte nicht angelegt werden: {reason}"
```

- [ ] **Step 1: Add state + step machinery**

In the script block (near `withPrivateArea` at `:47`):

```js
import { communityWizardSteps, applyDefaultAccess, disableAllContentTypes } from '$lib/components/community/create/wizard-logic.js';
import { moderatedCreationAvailable } from '$lib/groups/feature.js';
import { provisionRootGroup, readRootGroupMarker, writeRootGroupMarker, clearRootGroupMarker } from '$lib/groups/provision-root-group.js';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';

/** @type {'open' | 'moderated' | 'closed'} */
let communityType = $state('open');
/** @type {'all' | 'members'} */
let defaultAccessTier = $state('members');
const moderatedAvailable = $derived(moderatedCreationAvailable());
const closedAvailable = $derived(!!runtimeConfig.concord?.enabled);
const typeStepVisible = $derived(moderatedAvailable || closedAvailable);
const wizardSteps = $derived(
  communityWizardSteps({ useCurrentKeypair, typeStepVisible })
);
/** @returns {string | null} id of the current step, null on the keypair screen */
const currentStepId = $derived(currentStep > 0 ? (wizardSteps[currentStep - 1] ?? null) : null);
```

Rework the step plumbing to be list-driven instead of hardcoded indices — this is the core surgery; keep the diff minimal:

- `totalSteps` (`:54-57`): `currentStep === 0 ? 0 : wizardSteps.length`.
- `getStepLabels()` (`:306-320`): map `wizardSteps` to labels — `profile → m.create_community_modal_step_profile()`, `keys → …_step_keys()`, `type → m.create_community_modal_step_type()`, `settings → …_step_community_settings()`, `confirm → …_step_confirm()`.
- `validateStep(step)` (`:243-303`): re-key the branches by `wizardSteps[step - 1]` (`'profile'` → the name check, `'keys'` → download confirm, `'settings'` → community-settings checks, `'type'`/`'confirm'` → no validation). Do NOT leave index-based branches behind.
- `nextStep()` (`:338-345`): `maxSteps = wizardSteps.length`.
- Template step blocks (`:667-1082`): change each `{:else if currentStep === N && useCurrentKeypair}`-style condition to `{:else if currentStepId === '<id>'}` (the keypair screen stays `currentStep === 0`). The settings and confirm blocks are currently DUPLICATED per keypair path (`1&&current` vs `3&&!current`, `2&&current` vs `4&&!current`) — with `currentStepId` they collapse: keep ONE settings block and ONE confirm block, deleting the duplicates (this is the DRY win that keeps the diff sane; move the few `useCurrentKeypair`-dependent bits inside with `{#if}`).

- [ ] **Step 2: Type step template**

New block rendered when `currentStepId === 'type'` — three selectable cards (radio semantics; follow the styling of the keypair-choice cards at `:628-666`):

```svelte
{:else if currentStepId === 'type'}
  <div class="space-y-4">
    <h3 class="text-lg font-semibold">{m.community_type_question()}</h3>
    <div class="grid gap-3 sm:grid-cols-{1 + (moderatedAvailable ? 1 : 0) + (closedAvailable ? 1 : 0)}">
      <button
        type="button"
        class="card border p-4 text-left {communityType === 'open' ? 'border-primary bg-primary/5' : 'border-base-300'}"
        data-testid="community-type-open"
        onclick={() => (communityType = 'open')}
      >
        <span class="text-2xl">🌍</span>
        <strong>{m.community_type_open_title()}</strong>
        <p class="text-sm">{m.community_type_open_body()}</p>
        <p class="text-xs text-base-content/60">{m.community_type_open_hint()}</p>
      </button>
      {#if moderatedAvailable}
        <button
          type="button"
          class="card border p-4 text-left {communityType === 'moderated' ? 'border-primary bg-primary/5' : 'border-base-300'}"
          data-testid="community-type-moderated"
          onclick={() => (communityType = 'moderated')}
        >
          <span class="text-2xl">🛡️</span>
          <strong>{m.community_type_moderated_title()} <span class="badge badge-primary badge-sm">{m.community_type_recommended()}</span></strong>
          <p class="text-sm">{m.community_type_moderated_body()}</p>
          <p class="text-xs text-base-content/60">{m.community_type_moderated_hint()}</p>
        </button>
      {/if}
      {#if closedAvailable}
        <button
          type="button"
          class="card border p-4 text-left {communityType === 'closed' ? 'border-primary bg-primary/5' : 'border-base-300'}"
          data-testid="community-type-closed"
          onclick={() => (communityType = 'closed')}
        >
          <span class="text-2xl">🔒</span>
          <strong>{m.community_type_closed_title()}</strong>
          <p class="text-sm">{m.community_type_closed_body()}</p>
          <p class="text-xs text-base-content/60">{m.community_type_closed_hint()}</p>
        </button>
      {/if}
    </div>
  </div>
```

(Exact classes may be adapted to the modal's existing card styling — match the keypair cards. The three `data-testid`s are load-bearing for Task 7.)

- [ ] **Step 3: Settings-step conditioning + access question**

In the (now single) settings block:
- `{#if communityType !== 'closed'}` around `ContentTypesAndACL`; for `communityType === 'moderated'` pass `showAccessConfig={false}` and additionally hide the form-gating toggle by wrapping the component: render `ContentTypesAndACL` normally for `'open'`, and for `'moderated'` render it with the ACL toggle suppressed — simplest: add a new optional prop `hideAccessToggle = false` to `ContentTypesAndACL.svelte` (`:126-135` block wrapped in `{#if !hideAccessToggle}`) and pass `hideAccessToggle={communityType === 'moderated'}`.
- After the content-type chips, for moderated only, the default-access radio:

```svelte
{#if communityType === 'moderated'}
  <fieldset class="space-y-2" data-testid="community-access-question">
    <legend class="font-medium">{m.community_access_question()}</legend>
    <label class="flex items-start gap-2">
      <input type="radio" class="radio radio-sm mt-1" bind:group={defaultAccessTier} value="members" />
      <span>{m.community_access_members()}<br /><span class="text-xs text-base-content/60">{m.community_access_members_hint()}</span></span>
    </label>
    <label class="flex items-start gap-2">
      <input type="radio" class="radio radio-sm mt-1" bind:group={defaultAccessTier} value="all" />
      <span>{m.community_access_all()}<br /><span class="text-xs text-base-content/60">{m.community_access_all_hint()}</span></span>
    </label>
  </fieldset>
{/if}
```

- [ ] **Step 4: Replace the `withPrivateArea` toggle with the type card**

Delete the `privateAreaOption` snippet (`:579-608`) and its two render sites (`:756`, `:974`). Replace every `withPrivateArea` read with `communityType === 'closed'` (the concord-founding guard at `:390` becomes `communityType === 'closed' && runtimeConfig.concord?.enabled`; the state declaration at `:47` is deleted; the reset sites at `:203-230`/`:565-572` reset `communityType = 'open'` and `defaultAccessTier = 'members'` instead).

- [ ] **Step 5: `createCommunity()` wiring**

In `createCommunity()` (`:378-542`):

1. **Moderated provisioning block** — insert directly after the Concord founding block (`:388-405`), BEFORE the account switch at `:408`, same idempotency shape:

```js
      /** @type {{id: string, relay: string} | null} */
      let rootGroupPointer = null;
      if (communityType === 'moderated') {
        const groupsRelay = getGroupsRelays()[0];
        const communityPk = useCurrentKeypair ? manager.active?.pubkey : userData.publicKey;
        try {
          rootGroupPointer = await provisionRootGroup({
            relay: groupsRelay,
            name: userData.name?.trim() || 'Community',
            user: { pubkey: manager.active.pubkey, signer: manager.active.signer },
            existingId: readRootGroupMarker(communityPk)
          });
          writeRootGroupMarker(communityPk, rootGroupPointer.id);
        } catch (err) {
          errors.publishing = m.community_type_provisioning_error({
            reason: err instanceof Error ? err.message : String(err)
          });
          isPublishing = false;
          return;
        }
      }
```

2. **Content types per type** — just before the `buildCommunityDefinitionTags` call (`:464`):

```js
      let effectiveContentTypes = communityData.contentTypes;
      if (communityType === 'moderated') {
        effectiveContentTypes = applyDefaultAccess(communityData.contentTypes, defaultAccessTier);
      } else if (communityType === 'closed') {
        effectiveContentTypes = disableAllContentTypes(communityData.contentTypes);
      }
```

and pass `{ ...communityData, contentTypes: effectiveContentTypes }` into the builder, with `membership: rootGroupPointer ?? undefined` added to the opts object.

3. **Marker cleanup** — where `clearFoundingMarker(account.pubkey)` runs after the successful 10222 publish (`:492`), add `clearRootGroupMarker(account.pubkey)`.

4. Moderated communities must not run the kind-30000 profile-list block (`:496-515`) — guard it with `communityType === 'open'`.

- [ ] **Step 6: Verify**

```bash
pnpm vitest run src/lib/__tests__/community-wizard-logic.test.js src/lib/__tests__/communityTagBuilder.test.js src/lib/components/__tests__/DashboardCommunities.test.js
pnpm run check   # MUST exit 0
pnpm run lint
```

Also grep for leftovers: `grep -rn "withPrivateArea\|privateAreaOption" src/` must return nothing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/CreateCommunityModal.svelte src/lib/components/shared/ContentTypesAndACL.svelte messages/de.json messages/en.json
git commit -m "feat(community): wizard type step (Offen/Moderiert/Geschlossen) + moderated root-group provisioning"
```

---

### Task 7: E2E — creation flow stays green flags-off, type step covered flags-on-less

**Files:**
- Modify: `e2e/community-creation.test.js` (Full Flow suite `:375-445`, helpers `:14-32`)
- Modify: `e2e/COVERAGE.md`

**Interfaces:**
- Consumes: `data-testid="community-type-open|moderated|closed"` (Task 6); the flags-off collapse guarantee (Task 5/6).

- [ ] **Step 1: Force flags off for the creation spec**

The worktree `.env` may set `CONCORD_ENABLED=true`, which would add the type step and break the step-count assumptions (see memory: env hermeticity). Check how `playwright.config.js` builds the webServer env; ensure the creation spec runs against a server with `CONCORD_ENABLED=false` and `GROUPS_ENABLED` unset — if the config already passes through `.env`, override via the webServer `env` block or document/normalize `.env` for e2e (follow whatever `e2e/` precedent exists for env-sensitive specs, e.g. the npub-login spec). Record the chosen mechanism in the test file header comment.

- [ ] **Step 2: Add a flags-off regression test**

Append to the Modal Access suite:

```js
test('type step is absent when no group features are enabled', async ({ page }) => {
  await navigateToCommunitiesTab(page);
  await openCreateCommunityModal(page);
  await page.locator('.modal-box button', { hasText: 'Use Current Keypair' }).click();
  await expect(page.locator('[data-testid="community-type-open"]')).toHaveCount(0);
});
```

(Adapt the two locator lines to the file's existing helpers/selectors — copy from the Keypair Selection suite.)

- [ ] **Step 3: Run the suite**

Run (nix shell): `pnpm run test:e2e -- community-creation`
Expected: all creation tests PASS, including the two Full Flow tests unchanged (flags off = step flow identical to before this plan). If a Full Flow test fails on step counts, the flags-off collapse is broken — fix Task 6, do not adjust the test.

- [ ] **Step 4: Update COVERAGE.md**

Add a line under the community-creation section: type step absent with flags off (covered); type-step selection + moderated creation flows = covered by unit tests (wizard-logic, provisioning) + Plan 4's live-relay E2E (deferred, listed as gap).

- [ ] **Step 5: Commit**

```bash
git add e2e/community-creation.test.js e2e/COVERAGE.md playwright.config.js
git commit -m "test(e2e): community creation stays green with group features off"
```

(Include `playwright.config.js` only if Step 1 touched it.)

---

### Task 8: Dashboard ACL — roster-aware access subscription

**Files:**
- Create: `src/lib/groups/community-access-subscription.js`
- Modify: `src/lib/groups/roster-access.js` (add `buildRosterAccess`)
- Modify: `src/lib/components/dashboard/DashboardCommunityFeed.svelte` (`mergeAndUpdate` at `:156-174`, the ACL wiring in the big `$effect` at `:199-216`)
- Test: `src/lib/__tests__/community-access-subscription.test.js`

**Interfaces:**
- Consumes: `subscribeToProfileListMembers` + `buildProfileAccess` (`src/lib/helpers/profile-list-members.js:22,:89`); `deriveCommunityType`, `parseMembershipPointer` (Plan 1); `parseCommunityContentTypes`, `sectionIsGated`; `rosterView` (Plan 1); `getGroupMembers`, `getGroupAdmins`, `GROUP_ADMINS_KIND`, `GROUP_MEMBERS_KIND` from `applesauce-common/helpers/groups`; `pool`.
- Produces:
  - `buildRosterAccess(communityEvent, roster) → {isLoading: boolean, getAllowedAuthors(name): string[]|null}` in `roster-access.js` (pure).
  - `subscribeToCommunityAccess(communityEvent, relays, onUpdate) → {cleanup, hasRestrictedSections}` — same contract as `subscribeToProfileListMembers` but `onUpdate` receives a ready access object (`{isLoading, getAllowedAuthors}`); dispatches on community type: moderated → one roster REQ (`kinds:[39001,39002], '#d':[id]`) on the membership pointer's relay with an 8s timeout, emitting on every roster event; everything else → wraps the legacy subscription and emits `buildProfileAccess(memberMap, false)`.

- [ ] **Step 1: Write the failing test**

```js
/** @vitest-environment node */
// src/lib/__tests__/community-access-subscription.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const legacySub = vi.fn();
vi.mock('$lib/helpers/profile-list-members.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    subscribeToProfileListMembers: (/** @type {any[]} */ ...args) => legacySub(...args)
  };
});
/** @type {(event: any) => void} */
let emitRelayEvent;
const unsubscribe = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: vi.fn(() => ({
      request: vi.fn(() => ({
        subscribe: (/** @type {any} */ handlers) => {
          emitRelayEvent = handlers.next;
          return { unsubscribe };
        }
      }))
    }))
  }
}));

const { subscribeToCommunityAccess } = await import('$lib/groups/community-access-subscription.js');

const RELAY = 'wss://groups.example.com';
const OWNER = 'f'.repeat(64);
const MEMBER = 'b'.repeat(64);
const moderatedEvent = {
  kind: 10222,
  pubkey: OWNER,
  tags: [
    ['membership', 'root1', RELAY],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'members'],
    ['content', 'Forum'],
    ['k', '11']
  ]
};
const openEvent = { kind: 10222, pubkey: OWNER, tags: [['content', 'Forum'], ['k', '11']] };

beforeEach(() => {
  legacySub.mockReset().mockReturnValue({ cleanup: vi.fn(), hasRestrictedSections: false });
  unsubscribe.mockReset();
});

describe('subscribeToCommunityAccess', () => {
  it('delegates non-moderated communities to the legacy subscription', () => {
    const onUpdate = vi.fn();
    const result = subscribeToCommunityAccess(openEvent, [RELAY], onUpdate);
    expect(legacySub).toHaveBeenCalledWith(openEvent, [RELAY], expect.any(Function));
    expect(result.hasRestrictedSections).toBe(false);
  });

  it('moderated: reports restricted sections and filters by roster after events arrive', () => {
    const onUpdate = vi.fn();
    const { cleanup, hasRestrictedSections } = subscribeToCommunityAccess(
      moderatedEvent,
      [RELAY],
      onUpdate
    );
    expect(hasRestrictedSections).toBe(true);
    expect(legacySub).not.toHaveBeenCalled();

    emitRelayEvent({ kind: 39002, tags: [['d', 'root1'], ['p', MEMBER]] });
    const access = onUpdate.mock.calls.at(-1)[0];
    expect(access.isLoading).toBe(false);
    expect(access.getAllowedAuthors('Forum')).toBeNull();
    const allowed = access.getAllowedAuthors('Learning');
    expect(allowed).toEqual(expect.arrayContaining([OWNER, MEMBER]));

    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('moderated with no gated sections: no subscription, hasRestrictedSections false', () => {
    const ungated = {
      ...moderatedEvent,
      tags: [['membership', 'root1', RELAY], ['content', 'Forum'], ['k', '11']]
    };
    const result = subscribeToCommunityAccess(ungated, [RELAY], vi.fn());
    expect(result.hasRestrictedSections).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/community-access-subscription.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Add to `src/lib/groups/roster-access.js`:

```js
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';

/**
 * Callback-friendly access view over a community's sections + one roster —
 * the non-reactive counterpart of useCommunityAccess for dynamic lists
 * (dashboard) where rune hooks cannot be instantiated per community.
 * @param {any} communityEvent
 * @param {import('./root-roster.js').RosterView} roster
 * @returns {{isLoading: boolean, getAllowedAuthors: (name: string) => string[] | null}}
 */
export function buildRosterAccess(communityEvent, roster) {
  const sections = parseCommunityContentTypes(communityEvent);
  return {
    isLoading: roster.isLoading,
    getAllowedAuthors: (name) =>
      sectionAllowedAuthors(
        sections.find((section) => section.name === name) ?? null,
        roster,
        communityEvent?.pubkey
      )
  };
}
```

Create `src/lib/groups/community-access-subscription.js`:

```js
// One subscription API for "who may author this community's sections",
// regardless of community type. Same contract as
// subscribeToProfileListMembers, but onUpdate receives a ready access object.
import {
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  getGroupAdmins,
  getGroupMembers
} from 'applesauce-common/helpers/groups';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import {
  subscribeToProfileListMembers,
  buildProfileAccess
} from '$lib/helpers/profile-list-members.js';
import { parseCommunityContentTypes, sectionIsGated } from '$lib/helpers/communityRelays.js';
import { deriveCommunityType, parseMembershipPointer } from './community-membership.js';
import { channelKey } from './community-pointer.js';
import { rosterView } from './root-roster.js';
import { buildRosterAccess } from './roster-access.js';

/**
 * @param {any} communityEvent - kind 10222
 * @param {string[]} relays - legacy profile-list relays (ignored for moderated)
 * @param {(access: {isLoading: boolean, getAllowedAuthors: (name: string) => string[] | null}) => void} onUpdate
 * @returns {{cleanup: () => void, hasRestrictedSections: boolean}}
 */
export function subscribeToCommunityAccess(communityEvent, relays, onUpdate) {
  if (deriveCommunityType(communityEvent) !== 'moderated') {
    return subscribeToProfileListMembers(communityEvent, relays, (memberMap) => {
      onUpdate(buildProfileAccess(memberMap, false));
    });
  }

  const pointer = parseMembershipPointer(communityEvent);
  const hasRestrictedSections = parseCommunityContentTypes(communityEvent).some(sectionIsGated);
  if (!pointer || !hasRestrictedSections) {
    return { cleanup: () => {}, hasRestrictedSections };
  }

  const key = channelKey(pointer);
  /** @type {Record<string, Set<string>>} */
  let membersByKey = {};
  /** @type {Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>} */
  let adminsByKey = {};
  const emit = () =>
    onUpdate(buildRosterAccess(communityEvent, rosterView(pointer, membersByKey, adminsByKey)));

  let sub = { unsubscribe: () => {} };
  try {
    sub = pool
      .relay(pointer.relay)
      .request({ kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': [pointer.id] }, { timeout: 8000 })
      .subscribe({
        next: (/** @type {any} */ event) => {
          if (!event || !Array.isArray(event.tags) || !key) return;
          if (event.kind === GROUP_MEMBERS_KIND) {
            membersByKey = { ...membersByKey, [key]: new Set(getGroupMembers(event) ?? []) };
          } else if (event.kind === GROUP_ADMINS_KIND) {
            adminsByKey = { ...adminsByKey, [key]: getGroupAdmins(event) ?? [] };
          } else {
            return;
          }
          emit();
        },
        // A dead group relay must not break the whole dashboard feed —
        // parity with the legacy path, which also never errors the caller.
        error: () => {}
      });
  } catch {
    // malformed relay URL — leave access in its loading state
  }
  return { cleanup: () => sub.unsubscribe(), hasRestrictedSections };
}
```

Rewire `DashboardCommunityFeed.svelte`:
- Replace the `subscribeToProfileListMembers`/`buildProfileAccess` imports (`:25-26`) with `import { subscribeToCommunityAccess } from '$lib/groups/community-access-subscription.js';`.
- In the `$effect` (`:199-210`): call `subscribeToCommunityAccess(communityEvent, getCommunikeyRelays(), (access) => { … store access on the acl entry … })` and store `access` instead of `memberMap` in `perCommunityAcl`.
- In `mergeAndUpdate` (`:165-169`): `if (acl?.communityEvent && acl.access) { merged = filterEventsByAccess(merged, acl.communityEvent, acl.access); }` — delete the `buildProfileAccess` call.
- Keep the `hasRestrictedSections === false → clear loading` logic (`:212-216`) — the wrapper preserves that field.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/__tests__/community-access-subscription.test.js src/lib/__tests__/roster-access.test.js` plus any existing dashboard tests (`pnpm vitest run src/lib/components/__tests__ -t Dashboard` — adjust to actual file names via `ls src/lib/components/__tests__ | grep -i dashboard`).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/groups/community-access-subscription.js src/lib/groups/roster-access.js src/lib/components/dashboard/DashboardCommunityFeed.svelte src/lib/__tests__/community-access-subscription.test.js
git commit -m "fix(dashboard): community feed filters moderated communities by roster access"
```

---

### Task 9: Full verification, live-relay probe, docs sync

**Files:**
- Possibly modify: `docs/nips/communikey-groups.md`, `docs/superpowers/specs/2026-08-12-groups-architecture-design.md` (only if implementation deviated)
- Create (scratch, not committed): a relay probe script in the session scratchpad

**Steps:**

- [ ] **Step 1: Full suite**

```bash
pnpm test          # expect: only the known pre-existing pomegranate-service.test.js collection failure (fails on dev too); anything else = regression
pnpm run check     # MUST exit 0
pnpm run lint
```

Known-flaky inbox/DM/concord-notification files: rerun individually before attributing failures.

- [ ] **Step 2: Live-relay probe of provisioning assumptions**

Write a zero-dependency Node script (Node 22 global WebSocket — see the repo's practice of verifying against live relays) in the scratchpad that, against the FIRST relay in the worktree `.env`'s `GROUPS_RELAYS` (if unset: report "probe skipped — no GROUPS_RELAYS configured" and stop, this is not a failure):
1. Generates a throwaway keypair (import `nostr-tools` from the worktree's node_modules for key/signing utilities).
2. Sends kind 9007 (`['h', <random 16-hex id>]` + name tag) then 9002 with `{name:'probe', public, closed, restricted}` markers, handling NIP-42 AUTH if challenged.
3. REQs `kinds:[39000,39001] #d:[id]` and asserts the relay materialized metadata AND lists the throwaway key as admin.
4. Cleans up with kind 9008 (delete-group).
Report the transcript (event ids, OKs, what came back). If the relay rejects 9007 from an unknown key, that is a FINDING to report prominently — it means moderated creation needs relay-side allowlisting and the design doc's deployment notes must say so.

- [ ] **Step 3: Docs sync**

Re-read `docs/nips/communikey-groups.md` against the shipped behavior. This plan should not have changed NIP semantics; the one candidate is the root group's `closed` join posture — add one sentence to the NIP draft's `membership` section if absent: "The root group MAY be `closed`; joining then happens via invite or application approval (put-user)." Update the design doc's follow-ups section: mark #1 and #3 done, note #2 moved to Plan 3.

- [ ] **Step 4: Commit docs (if changed)**

```bash
git add -f docs/nips/communikey-groups.md docs/superpowers/specs/2026-08-12-groups-architecture-design.md
git commit -m "docs: sync NIP draft + follow-ups after plan 2"
```

---

## Out of scope (→ Plan 3 / Plan 4)

- Plan 3: settings panes (Typ flips incl. legacy-a-tag stripping + builder sunset, Inhalte & Rechte access editor, Mitglieder & Rollen on the root group, application-form management), fixes #9 (settings spinner) and #12 (owner gating).
- Plan 4: two-zone sidebar, join/application flows (9021, form intake p-tagged to admins, approve→put-user), Geschlossen shell page, "erste Kanäle" wizard step for closed communities, moderated-lifecycle live E2E, remaining UX debt.
