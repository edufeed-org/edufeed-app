# NIP-29 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NIP-29 group creation from the community attach modal, a members-with-roles modal, and role management (add/remove/promote/demote, edit metadata, delete group), per `docs/superpowers/specs/2026-08-11-nip29-completion-design.md`.

**Architecture:** One new pure module `src/lib/groups/group-management.js` holds template builders (tag shapes matching applesauce-common's `operations/group.js` exactly) plus a group-relay-only publish helper with one NIP-42 auth retry. Components sign with the acting user and publish to `pool.relay(pointer.relay)` only — never the outbox. UI: a create sub-mode inside `AreaAttachModal`'s group tab, `GroupMembersModal` + `GroupSettingsSheet` opened from `GroupChat`.

**Note (deliberate divergence from spec):** the spec said "wrap applesauce factories". The groups lane's established convention is pure template builders in `src/lib/groups/*.js` (`buildGroupMessageTemplate`, `buildJoinRequestTemplate`, …) — factory classes are chain/promise-shaped and awkward here. We follow the lane convention; tests assert the exact tag shapes applesauce's `setPutUserTags`/`setEditMetadataTags` produce, which preserves the spec's intent (wire-compatible events).

**Tech Stack:** Svelte 5 runes, applesauce-common (`helpers/groups` constants), applesauce-relay pool (`pool.relay(url)`), vitest (+ @testing-library/svelte for jsdom), paraglide i18n (de + en).

## Global Constraints

- Branch: `feat/community-group-pointer`. Worktree: `.worktrees/group-pointer`. Do all work there.
- TDD: write the failing test first, run it, watch it fail, then implement.
- `set -a; . ./.env; set +a` before every vitest run (vitest does not load .env).
- Known-red baseline: GlobalFAB async-leak exit-1 on green suites — read the `Tests` summary line, not the exit code.
- Do not touch `.claude/worktrees/cordn-groups` (laoc's dev server :5179 serves it).
- `src/lib/groups/*.js` modules stay SSR-safe: top-level imports only from `applesauce-common/*`, rxjs, and sibling lane modules — never `applesauce-concord`/`applesauce-core-concord`.
- Every user-facing string is a paraglide message added to BOTH `messages/en.json` and `messages/de.json`. Never put a literal `@` before a `{param}` placeholder in a message value (breaks svelte-check).
- Events publish to the group's relay ONLY. Never route management events through `publishEvent()`/outbox. The single exception: kind-10009 list updates go through `publishEventOptimistic` (user's own relays), as `GroupChat.updateGroupsList` already does.
- Commit after every green step; commit messages in the repo's style (`feat(groups): …`, `test(groups): …`).

---

### Task 1: Management template builders

**Files:**
- Create: `src/lib/groups/group-management.js`
- Test: `src/lib/__tests__/group-management.test.js`

**Interfaces:**
- Consumes: `PUT_USER_KIND` (9000), `REMOVE_USER_KIND` (9001), `EDIT_METADATA_KIND` (9002), `CREATE_GROUP_KIND` (9007), `DELETE_GROUP_KIND` (9008) from `applesauce-common/helpers/groups`.
- Produces (all return `{kind, content: '', created_at, tags}`):
  - `buildCreateGroupTemplate(groupId: string) -> template` (kind 9007, tags `[['h', id]]`)
  - `buildEditGroupMetadataTemplate(groupId, meta: {name?: string, about?: string, picture?: string, isPublic: boolean, isOpen: boolean}) -> template` (kind 9002)
  - `buildPutUserTemplate(groupId, pubkey, roles?: string[]) -> template` (kind 9000)
  - `buildRemoveUserTemplate(groupId, pubkey) -> template` (kind 9001)
  - `buildDeleteGroupTemplate(groupId) -> template` (kind 9008)
  - `generateGroupId() -> string` (16 lowercase hex chars, `crypto.getRandomValues`)

Tag rules for 9002 (mirror applesauce `setEditMetadataTags`, but emit BOTH marker sides explicitly so a flip always overwrites): `['name', v]` / `['about', v]` / `['picture', v]` only when the field is a non-empty string after trim; then `['public']` or `['private']` from `isPublic`; then `['open']` or `['closed']` from `isOpen`. 9000 user tag: `['p', pubkey, ...roles]` when roles non-empty, else `['p', pubkey]` (exact applesauce `setPutUserTags` shape).

- [ ] **Step 1: Write the failing test** — `/** @vitest-environment node */` at top:

```javascript
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildCreateGroupTemplate,
  buildEditGroupMetadataTemplate,
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  buildDeleteGroupTemplate,
  generateGroupId
} from '$lib/groups/group-management.js';

const ID = 'abc123def456aa00';
const PK = 'f'.repeat(64);

describe('group management templates', () => {
  it('create-group is a kind 9007 with only the h tag', () => {
    const t = buildCreateGroupTemplate(ID);
    expect(t.kind).toBe(9007);
    expect(t.tags).toEqual([['h', ID]]);
    expect(t.content).toBe('');
    expect(t.created_at).toBeTypeOf('number');
  });

  it('edit-metadata carries fields and BOTH-side markers', () => {
    const t = buildEditGroupMetadataTemplate(ID, {
      name: 'Study group',
      about: 'notes',
      picture: 'https://x/y.png',
      isPublic: false,
      isOpen: false
    });
    expect(t.kind).toBe(9002);
    expect(t.tags).toEqual([
      ['h', ID],
      ['name', 'Study group'],
      ['about', 'notes'],
      ['picture', 'https://x/y.png'],
      ['private'],
      ['closed']
    ]);
  });

  it('edit-metadata skips empty fields and flips markers', () => {
    const t = buildEditGroupMetadataTemplate(ID, { name: '  ', isPublic: true, isOpen: true });
    expect(t.tags).toEqual([['h', ID], ['public'], ['open']]);
  });

  it('put-user matches applesauce shape with and without roles', () => {
    expect(buildPutUserTemplate(ID, PK, ['admin']).tags).toEqual([
      ['h', ID],
      ['p', PK, 'admin']
    ]);
    expect(buildPutUserTemplate(ID, PK).tags).toEqual([
      ['h', ID],
      ['p', PK]
    ]);
    expect(buildPutUserTemplate(ID, PK).kind).toBe(9000);
  });

  it('remove-user and delete-group', () => {
    expect(buildRemoveUserTemplate(ID, PK)).toMatchObject({
      kind: 9001,
      tags: [
        ['h', ID],
        ['p', PK]
      ]
    });
    expect(buildDeleteGroupTemplate(ID)).toMatchObject({ kind: 9008, tags: [['h', ID]] });
  });

  it('generateGroupId yields 16 lowercase hex chars, unique-ish', () => {
    const a = generateGroupId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(generateGroupId()).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `set -a; . ./.env; set +a; npx vitest run src/lib/__tests__/group-management.test.js`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** `src/lib/groups/group-management.js`:

```javascript
// NIP-29 group-management templates (kinds 9000-9008). Pure builders in the
// lane's house style (see groups.js); tag shapes mirror applesauce-common's
// operations/group.js so events are wire-identical to factory output. The one
// deliberate difference: edit-metadata emits BOTH marker sides explicitly
// (public|private, open|closed) so flipping a flag always overwrites state.
import {
  PUT_USER_KIND,
  REMOVE_USER_KIND,
  EDIT_METADATA_KIND,
  CREATE_GROUP_KIND,
  DELETE_GROUP_KIND
} from 'applesauce-common/helpers/groups';

const now = () => Math.floor(Date.now() / 1000);
/** @param {number} kind @param {string[][]} tags */
const template = (kind, tags) => ({ kind, content: '', created_at: now(), tags });

/** @param {string} groupId */
export function buildCreateGroupTemplate(groupId) {
  return template(CREATE_GROUP_KIND, [['h', groupId]]);
}

/**
 * @param {string} groupId
 * @param {{name?: string, about?: string, picture?: string, isPublic: boolean, isOpen: boolean}} meta
 */
export function buildEditGroupMetadataTemplate(groupId, meta) {
  /** @type {string[][]} */
  const tags = [['h', groupId]];
  for (const key of /** @type {const} */ (['name', 'about', 'picture'])) {
    const value = meta[key]?.trim();
    if (value) tags.push([key, value]);
  }
  tags.push([meta.isPublic ? 'public' : 'private']);
  tags.push([meta.isOpen ? 'open' : 'closed']);
  return template(EDIT_METADATA_KIND, tags);
}

/** @param {string} groupId @param {string} pubkey @param {string[]} [roles] */
export function buildPutUserTemplate(groupId, pubkey, roles = []) {
  const p = roles.length > 0 ? ['p', pubkey, ...roles] : ['p', pubkey];
  return template(PUT_USER_KIND, [['h', groupId], p]);
}

/** @param {string} groupId @param {string} pubkey */
export function buildRemoveUserTemplate(groupId, pubkey) {
  return template(REMOVE_USER_KIND, [
    ['h', groupId],
    ['p', pubkey]
  ]);
}

/** @param {string} groupId */
export function buildDeleteGroupTemplate(groupId) {
  return template(DELETE_GROUP_KIND, [['h', groupId]]);
}

/** 16 hex chars — the short relay-scoped id style Armada uses. */
export function generateGroupId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run to verify it passes.** Same command. Expected: 6 passed.
- [ ] **Step 5: Commit** — `git add src/lib/groups/group-management.js src/lib/__tests__/group-management.test.js && git commit -m "feat(groups): NIP-29 management event templates"`

### Task 2: Group-relay publish helper + create orchestration

**Files:**
- Modify: `src/lib/groups/group-management.js` (append)
- Test: `src/lib/__tests__/group-management.test.js` (append)

**Interfaces:**
- Consumes: Task-1 builders; `authenticateOnce(relay, signer)` from `src/lib/groups/relay-auth.js` (resolves `{ok, message?}`, guards double-AUTH itself); `GROUP_METADATA_KIND` (39000).
- Produces:
  - `publishToGroupRelay(relayConn, template, user) -> Promise<signedEvent>` — `user = {pubkey, signer}`; sign → `relayConn.publish(signed)` → if `{ok:false}` with message starting `auth-required` then `authenticateOnce(relayConn, user.signer)` and retry ONCE → throw `Error(response.message)` on final `{ok:false}`.
  - `confirmGroupMetadata(relayConn, groupId) -> Promise<event|null>` — first 39000 with `#d=[groupId]` (10 s timeout), null when none.
  - `createGroupOnRelay({relayConn, id, metadata, user}) -> Promise<event>` — 9007, then 9002, then 500 ms settle delay, then confirm; throws `Error('group not confirmed by relay')` on null. `metadata` has the Task-1 edit-metadata shape.
- `relayConn` is a `pool.relay(url)` object (callers pass it in — keeps this module free of the pool import and easy to mock): `.publish(event) -> Promise<{ok, message?}>`, `.request(filters, opts) -> Observable<event>`, plus the `.authenticated`/`.challenge`/`.authenticate()` surface `authenticateOnce` reads.

- [ ] **Step 1: Write the failing tests** (append; mock `relay-auth.js`):

```javascript
import { vi } from 'vitest';
import {
  publishToGroupRelay,
  confirmGroupMetadata,
  createGroupOnRelay
} from '$lib/groups/group-management.js';
import { of, EMPTY } from 'rxjs';

vi.mock('$lib/groups/relay-auth.js', () => ({
  authenticateOnce: vi.fn(async () => ({ ok: true }))
}));
import { authenticateOnce } from '$lib/groups/relay-auth.js';

const user = {
  pubkey: PK,
  signer: { signEvent: vi.fn(async (t) => ({ ...t, id: 'signed', sig: 'sig' })) }
};

describe('publishToGroupRelay', () => {
  it('signs with the user pubkey and resolves on ok', async () => {
    const relayConn = { publish: vi.fn(async () => ({ ok: true })) };
    const signed = await publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user);
    expect(user.signer.signEvent).toHaveBeenCalledWith(expect.objectContaining({ pubkey: PK }));
    expect(relayConn.publish).toHaveBeenCalledOnce();
    expect(signed.id).toBe('signed');
  });

  it('retries exactly once after auth-required, then succeeds', async () => {
    const relayConn = {
      publish: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, message: 'auth-required: join first' })
        .mockResolvedValueOnce({ ok: true })
    };
    await publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user);
    expect(authenticateOnce).toHaveBeenCalledOnce();
    expect(relayConn.publish).toHaveBeenCalledTimes(2);
  });

  it('throws the relay reason on rejection', async () => {
    const relayConn = { publish: vi.fn(async () => ({ ok: false, message: 'restricted: no' })) };
    await expect(
      publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user)
    ).rejects.toThrow('restricted: no');
    expect(relayConn.publish).toHaveBeenCalledOnce(); // no retry on non-auth reasons
  });
});

describe('createGroupOnRelay', () => {
  it('sends 9007 then 9002 and resolves with the confirming 39000', async () => {
    const meta39000 = { kind: 39000, tags: [['d', ID]] };
    const relayConn = {
      publish: vi.fn(async () => ({ ok: true })),
      request: vi.fn(() => of(meta39000))
    };
    const confirmed = await createGroupOnRelay({
      relayConn,
      id: ID,
      user,
      metadata: { name: 'X', isPublic: false, isOpen: false }
    });
    const kinds = relayConn.publish.mock.calls.map(([e]) => e.kind);
    expect(kinds).toEqual([9007, 9002]);
    expect(relayConn.request).toHaveBeenCalledWith(
      { kinds: [39000], '#d': [ID] },
      { timeout: 10000 }
    );
    expect(confirmed).toBe(meta39000);
  });

  it('throws when the relay never announces the group', async () => {
    const relayConn = { publish: vi.fn(async () => ({ ok: true })), request: vi.fn(() => EMPTY) };
    await expect(
      createGroupOnRelay({ relayConn, id: ID, user, metadata: { isPublic: false, isOpen: false } })
    ).rejects.toThrow('group not confirmed by relay');
  });
});
```

Note: the 500 ms settle delay makes these tests slow-but-fine (~1 s). Do NOT use fake timers here — `firstValueFrom` + real `of()` keeps it simple.

- [ ] **Step 2: Run to verify failure** (missing exports).
- [ ] **Step 3: Implement** (append to `group-management.js`):

```javascript
import { firstValueFrom } from 'rxjs';
import { defaultIfEmpty } from 'rxjs/operators';
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';
import { authenticateOnce } from './relay-auth.js';

/**
 * Sign as `user` and publish to the group relay ONLY. One NIP-42 retry when
 * the relay answers auth-required; every other rejection throws with the
 * relay's reason so the UI can show it.
 * @param {any} relayConn a pool.relay(url) connection
 * @param {any} template
 * @param {{pubkey: string, signer: any}} user
 */
export async function publishToGroupRelay(relayConn, template, user) {
  const signed = await user.signer.signEvent({ ...template, pubkey: user.pubkey });
  let response = await relayConn.publish(signed);
  if (response?.ok === false && String(response.message ?? '').startsWith('auth-required')) {
    const auth = await authenticateOnce(relayConn, user.signer);
    if (auth.ok) response = await relayConn.publish(signed);
  }
  if (response && response.ok === false) {
    throw new Error(response.message || 'relay rejected the event');
  }
  return signed;
}

/** First kind-39000 for this id from the relay, or null. @param {any} relayConn @param {string} groupId */
export function confirmGroupMetadata(relayConn, groupId) {
  return firstValueFrom(
    relayConn
      .request({ kinds: [GROUP_METADATA_KIND], '#d': [groupId] }, { timeout: 10000 })
      .pipe(defaultIfEmpty(null))
  );
}

/**
 * 9007 create → 9002 metadata → confirm the relay's 39000. Metadata rides the
 * 9002 (relays are not required to honour it on the 9007 itself). A group
 * created but not confirmed is recoverable via attach-existing.
 * @param {{relayConn: any, id: string, metadata: any, user: {pubkey: string, signer: any}}} args
 */
export async function createGroupOnRelay({ relayConn, id, metadata, user }) {
  await publishToGroupRelay(relayConn, buildCreateGroupTemplate(id), user);
  await publishToGroupRelay(relayConn, buildEditGroupMetadataTemplate(id, metadata), user);
  // Give the relay a beat to materialise its addressables before we ask.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const confirmed = await confirmGroupMetadata(relayConn, id);
  if (!confirmed) throw new Error('group not confirmed by relay');
  return confirmed;
}
```

(Move the two new imports to the top of the file with the existing ones.)

- [ ] **Step 4: Run to verify green** (whole file: builders + new describe blocks).
- [ ] **Step 5: Commit** — `feat(groups): create/publish orchestration against the group relay`

### Task 3: `GROUPS_RELAYS` config plumbing

**Files:**
- Modify: `src/routes/api/config/+server.js` (next to `kanbanRelays`, ~line 172)
- Modify: `src/lib/stores/config.svelte.js` (defaultConfig `appRelays` block ~line 28; merge block ~line 267)
- Modify: `src/lib/helpers/relay-helper.js` (new export)
- Test: `src/lib/__tests__/relay-helper-groups.test.js` (create)

**Interfaces:**
- Produces: `getGroupsRelays() -> string[]` from `$lib/helpers/relay-helper.js` — `runtimeConfig.appRelays?.groups ?? []`. NO fallback-relay union (fallback relays are not NIP-29 hosts; an empty array means "deployment has no default host" and the create form requires manual relay entry). Env: `GROUPS_RELAYS` (comma-separated).

- [ ] **Step 1: Failing test:**

```javascript
/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

describe('getGroupsRelays', () => {
  beforeEach(() => {
    runtimeConfig.appRelays = { ...(runtimeConfig.appRelays ?? {}), groups: [] };
  });
  it('returns the configured groups relays verbatim', () => {
    runtimeConfig.appRelays.groups = ['wss://groups.example/'];
    expect(getGroupsRelays()).toEqual(['wss://groups.example/']);
  });
  it('returns [] with no fallback union when unset', () => {
    runtimeConfig.appRelays.groups = [];
    expect(getGroupsRelays()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** (export missing).
- [ ] **Step 3: Implement.** In `+server.js`, after `kanbanRelays: parseArray(env.KANBAN_RELAYS),` add `groupsRelays: parseArray(env.GROUPS_RELAYS),`. In `config.svelte.js` defaultConfig add `groups: [] // NIP-29 group hosts (creation targets)` inside `appRelays`; in the merge block add `groups: runtimeConfig.groupsRelays || defaultConfig.appRelays.groups`. In `relay-helper.js` add:

```javascript
/**
 * NIP-29 group host relays for the create-group flow. Deliberately NO
 * fallback union — fallback relays are not group hosts; empty means the
 * deployment ships no default and the form requires a relay by hand.
 * @returns {string[]}
 */
export function getGroupsRelays() {
  return runtimeConfig.appRelays?.groups ?? [];
}
```

- [ ] **Step 4: Run to verify green.** Also run `set -a; . ./.env; set +a; npx vitest run src/lib/__tests__/relay-helper.test.js` if that suite exists, to catch regressions in the touched file.
- [ ] **Step 5: Commit** — `feat(groups): GROUPS_RELAYS deployment default for group creation`

### Task 4: Protocol feature notices in the attach modal

**Files:**
- Modify: `messages/en.json`, `messages/de.json`
- Modify: `src/lib/components/community/channels/AreaAttachModal.svelte`
- Test: `src/lib/components/__tests__/AreaAttachModal.group-tab.test.svelte.js` (extend — reuse its existing render harness/mocks)

**Interfaces:**
- Consumes: existing `modes` derived (`attachableAreaModes`) and `activeTab` in the modal.
- Produces: message keys `concord_protocol_notice`, `groups_protocol_notice`; a notice `<p data-testid="protocol-notice">` rendered directly under the tablist, ONLY when `modes.concord && modes.group`, text switching with `activeTab`.

- [ ] **Step 1: Add messages.** `messages/en.json`:

```json
"concord_protocol_notice": "Concord: end-to-end encrypted — the relay cannot read contents. Membership by invitation. Works with Edufeed and Armada.",
"groups_protocol_notice": "NIP-29: membership is managed by the group relay, which can read contents. Public or private. Works across many Nostr apps."
```

`messages/de.json`:

```json
"concord_protocol_notice": "Concord: Ende-zu-Ende-verschlüsselt — das Relay kann Inhalte nicht lesen. Mitgliedschaft per Einladung. Funktioniert mit Edufeed und Armada.",
"groups_protocol_notice": "NIP-29: Die Mitgliedschaft verwaltet das Gruppen-Relay, das Inhalte lesen kann. Öffentlich oder privat. Funktioniert mit vielen Nostr-Apps."
```

- [ ] **Step 2: Failing test** (append to the existing group-tab test file, using its established render helper):

```javascript
it('shows a per-protocol notice only while both tabs are on offer', async () => {
  // both modes available: a communikeyEvent with neither pointer kind
  render(AreaAttachModal, { props: { communikeyEvent: bareCommunity, onClose: vi.fn() } });
  expect(screen.getByTestId('protocol-notice')).toBeTruthy();
  await fireEvent.click(screen.getByTestId('attach-tab-group'));
  expect(screen.getByTestId('protocol-notice').textContent).toContain('NIP-29');
});

it('hides the notice when only one mode is left', () => {
  // a communikeyEvent already carrying a ["group", id, relay] tag
  render(AreaAttachModal, { props: { communikeyEvent: groupBoundCommunity, onClose: vi.fn() } });
  expect(screen.queryByTestId('protocol-notice')).toBeNull();
});
```

(Adopt the file's existing fixture names for a bare vs. group-carrying community event; add them if absent: `bareCommunity = {kind: 10222, pubkey: PK_A, content: '', tags: []}` and `groupBoundCommunity = {...bareCommunity, tags: [['group', 'gid01', 'wss://host.example/']]}`.)

- [ ] **Step 3: Run to verify failure** — `set -a; . ./.env; set +a; npx vitest run --environment jsdom src/lib/components/__tests__/AreaAttachModal.group-tab.test.svelte.js`
- [ ] **Step 4: Implement.** In the modal template, directly after the closing `{/if}` of the tablist block:

```svelte
{#if modes.concord && modes.group}
  <p class="mb-2 rounded-lg bg-base-200 p-2.5 text-xs text-base-content/70" data-testid="protocol-notice">
    {activeTab === 'group' ? m.groups_protocol_notice() : m.concord_protocol_notice()}
  </p>
{/if}
```

- [ ] **Step 5: Run to verify green; commit** — `feat(groups): protocol feature notices in the attach modal`

### Task 5: Create sub-mode in the attach modal's group tab

**Files:**
- Modify: `messages/en.json`, `messages/de.json`
- Modify: `src/lib/components/community/channels/AreaAttachModal.svelte`
- Test: `src/lib/components/__tests__/AreaAttachModal.create-tab.test.svelte.js` (create; copy the render/mocks scaffolding from the group-tab test file)

**Interfaces:**
- Consumes: `createGroupOnRelay`, `generateGroupId` (Task 2), `getGroupsRelays` (Task 3), `isValidRelayUrl` from `$lib/groups/groups.js`, `attachGroupChannel` (existing), `pool` from `$lib/stores/nostr-infrastructure.svelte`, `manager` (already imported).
- Produces: inside the group tab, a two-button segmented control `data-testid="group-mode-attach"` / `data-testid="group-mode-create"`; create form fields `group-create-name`, `group-create-about`, `group-create-picture`, `group-create-relay`, `group-create-public`, `group-create-open`, submit `group-create-confirm`.

Behavior contract:
- `groupMode: 'attach' | 'create'`, default `'attach'`; the attach form is the existing markup, unchanged, shown when `groupMode === 'attach'`.
- Relay field initialised once from `getGroupsRelays()[0] ?? ''`; toggles default OFF (private + closed).
- Submit disabled unless `createName.trim()` truthy AND `isValidRelayUrl(createRelay)` AND `communitySigner` AND `manager.active?.signer` AND not `busy`.
- Submit flow: `id = generateGroupId()` → `createGroupOnRelay({relayConn: pool.relay(createRelay), id, metadata: {name, about, picture, isPublic: createPublic, isOpen: createOpen}, user: manager.active})` → `attachGroupChannel({communikeyEvent, pointer: {id, relay: createRelay, name: createName.trim(), access: createOpen ? 'members' : 'invited'}, communitySigner})` → success toast → `onAttached?.()` → `onClose()`. Any throw: `console.error` + error toast, modal stays open.

- [ ] **Step 1: Add messages** (en / de):

```json
"groups_mode_attach": "Attach existing",
"groups_mode_create": "Create new",
"groups_create_name_label": "Group name",
"groups_create_about_label": "Description (optional)",
"groups_create_picture_label": "Picture URL (optional)",
"groups_create_relay_label": "Host relay",
"groups_create_public_toggle": "Visible to non-members",
"groups_create_open_toggle": "Anyone can join",
"groups_create_action": "Create & attach",
"groups_create_success": "Group created and attached",
"groups_create_failed": "Creating the group failed"
```

```json
"groups_mode_attach": "Bestehende verknüpfen",
"groups_mode_create": "Neu erstellen",
"groups_create_name_label": "Gruppenname",
"groups_create_about_label": "Beschreibung (optional)",
"groups_create_picture_label": "Bild-URL (optional)",
"groups_create_relay_label": "Host-Relay",
"groups_create_public_toggle": "Für Nicht-Mitglieder sichtbar",
"groups_create_open_toggle": "Beitritt für alle offen",
"groups_create_action": "Erstellen & verknüpfen",
"groups_create_success": "Gruppe erstellt und verknüpft",
"groups_create_failed": "Gruppe konnte nicht erstellt werden"
```

- [ ] **Step 2: Failing tests** (new file; `vi.mock` `$lib/groups/group-management.js`, `$lib/groups/community-attach.js` — keep `attachableAreaModes` real via `importOriginal`, mock only `attachGroupChannel` —, `$lib/stores/nostr-infrastructure.svelte` with `pool.relay: vi.fn(() => relayConnStub)`, `$lib/helpers/relay-helper.js` with `getGroupsRelays: () => ['wss://groups.example/']`, and `$lib/stores/accounts.svelte` with a manager stub exposing `active = {pubkey: SELF, signer: {}}` and `getAccountForPubkey` returning a signer):

```javascript
it('create mode prefills the deployment relay and defaults private+closed', async () => {
  render(AreaAttachModal, { props: { communikeyEvent: bareCommunity, onClose: vi.fn() } });
  await fireEvent.click(screen.getByTestId('attach-tab-group'));
  await fireEvent.click(screen.getByTestId('group-mode-create'));
  expect(screen.getByTestId('group-create-relay').value).toBe('wss://groups.example/');
  expect(screen.getByTestId('group-create-public').checked).toBe(false);
  expect(screen.getByTestId('group-create-open').checked).toBe(false);
});

it('disables submit until a name and a valid relay are present', async () => { /* type name, clear relay, assert disabled; restore relay, assert enabled */ });

it('creates on the chosen relay then attaches with the community signer', async () => {
  // fill name 'Mathe', submit; assert createGroupOnRelay called with
  // metadata {name:'Mathe', isPublic:false, isOpen:false} and the id from the
  // mocked generateGroupId; assert attachGroupChannel called with pointer
  // {id, relay:'wss://groups.example/', name:'Mathe', access:'invited'};
  // assert onAttached and onClose fired.
});

it('keeps the modal open and toasts on failure', async () => {
  // createGroupOnRelay rejects; assert showToast('error') and onClose NOT called.
});
```

Write these four out fully in the actual file (with fixtures and `vi.hoisted` spies, mirroring the group-tab test file's idiom).

- [ ] **Step 3: Run to verify failure.**
- [ ] **Step 4: Implement** the sub-mode in the modal (segmented control after the group-tab lead paragraph; `{#if groupMode === 'create'}` form; `createGroup()` handler per the behavior contract above).
- [ ] **Step 5: Run the create-tab AND group-tab test files to green.** Run `pnpm check`. Commit — `feat(groups): create a NIP-29 group from the community attach modal`

### Task 6: GroupChat — admins roster, refresh trigger, management entry points

**Files:**
- Modify: `src/lib/components/groups/GroupChat.svelte`
- Test: `src/lib/components/__tests__/GroupChat.roster.test.svelte.js` (create) — if mounting GroupChat proves too heavy (it drags the whole chat stack), test the pure pieces instead: extract `myAdminEntry(admins, pubkey)` into `src/lib/groups/groups.js` with a unit test, and cover the modal/sheet wiring in Tasks 7–8's component tests.

**Interfaces:**
- Consumes: `getGroupAdmins` from `applesauce-common/helpers/groups` (returns `{pubkey, roles: string[]}[]`).
- Produces (used by Tasks 7–8):
  - `let admins = $state.raw([])` — captured in the existing metadata `$effect` next to the 39002 branch: `if (event.kind === GROUP_ADMINS_KIND) admins = getGroupAdmins(event) ?? [];`
  - `let rosterSeq = $state(0)` — read at the TOP of the metadata `$effect` (`rosterSeq;` — before any early return, per the effect-deps memory) so bumping it re-runs the one-shot roster request.
  - `const isAdmin = $derived(!!myPubkey && admins.some((a) => a.pubkey === myPubkey))`
  - Header: the member-count `<span>` becomes a `<button data-testid="group-members-open">` opening `GroupMembersModal` (Task 7); an admin-only `<button data-testid="group-settings-open">` (gear/⋯) opens `GroupSettingsSheet` (Task 8). Both close via local `$state` booleans.
  - `onRosterChanged = () => { rosterSeq++; }` passed to the modal; `updateGroupsList` (existing) passed to the sheet for the post-delete 10009 removal.

- [ ] **Step 1: Write the failing test** for whichever seam you take (component render asserting `group-members-open` exists and `group-settings-open` only for an admin fixture; or the extracted-helper unit test). Run it, watch it fail.
- [ ] **Step 2: Implement the state + header changes.** Import and mount the two new components behind `{#if membersOpen}` / `{#if settingsOpen}` guards (they exist after Tasks 7–8; until then keep this task's commit to state + header seams if working strictly in order, or reorder to land after Task 7 — executor's choice, note it in the commit).
- [ ] **Step 3: Green + `pnpm check` + commit** — `feat(groups): admin roster and management entry points in group chat`

### Task 7: GroupMembersModal

**Files:**
- Create: `src/lib/components/groups/GroupMembersModal.svelte`
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/GroupMembersModal.test.js` (create)

**Interfaces:**
- Props: `{ pointer, metadata, admins, members, myPubkey, isAdmin, onRosterChanged, onClose }` — `admins: {pubkey, roles: string[]}[]`, `members: Set<string>`, `pointer: {id, relay}`.
- Consumes: `buildPutUserTemplate`, `buildRemoveUserTemplate`, `publishToGroupRelay` (Tasks 1–2); `pool` from `$lib/stores/nostr-infrastructure.svelte`; `useActiveUser` from `$lib/stores/accounts.svelte`; `useProfileMap`; `ContactSearchInput` (usage exactly as `ChannelInviteSheet.svelte:214-220`: `acceptPubkeyInput`, `exclude`, `onselect={(c) => addMember(c.pubkey)}`, `onrawpubkey={(hex) => addMember(hex)}`); `getUserDisplayName` from `$lib/helpers/message-utils.js`; `showToast`.
- Produces: DaisyUI modal listing **Admins** (role chips per `admin.roles`, fallback chip `admin` when roles empty) then **Members** (members minus admin pubkeys). Per-row admin-only actions: member rows `data-testid="member-promote"` / `data-testid="member-remove"`; admin rows `data-testid="member-demote"` (hidden on your own row). Add-member search shown only when `isAdmin`.

Action handlers (each: publish → `onRosterChanged()` → no local mutation; the roster re-request is the source of truth):

```javascript
async function putUser(pubkey, roles) {
  const user = getActiveUser();
  if (!user) return;
  busy = true;
  try {
    await publishToGroupRelay(
      pool.relay(pointer.relay),
      buildPutUserTemplate(pointer.id, pubkey, roles),
      user
    );
    onRosterChanged?.();
  } catch (err) {
    console.error('groups: put-user failed', err);
    showToast(m.groups_members_action_failed(), 'error');
  } finally {
    busy = false;
  }
}
const addMember = (pubkey) => putUser(pubkey, []);
const promote = (pubkey) => putUser(pubkey, ['admin']);
const demote = (pubkey) => putUser(pubkey, []);
async function removeMember(pubkey) { /* same shape with buildRemoveUserTemplate */ }
```

Promote role choice: use the literal role `admin` in v1. (The 39003 roles list is a relay-level nicety; wiring a picker for it is YAGNI until a relay in the field announces custom roles — note this in a comment.)

- [ ] **Step 1: Messages** (en / de):

```json
"groups_members_title": "Members",
"groups_members_admins_heading": "Admins",
"groups_members_members_heading": "Members",
"groups_members_add_placeholder": "Add member by name or npub",
"groups_members_promote": "Make admin",
"groups_members_demote": "Remove admin",
"groups_members_remove": "Remove",
"groups_members_action_failed": "The relay refused the change"
```

```json
"groups_members_title": "Mitglieder",
"groups_members_admins_heading": "Admins",
"groups_members_members_heading": "Mitglieder",
"groups_members_add_placeholder": "Mitglied per Name oder npub hinzufügen",
"groups_members_promote": "Zum Admin machen",
"groups_members_demote": "Admin entfernen",
"groups_members_remove": "Entfernen",
"groups_members_action_failed": "Das Relay hat die Änderung abgelehnt"
```

- [ ] **Step 2: Failing component tests** (jsdom; mock `group-management.js` with `vi.hoisted` spies, mock `nostr-infrastructure` pool, `accounts` active user, stub `ContactSearchInput` with the same button-stub fixture idiom the ChannelInviteSheet test uses):
  - renders admins with role chips and members without admin duplicates
  - non-admin: no action buttons, no add-member input
  - admin: promote publishes put-user with `['admin']`, demote with `[]`, remove publishes remove-user — assert exact template args on the mocked builders and that `onRosterChanged` fired
  - a rejected publish toasts and does NOT call `onRosterChanged`
    Write all assertions out concretely in the test file.
- [ ] **Step 3: Run to verify failure. Implement the component. Green.**
- [ ] **Step 4: Wire into GroupChat** (the `{#if membersOpen}` mount from Task 6), passing `admins`, `members`, `isAdmin`, `onRosterChanged`. Run the GroupChat-side test from Task 6 again.
- [ ] **Step 5: `pnpm check`; commit** — `feat(groups): members-with-roles modal with put/remove management`

### Task 8: GroupSettingsSheet — edit metadata + delete group

**Files:**
- Create: `src/lib/components/groups/GroupSettingsSheet.svelte`
- Modify: `src/lib/components/groups/GroupChat.svelte` (mount + post-delete handling)
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/GroupSettingsSheet.test.js` (create)

**Interfaces:**
- Props: `{ pointer, metadata, metadataEvent, onClose, onDeleted }` — prefill: name/about/picture from `metadata` (applesauce parse), the public/open toggles read from `metadataEvent.tags` directly (`tags.some(t => t[0] === 'public')`, `tags.some(t => t[0] === 'open')`) because the applesauce parser reads an older draft's inverse tags (see the comment at `GroupChat.svelte:61-63`).
- Consumes: `buildEditGroupMetadataTemplate`, `buildDeleteGroupTemplate`, `publishToGroupRelay`; `pool`; `useActiveUser`; `showToast`.
- Produces: form (`group-edit-name`, `group-edit-about`, `group-edit-picture`, `group-edit-public`, `group-edit-open`, save `group-edit-save`) publishing one 9002 then toasting and closing. Danger zone: `group-delete` button → inline confirm (`group-delete-confirm`) → publish 9008 → `onDeleted()` → `onClose()`.
- GroupChat's `onDeleted` handler: `await updateGroupsList({ remove: pointer })`, then best-effort community detach, then `goto('/')`:

```javascript
import { goto } from '$app/navigation';
import { detachGroupChannel } from '$lib/groups/community-attach.js';
import { parseGroupPointers, channelKey } from '$lib/groups/community-pointer.js';
import { useJoinedCommunikeyEvents } from '$lib/helpers/joined-communikey-events.svelte.js';
import { manager } from '$lib/stores/accounts.svelte';

const getJoinedCommunities = useJoinedCommunikeyEvents(); // at component init, NOT in the handler

async function handleGroupDeleted() {
  await updateGroupsList({ remove: pointer });
  // Best-effort: unlist the dead channel from any joined community we can
  // sign for. Failures are logged, never surfaced — the group is already gone.
  for (const ck of getJoinedCommunities()) {
    const listed = parseGroupPointers(ck).some((p) => channelKey(p) === channelKey(pointer));
    const communitySigner = manager.getAccountForPubkey(ck.pubkey)?.signer;
    if (!listed || !communitySigner) continue;
    try {
      await detachGroupChannel({ communikeyEvent: ck, pointer, communitySigner });
    } catch (err) {
      console.error('groups: post-delete detach failed', err);
    }
  }
  goto('/');
}
```

(Verify `useJoinedCommunikeyEvents`'s exact call signature — it takes an optional `isEnabled` thunk — and `parseGroupPointers`' exported name in `community-pointer.js` before wiring; both exist on the branch.)

- [ ] **Step 1: Messages** (en / de):

```json
"groups_settings_title": "Group settings",
"groups_settings_save": "Save changes",
"groups_settings_saved": "Group updated",
"groups_settings_save_failed": "The relay refused the update",
"groups_settings_delete": "Delete group",
"groups_settings_delete_confirm": "Really delete this group for everyone? This cannot be undone.",
"groups_settings_deleted": "Group deleted",
"groups_settings_delete_failed": "The relay refused the deletion"
```

```json
"groups_settings_title": "Gruppeneinstellungen",
"groups_settings_save": "Änderungen speichern",
"groups_settings_saved": "Gruppe aktualisiert",
"groups_settings_save_failed": "Das Relay hat die Änderung abgelehnt",
"groups_settings_delete": "Gruppe löschen",
"groups_settings_delete_confirm": "Diese Gruppe wirklich für alle löschen? Das lässt sich nicht rückgängig machen.",
"groups_settings_deleted": "Gruppe gelöscht",
"groups_settings_delete_failed": "Das Relay hat das Löschen abgelehnt"
```

- [ ] **Step 2: Failing component tests** (same mock idiom as Task 7):
  - prefill: name/about/picture from `metadata`, toggles from `metadataEvent` tags (fixture with `['public']` present, `['open']` absent → public=true, open=false)
  - save publishes exactly one 9002 whose builder got `{name, about, picture, isPublic, isOpen}` matching the (edited) form state; success toasts + `onClose`
  - delete requires the confirm step (no 9008 on first click), then publishes 9008 and fires `onDeleted` + `onClose`
  - rejected save/delete toasts the failure message and fires neither `onDeleted` nor `onClose`
- [ ] **Step 3: Implement sheet; green.**
- [ ] **Step 4: Wire into GroupChat** (settings button from Task 6, `handleGroupDeleted` above). Re-run Task 6's test file.
- [ ] **Step 5: `pnpm check`; commit** — `feat(groups): edit-metadata and delete-group management sheet`

### Task 9: Housekeeping — sync with dev, full verification

- [ ] **Step 1:** `git merge dev` (one pending commit, `2e997b40`); resolve conflicts if any.
- [ ] **Step 2:** `set -a; . ./.env; set +a; npx vitest run` — full suite. Read the `Tests` summary line (GlobalFAB async-leak exit-1 is known-red; genuinely failing suites are not). Compare failures against a `git stash`-free dev baseline only if something unexpected is red. Known flaky-in-parallel: inbox/DM files (repo memory) — rerun those in isolation before blaming the branch.
- [ ] **Step 3:** `pnpm check` — clean.
- [ ] **Step 4:** `pnpm run lint` — clean (or `pnpm run format` then re-lint).
- [ ] **Step 5:** Commit any fixups; report branch merge-ready. Do NOT push (pre-push hook runs svelte-check 3× and pushes fan out to nostr+forgejo+github; leave pushing to laoc).

---

## Self-Review (2026-08-11)

- **Spec coverage:** creation flow ✓(T2+T5, relay default T3), feature notices ✓(T4), members-with-roles ✓(T6+T7), role management add/remove/promote/demote ✓(T7), edit metadata ✓(T8), delete group incl. 10009 removal + best-effort detach ✓(T8), XOR constraint — pre-existing, exercised by T4's "hides the notice / single-tab" test ✓, error handling (auth retry, loud confirm failure, toasts) ✓(T2/T5/T7/T8), no new E2E ✓, housekeeping ✓(T9).
- **Placeholder scan:** T5 step 2 and T7 step 2 name their assertions in prose with explicit instruction to write them out fully — acceptable rolling detail since the harness idiom is prescribed (copy the group-tab / invite-sheet test files). No TBDs.
- **Type consistency:** `buildEditGroupMetadataTemplate` meta shape `{name?, about?, picture?, isPublic, isOpen}` used identically in T2 (createGroupOnRelay), T5 (form submit), T8 (edit sheet). `pointer` is `{id, relay}` (+`name`/`access` only in the 10222 attach path) throughout. `publishToGroupRelay(relayConn, template, user)` arg order consistent in T2/T7/T8.
- **Divergence noted:** pure builders instead of factory wrappers (header note) — flag to laoc at handoff.
