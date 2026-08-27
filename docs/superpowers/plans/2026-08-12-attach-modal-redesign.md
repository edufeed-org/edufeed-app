# Attach-Modal Redesign („Gruppe verknüpfen") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AreaAttachModal's protocol tabs + raw `host'id` input with one unified picker over groups the app already knows, a paste fallback with metadata preview, and an access question that only appears when it means something.

**Architecture:** Pure candidate/parse/visibility logic goes into `src/lib/groups/attach-candidates.js`; the network preview into `src/lib/groups/group-preview.js`; `AreaAttachModal.svelte` is rewritten to consume both. Attach dispatch (`attachConcordArea`, `attachGroupChannel`) and `attachableAreaModes` XOR gating are unchanged.

**Tech Stack:** SvelteKit / Svelte 5 runes, Vitest (node + jsdom), applesauce pool, Paraglide i18n (de+en).

**Spec:** `docs/superpowers/specs/2026-08-12-attach-modal-redesign-design.md`

## Global Constraints

- Categories, never protocol names in prominent copy: „Verschlüsselte Gruppe" / „Geschlossene Gruppe" / „Weltoffene Gruppe" (buzz design rule; protocol name at most once, small — this modal shows none).
- XOR gating stays exactly `attachableAreaModes(communikeyEvent)` — do not reimplement.
- The access radios reuse the wizard's i18n keys VERBATIM: `wizard_access_members`, `wizard_access_members_hint_closed`, `wizard_access_invited`, `wizard_access_invited_hint`. Default selection: `invited`.
- Accepted paste spellings: `host'id`, `wss://host'id`, `https://host'id`, `http://host'id` (http(s) mapped to wss); whitespace trimmed; nothing else.
- World-readable detection = `channelAccessLevel(metadata, undefined) === 'world'`; missing/unknown metadata counts as closed (safe: question shown).
- Every new i18n key lands in BOTH `messages/en.json` and `messages/de.json`.
- All Concord imports in components go to submodules directly, never the `$lib/concord` barrel.
- Commit after every task; never push.

---

### Task 1: Pure logic — candidates, liberal parse, question visibility

**Files:**

- Create: `src/lib/groups/attach-candidates.js`
- Test: `src/lib/__tests__/attach-candidates.test.js`

**Interfaces:**

- Consumes: `linkedChannelKeys` from `$lib/groups/unlinked-groups.js`; `channelKey` from `$lib/groups/community-pointer.js`; `channelAccessLevel` from `$lib/groups/channel-access.js`; `parseGroupInput` from `$lib/groups/groups.js`.
- Produces (Task 3 relies on these exact names):
  - `groupAttachCandidates({groups, communikeyEvent, metadataByKey}) -> Array<{key: string, name: string, category: 'closed'|'world', worldReadable: boolean, pointer: {id: string, relay: string}}>`
  - `parseGroupAddress(input) -> {relay: string, id: string} | null`
  - `attachAccessQuestion({kind, worldReadable}) -> boolean` (kind: `'concord' | 'group'`)

- [ ] **Step 1: Write the failing tests**

```javascript
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  groupAttachCandidates,
  parseGroupAddress,
  attachAccessQuestion
} from '$lib/groups/attach-candidates.js';

const COMMUNITY = 'c'.repeat(64);
/** A 10222 already carrying one group channel. */
const communikeyEvent = {
  kind: 10222,
  pubkey: COMMUNITY,
  tags: [['group', 'linked1', 'wss://host.example/']]
};
const meta = (/** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', 'x'], ['name', 'Lesekreis'], ...extra]
});

describe('groupAttachCandidates', () => {
  const groups = [
    { id: 'linked1', relay: 'wss://host.example' }, // already a channel here (slash-variant!)
    { id: 'open1', relay: 'wss://host.example/' },
    { id: 'closed1', relay: 'wss://other.example/' }
  ];

  it('excludes groups already linked to THIS community, across slash spellings', () => {
    const rows = groupAttachCandidates({ groups, communikeyEvent, metadataByKey: {} });
    // sorted by display name — with no metadata that is the id
    expect(rows.map((r) => r.pointer.id)).toEqual(['closed1', 'open1']);
  });

  it('categorizes world-readable vs closed from the 39000, unknown counts as closed', () => {
    const metadataByKey = {
      "open1@wss://host.example/": meta(), // no `private` tag -> world
      "closed1@wss://other.example/": meta([['private']])
    };
    const rows = groupAttachCandidates({ groups, communikeyEvent, metadataByKey });
    const open = rows.find((r) => r.pointer.id === 'open1');
    const closed = rows.find((r) => r.pointer.id === 'closed1');
    expect(open).toMatchObject({ category: 'world', worldReadable: true, name: 'Lesekreis' });
    expect(closed).toMatchObject({ category: 'closed', worldReadable: false });
    // no metadata at all -> closed, and the id stands in for the name
    const bare = groupAttachCandidates({ groups, communikeyEvent, metadataByKey: {} });
    expect(bare.find((r) => r.pointer.id === 'open1')).toMatchObject({
      category: 'closed',
      name: 'open1'
    });
  });

  it('handles empty and null inputs', () => {
    expect(groupAttachCandidates({ groups: [], communikeyEvent, metadataByKey: {} })).toEqual([]);
    expect(groupAttachCandidates({ groups: null, communikeyEvent: null, metadataByKey: {} })).toEqual([]);
  });
});

describe('parseGroupAddress', () => {
  it("accepts host'id, wss://host'id, and http(s) mapped to wss", () => {
    for (const input of [
      "groups.example'book",
      "wss://groups.example'book",
      "https://groups.example'book",
      "  http://groups.example'book  "
    ]) {
      expect(parseGroupAddress(input)).toEqual({ relay: 'wss://groups.example/', id: 'book' });
    }
  });

  it('rejects everything else', () => {
    expect(parseGroupAddress('')).toBeNull();
    // verified against decodeGroupPointer: a pasted page URL parses as the
    // host's ROOT group `_` (relay keeps the path) — acceptable, the preview
    // step is the gate that keeps a wrong parse from attaching anything.
    expect(parseGroupAddress('https://example.com/some/page')).toEqual({
      relay: 'wss://example.com/some/page',
      id: '_'
    });
    expect(parseGroupAddress("ftp://x'y")).toBeNull();
    expect(parseGroupAddress('not a url at all')).toBeNull();
  });
});

describe('attachAccessQuestion', () => {
  it('only a private NIP-29 target asks', () => {
    expect(attachAccessQuestion({ kind: 'concord', worldReadable: false })).toBe(false);
    expect(attachAccessQuestion({ kind: 'group', worldReadable: true })).toBe(false);
    expect(attachAccessQuestion({ kind: 'group', worldReadable: false })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/attach-candidates.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```javascript
// Which existing groups can become a channel of THIS community, and what the
// attach flow needs to know about each. Pure — the reactive plumbing stays in
// AreaAttachModal.svelte.
import { linkedChannelKeys } from './unlinked-groups.js';
import { channelKey } from './community-pointer.js';
import { channelAccessLevel } from './channel-access.js';
import { parseGroupInput } from './groups.js';

/** @param {{tags?: string[][]} | undefined} metadata */
function metadataName(metadata) {
  return (metadata?.tags ?? []).find((t) => t[0] === 'name' && t[1]?.trim())?.[1]?.trim() ?? '';
}

/**
 * The user's NIP-29 groups that are not yet a channel of THIS community.
 * Exclusion compares by channelKey, so slash spellings cannot sneak a linked
 * group back in. Missing metadata counts as closed — the safe reading, and
 * the one that keeps the access question on screen.
 * @param {{
 *   groups?: Array<{id: string, relay: string}> | null,
 *   communikeyEvent?: any,
 *   metadataByKey?: Record<string, {kind?: number, tags?: string[][]}>
 * }} input
 * @returns {Array<{key: string, name: string, category: 'closed'|'world', worldReadable: boolean, pointer: {id: string, relay: string}}>}
 */
export function groupAttachCandidates({ groups, communikeyEvent, metadataByKey = {} }) {
  const linked = linkedChannelKeys(communikeyEvent ? [communikeyEvent] : []);
  /** @type {Map<string, any>} */
  const byKey = new Map();
  for (const group of groups ?? []) {
    const key = channelKey(group);
    if (!key || linked.has(key) || byKey.has(key)) continue;
    const metadata = metadataByKey[key];
    const world = channelAccessLevel(metadata, undefined) === 'world';
    byKey.set(key, {
      key,
      name: metadataName(metadata) || group.id,
      category: world ? 'world' : 'closed',
      worldReadable: world,
      pointer: { id: group.id, relay: group.relay }
    });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * parseGroupInput, but forgiving about the scheme: people paste what their
 * browser or other app gave them, and that is https more often than wss.
 * @param {string} input
 * @returns {{relay: string, id: string} | null}
 */
export function parseGroupAddress(input) {
  const trimmed = (input ?? '').trim();
  const mapped = trimmed.replace(/^https?:\/\//i, 'wss://');
  return parseGroupInput(mapped);
}

/**
 * Only a private NIP-29 target needs the access question: Concord manages its
 * own membership, and a world-readable group has nothing to gate.
 * @param {{kind: 'concord'|'group', worldReadable: boolean}} target
 */
export function attachAccessQuestion({ kind, worldReadable }) {
  return kind === 'group' && !worldReadable;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/__tests__/attach-candidates.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/groups/attach-candidates.js src/lib/__tests__/attach-candidates.test.js
git commit -m "feat(groups): attach candidates, liberal address parse, access-question rule"
```

---

### Task 2: Group preview — fetch a 39000 and shape it for the paste card

**Files:**

- Create: `src/lib/groups/group-preview.js`
- Test: `src/lib/__tests__/group-preview.test.js`

**Interfaces:**

- Consumes: `confirmGroupMetadata` from `$lib/groups/group-management.js` (`(relayConn, groupId) -> Promise<event|null>`); `channelAccessLevel` from `$lib/groups/channel-access.js`.
- Produces (Task 3 relies on these exact names):
  - `groupPreviewFromMetadata(metadata) -> {name: string, picture: string|null, worldReadable: boolean} | null` (null for a non-39000)
  - `fetchGroupPreview(relayConn, pointer) -> Promise<{name, picture, worldReadable} | null>` — null when the host has no such group or the request fails.

- [ ] **Step 1: Write the failing tests**

```javascript
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { groupPreviewFromMetadata, fetchGroupPreview } from '$lib/groups/group-preview.js';
import { of, EMPTY } from 'rxjs';

const meta = (/** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', 'book'], ['name', 'Lesekreis'], ...extra]
});

describe('groupPreviewFromMetadata', () => {
  it('shapes name, picture and world-readability', () => {
    expect(groupPreviewFromMetadata(meta([['picture', 'https://x/y.png']]))).toEqual({
      name: 'Lesekreis',
      picture: 'https://x/y.png',
      worldReadable: true
    });
    expect(groupPreviewFromMetadata(meta([['private']]))).toEqual({
      name: 'Lesekreis',
      picture: null,
      worldReadable: false
    });
  });

  it('falls back to the d tag when the group has no name, null for non-39000', () => {
    expect(
      groupPreviewFromMetadata({ kind: 39000, tags: [['d', 'book'], ['private']] })
    ).toMatchObject({ name: 'book' });
    expect(groupPreviewFromMetadata(null)).toBeNull();
    expect(groupPreviewFromMetadata({ kind: 1, tags: [] })).toBeNull();
  });
});

describe('fetchGroupPreview', () => {
  it('resolves the shaped preview from the relay answer', async () => {
    const relayConn = { request: vi.fn(() => of(meta())) };
    await expect(fetchGroupPreview(relayConn, { id: 'book', relay: 'wss://x' })).resolves.toEqual({
      name: 'Lesekreis',
      picture: null,
      worldReadable: true
    });
    expect(relayConn.request).toHaveBeenCalledWith(
      { kinds: [39000], '#d': ['book'] },
      { timeout: 10000 }
    );
  });

  it('resolves null when the host answers nothing or errors', async () => {
    await expect(
      fetchGroupPreview({ request: () => EMPTY }, { id: 'book', relay: 'wss://x' })
    ).resolves.toBeNull();
    await expect(
      fetchGroupPreview(
        { request: () => { throw new Error('boom'); } },
        { id: 'book', relay: 'wss://x' }
      )
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/group-preview.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```javascript
// The paste path's "is that really the group you mean?" card: fetch the
// group's own 39000 from the host and shape it for display. No blind attach.
import { confirmGroupMetadata } from './group-management.js';
import { channelAccessLevel } from './channel-access.js';

/**
 * @param {{kind?: number, tags?: string[][]} | null | undefined} metadata
 * @returns {{name: string, picture: string | null, worldReadable: boolean} | null}
 */
export function groupPreviewFromMetadata(metadata) {
  if (!metadata || metadata.kind !== 39000 || !Array.isArray(metadata.tags)) return null;
  const tag = (/** @type {string} */ name) =>
    metadata.tags?.find((t) => t[0] === name && t[1]?.trim())?.[1]?.trim() ?? null;
  return {
    name: tag('name') ?? tag('d') ?? '',
    picture: tag('picture'),
    worldReadable: channelAccessLevel(metadata, undefined) === 'world'
  };
}

/**
 * @param {any} relayConn a pool.relay(url) connection
 * @param {{id: string, relay: string}} pointer
 */
export async function fetchGroupPreview(relayConn, pointer) {
  try {
    const metadata = await confirmGroupMetadata(relayConn, pointer.id);
    return groupPreviewFromMetadata(metadata);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/__tests__/group-preview.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/groups/group-preview.js src/lib/__tests__/group-preview.test.js
git commit -m "feat(groups): group preview for the attach paste path"
```

---

### Task 3: Rewrite AreaAttachModal — one picker, paste with preview, conditional access

**Files:**

- Modify: `src/lib/components/community/channels/AreaAttachModal.svelte` (full rewrite of the body; keep props contract `{communikeyEvent, onClose, onAttached}`)
- Modify: `messages/en.json`, `messages/de.json` (new keys below)
- Test: rewrite `src/lib/components/__tests__/AreaAttachModal.group-tab.test.svelte.js` → rename to `src/lib/components/__tests__/AreaAttachModal.test.svelte.js` (`git mv`)

**Interfaces:**

- Consumes: `groupAttachCandidates`, `parseGroupAddress`, `attachAccessQuestion` (Task 1); `fetchGroupPreview` (Task 2); `useMyGroups` from `$lib/groups/unlinked-groups.svelte.js`; `useChannelMetadata` from `$lib/groups/channel-metadata.svelte.js`; `useAttachableConcordAreas` from `$lib/concord/unlinked-areas.svelte.js`; `attachableAreaModes`, `attachGroupChannel` from `$lib/groups/community-attach.js`; `attachConcordArea` from `$lib/concord/attach.js`; `pool` from `$lib/stores/nostr-infrastructure.svelte`.
- Produces: same modal API as before; new testids `attach-candidate` (each row), `attach-paste-toggle`, `attach-paste-input`, `attach-paste-error`, `attach-preview`, `attach-access-members` / `attach-access-invited` (radio inputs), `attach-confirm`. Old testids `attach-tab-*`, `protocol-notice`, `group-attach-*`, `concord-attach-area/confirm` are DELETED.

- [ ] **Step 1: New i18n keys (en + de)**

Add to `messages/en.json` (adjacent to the existing `groups_attach_*` block) — and the German counterparts to `messages/de.json`:

```json
{
  "attach_modal_title": "Link a group",
  "attach_modal_lead": "Connect an existing group to this community. It will appear as a channel.",
  "attach_category_encrypted": "Encrypted group",
  "attach_category_closed": "Closed group",
  "attach_category_world": "Open to the world",
  "attach_empty": "You are not in any group that could be linked here yet.",
  "attach_paste_toggle": "Link a group from somewhere else",
  "attach_paste_placeholder": "Paste the group's address here",
  "attach_paste_unparseable": "That does not look like a group address.",
  "attach_paste_not_found": "No group was found at this address.",
  "attach_access_question": "Who should be able to read along?",
  "attach_action": "Link group"
}
```

German (`messages/de.json`):

```json
{
  "attach_modal_title": "Gruppe verknüpfen",
  "attach_modal_lead": "Verbinde eine bestehende Gruppe mit dieser Community. Sie erscheint dann als Kanal.",
  "attach_category_encrypted": "Verschlüsselte Gruppe",
  "attach_category_closed": "Geschlossene Gruppe",
  "attach_category_world": "Weltoffene Gruppe",
  "attach_empty": "Du bist noch in keiner Gruppe, die sich hier verknüpfen lässt.",
  "attach_paste_toggle": "Gruppe von woanders verknüpfen",
  "attach_paste_placeholder": "Adresse der Gruppe hier einfügen",
  "attach_paste_unparseable": "Das sieht nicht wie eine Gruppen-Adresse aus.",
  "attach_paste_not_found": "Unter dieser Adresse wurde keine Gruppe gefunden.",
  "attach_access_question": "Wer soll mitlesen können?",
  "attach_action": "Gruppe verknüpfen"
}
```

- [ ] **Step 2: Rewrite the component**

Replace the `<script>` logic and template of `AreaAttachModal.svelte` with the unified structure. The complete component:

```svelte
<script>
  // One picker for "link something that already exists" — spec
  // docs/superpowers/specs/2026-08-12-attach-modal-redesign-design.md.
  // Picking a row implies the protocol, so the tabs and the protocol notice
  // are gone. The XOR (one area kind per community) still comes from
  // attachableAreaModes; this component only decides what to OFFER.
  //
  // Imports concord submodules DIRECTLY (never the barrel) — the convention
  // every Concord component follows (see CLAUDE.md's Concord section).
  import { attachConcordArea } from '$lib/concord/attach.js';
  import { useAttachableConcordAreas } from '$lib/concord/unlinked-areas.svelte.js';
  import { attachableAreaModes, attachGroupChannel } from '$lib/groups/community-attach.js';
  import {
    groupAttachCandidates,
    parseGroupAddress,
    attachAccessQuestion
  } from '$lib/groups/attach-candidates.js';
  import { fetchGroupPreview } from '$lib/groups/group-preview.js';
  import { useMyGroups } from '$lib/groups/unlinked-groups.svelte.js';
  import { useChannelMetadata } from '$lib/groups/channel-metadata.svelte.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { manager } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    communikeyEvent,
    onClose,
    onAttached = /** @type {(() => void) | null} */ (null)
  } = $props();

  const modes = $derived(attachableAreaModes(communikeyEvent));

  // --- candidate list: everything the app already knows -------------------
  const getAreas = useAttachableConcordAreas(() => manager.active?.pubkey);
  const getMyGroups = useMyGroups();
  const getChannelMeta = useChannelMetadata(() => getMyGroups());

  /** @typedef {{kind: 'concord'|'group', key: string, name: string, category: string, worldReadable: boolean, disabled?: boolean, area?: any, pointer?: {id: string, relay: string}}} Candidate */
  const candidates = $derived.by(() => {
    /** @type {Candidate[]} */
    const rows = [];
    if (modes.concord) {
      for (const area of getAreas()) {
        rows.push({
          kind: 'concord',
          key: `concord:${area.communityId}`,
          name: area.name,
          category: m.attach_category_encrypted(),
          worldReadable: false,
          disabled: !!area.linkedToJoined,
          area
        });
      }
    }
    if (modes.group) {
      for (const row of groupAttachCandidates({
        groups: getMyGroups(),
        communikeyEvent,
        metadataByKey: getChannelMeta().byKey
      })) {
        rows.push({
          kind: 'group',
          key: `group:${row.key}`,
          name: row.name,
          category: row.worldReadable ? m.attach_category_world() : m.attach_category_closed(),
          worldReadable: row.worldReadable,
          pointer: row.pointer
        });
      }
    }
    return rows;
  });

  /** @type {string | null} */
  let selectedKey = $state(null);
  const selected = $derived(candidates.find((c) => c.key === selectedKey) ?? null);

  // --- paste fallback ------------------------------------------------------
  let showPaste = $state(false);
  let pasteInput = $state('');
  const pastePointer = $derived(parseGroupAddress(pasteInput));
  const pasteInvalid = $derived(pasteInput.trim().length > 0 && !pastePointer);
  /** @type {{name: string, picture: string|null, worldReadable: boolean} | null} */
  let preview = $state(null);
  let previewMissing = $state(false);
  let previewBusy = $state(false);

  // Fetch the preview whenever the parsed pointer changes. A stale response
  // must not overwrite a newer one — compare against the current pointer.
  $effect(() => {
    const pointer = pastePointer;
    preview = null;
    previewMissing = false;
    if (!pointer || !modes.group) return;
    previewBusy = true;
    fetchGroupPreview(pool.relay(pointer.relay), pointer).then((result) => {
      if (pastePointer !== pointer) return;
      preview = result;
      previewMissing = result === null;
      previewBusy = false;
    });
  });

  // --- the access question -------------------------------------------------
  /** The active attach target: a picked row or the previewed paste. */
  const target = $derived.by(() => {
    if (showPaste && pastePointer && preview) {
      return { kind: /** @type {const} */ ('group'), worldReadable: preview.worldReadable, pointer: pastePointer };
    }
    if (selected) {
      return { kind: selected.kind, worldReadable: selected.worldReadable, pointer: selected.pointer, area: selected.area };
    }
    return null;
  });
  const askAccess = $derived(
    !!target && attachAccessQuestion({ kind: target.kind, worldReadable: target.worldReadable })
  );
  /** @type {'members' | 'invited'} */
  let access = $state('invited');

  // --- dispatch ------------------------------------------------------------
  let busy = $state(false);
  const communitySigner = $derived.by(() => {
    const pk = communikeyEvent?.pubkey;
    if (!pk) return null;
    return manager.getAccountForPubkey(pk)?.signer ?? null;
  });

  async function attach() {
    if (!target || busy) return;
    busy = true;
    try {
      if (target.kind === 'concord') {
        await attachConcordArea({
          communikeyEvent,
          communityId: target.area.communityId,
          relay: target.area.relay,
          communitySigner
        });
        showToast(m.concord_attach_success({ name: target.area.name }), 'success');
      } else {
        const pointer = target.worldReadable
          ? { id: target.pointer.id, relay: target.pointer.relay }
          : { id: target.pointer.id, relay: target.pointer.relay, access };
        await attachGroupChannel({ communikeyEvent, pointer, communitySigner });
        showToast(m.groups_attach_success(), 'success');
      }
      onAttached?.();
      onClose();
    } catch (error) {
      console.error('attach failed', error);
      showToast(
        target.kind === 'concord' ? m.concord_attach_failed() : m.groups_attach_failed(),
        'error'
      );
    } finally {
      busy = false;
    }
  }
</script>

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="flex items-center gap-2 text-lg font-extrabold">
      🔗 {m.attach_modal_title()}
      <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
    </h3>
    <p class="mt-1 mb-4 text-sm text-base-content/60">{m.attach_modal_lead()}</p>

    {#if candidates.length === 0 && !showPaste}
      <p class="rounded-lg bg-base-200 p-3 text-sm text-base-content/70">{m.attach_empty()}</p>
    {:else if !showPaste}
      <div class="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {#each candidates as candidate (candidate.key)}
          <button
            class="flex items-center gap-3 rounded-xl border p-2 text-left transition-colors {selectedKey ===
            candidate.key
              ? 'border-primary bg-primary/10'
              : 'border-base-300'} {candidate.disabled
              ? 'cursor-default opacity-50'
              : 'hover:bg-base-200'}"
            data-testid="attach-candidate"
            disabled={candidate.disabled}
            onclick={() => (selectedKey = selectedKey === candidate.key ? null : candidate.key)}
          >
            {#if candidate.kind === 'concord'}
              <ConcordAreaBadge
                name={candidate.name}
                communityId={candidate.area.communityId}
                iconPointer={candidate.area.iconPointer}
                class="h-9 w-9"
              />
            {:else}
              <span
                class="flex h-9 w-9 items-center justify-center rounded-full bg-base-200 text-base"
              >
                {candidate.worldReadable ? '#🌐' : '#'}
              </span>
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">{candidate.name}</span>
              <span class="block text-xs text-base-content/60">
                {candidate.disabled ? m.concord_attach_already_linked() : candidate.category}
              </span>
            </span>
            {#if selectedKey === candidate.key}<span class="text-primary">✓</span>{/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if modes.group}
      {#if !showPaste}
        <button
          class="btn mt-3 self-start px-0 text-base-content/60 btn-link btn-sm"
          data-testid="attach-paste-toggle"
          onclick={() => {
            showPaste = true;
            selectedKey = null;
          }}
        >
          {m.attach_paste_toggle()} →
        </button>
      {:else}
        <input
          class="input-bordered input input-sm w-full {pasteInvalid ? 'input-error' : ''}"
          data-testid="attach-paste-input"
          placeholder={m.attach_paste_placeholder()}
          bind:value={pasteInput}
        />
        {#if pasteInvalid}
          <p class="mt-1 text-xs text-error" data-testid="attach-paste-error">
            {m.attach_paste_unparseable()}
          </p>
        {:else if previewMissing && !previewBusy}
          <p class="mt-1 text-xs text-error" data-testid="attach-paste-error">
            {m.attach_paste_not_found()}
          </p>
        {/if}
        {#if previewBusy}
          <p class="mt-2 text-xs text-base-content/60">
            <span class="loading loading-xs loading-spinner"></span>
          </p>
        {/if}
        {#if preview}
          <div
            class="mt-2 flex items-center gap-3 rounded-xl border border-base-300 p-2"
            data-testid="attach-preview"
          >
            {#if preview.picture}
              <img src={preview.picture} alt="" class="h-9 w-9 rounded-full object-cover" />
            {:else}
              <span
                class="flex h-9 w-9 items-center justify-center rounded-full bg-base-200 text-base"
              >
                {preview.worldReadable ? '#🌐' : '#'}
              </span>
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">{preview.name}</span>
              <span class="block text-xs text-base-content/60">
                {preview.worldReadable ? m.attach_category_world() : m.attach_category_closed()}
              </span>
            </span>
          </div>
        {/if}
      {/if}
    {/if}

    {#if askAccess}
      <fieldset class="mt-4">
        <legend class="mb-1 text-xs text-base-content/60">{m.attach_access_question()}</legend>
        <label class="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-base-200">
          <input
            type="radio"
            class="radio mt-0.5 radio-sm"
            name="attach-access"
            value="members"
            data-testid="attach-access-members"
            bind:group={access}
          />
          <span>
            <span class="block text-sm font-medium">{m.wizard_access_members()}</span>
            <span class="block text-xs text-base-content/60"
              >{m.wizard_access_members_hint_closed()}</span
            >
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-base-200">
          <input
            type="radio"
            class="radio mt-0.5 radio-sm"
            name="attach-access"
            value="invited"
            data-testid="attach-access-invited"
            bind:group={access}
          />
          <span>
            <span class="block text-sm font-medium">{m.wizard_access_invited()}</span>
            <span class="block text-xs text-base-content/60">{m.wizard_access_invited_hint()}</span>
          </span>
        </label>
      </fieldset>
    {/if}

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={onClose}>{m.concord_cancel()}</button>
      <button
        class="btn btn-neutral"
        data-testid="attach-confirm"
        disabled={!target || busy || !communitySigner}
        onclick={attach}
      >
        {#if busy}<span class="loading loading-xs loading-spinner"></span>{/if}
        {m.attach_action()}
      </button>
    </div>
  </div>
</div>
```

Implementation notes that bind:

- `access` defaults to `'invited'` and must NOT carry over to a world-readable target — the dispatch already drops it via `target.worldReadable`.
- The stale-response guard in the preview `$effect` compares `pastePointer !== pointer` by identity; `parseGroupAddress` returns a fresh object per call, so identity works as a change marker. Also set `previewBusy = false` in a `.catch`-safe way: `fetchGroupPreview` never rejects (Task 2), so the `.then` is sufficient.
- The `$effect` must READ its dependencies (`pastePointer`, `modes.group`) before any early return (Svelte 5 dead-effect trap — see the repo's memory note).

- [ ] **Step 3: Rewrite the component test**

`git mv src/lib/components/__tests__/AreaAttachModal.group-tab.test.svelte.js src/lib/components/__tests__/AreaAttachModal.test.svelte.js` and rewrite. Keep the existing mock scaffolding (manager, toast, `attachConcordArea`, partial mock of `community-attach.js`) and ADD mocks for the new hooks + preview:

```javascript
/** @vitest-environment jsdom */
/**
 * AreaAttachModal — one unified picker (spec 2026-08-12). The pure logic
 * (candidates, parsing, access-question rule) has its own unit tests; what
 * only this test can prove is the wiring: rows render with category
 * subtitles, the paste path previews before it attaches, the access
 * question appears only for private NIP-29 targets, and the confirm
 * dispatches the right attach call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64) },
  getAccountForPubkey: vi.fn(() => ({ signer: { sign: () => {} } }))
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

const attachConcordArea = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('$lib/concord/attach.js', () => ({ attachConcordArea }));

const concordAreas = vi.hoisted(() => ({ value: /** @type {any[]} */ ([]) }));
vi.mock('$lib/concord/unlinked-areas.svelte.js', () => ({
  useAttachableConcordAreas: () => () => concordAreas.value
}));

const myGroups = vi.hoisted(() => ({ value: /** @type {any[]} */ ([]) }));
vi.mock('$lib/groups/unlinked-groups.svelte.js', () => ({
  useMyGroups: () => () => myGroups.value
}));
const channelMeta = vi.hoisted(() => ({ value: /** @type {any} */ ({ byKey: {} }) }));
vi.mock('$lib/groups/channel-metadata.svelte.js', () => ({
  useChannelMetadata: () => () => channelMeta.value
}));

const previewResult = vi.hoisted(() => ({ value: /** @type {any} */ (null) }));
const fetchGroupPreview = vi.hoisted(() => vi.fn(async () => previewResult.value));
vi.mock('$lib/groups/group-preview.js', () => ({ fetchGroupPreview }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => ({})) }
}));

const attachGroupChannel = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('$lib/groups/community-attach.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual, attachGroupChannel };
});

import AreaAttachModal from '$lib/components/community/channels/AreaAttachModal.svelte';

/** A virgin 10222: both modes open. */
const virgin = { kind: 10222, pubkey: OWNER, tags: [] };
const PROPS = { communikeyEvent: virgin, onClose: vi.fn() };

const meta39000 = (/** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', 'book'], ['name', 'Lesekreis'], ...extra]
});

beforeEach(() => {
  vi.clearAllMocks();
  concordAreas.value = [];
  myGroups.value = [];
  channelMeta.value = { byKey: {} };
  previewResult.value = null;
});

describe('AreaAttachModal — unified picker', () => {
  it('renders one list mixing areas and groups with category subtitles, no tabs', () => {
    concordAreas.value = [
      { communityId: 'area-1', name: 'Team intern', relay: 'wss://c', linkedToJoined: false }
    ];
    myGroups.value = [{ id: 'book', relay: 'wss://g.example/' }];
    channelMeta.value = { byKey: { 'book@wss://g.example/': meta39000([['private']]) } };
    render(AreaAttachModal, { props: PROPS });
    const rows = screen.getAllByTestId('attach-candidate');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Encrypted group'),
      expect.stringContaining('Closed group')
    ]);
    expect(screen.queryByTestId('attach-tab-concord')).toBeNull();
    expect(screen.queryByTestId('protocol-notice')).toBeNull();
  });

  it('asks the access question only for a private NIP-29 selection', async () => {
    myGroups.value = [
      { id: 'book', relay: 'wss://g.example/' },
      { id: 'open', relay: 'wss://g.example/' }
    ];
    channelMeta.value = {
      byKey: {
        'book@wss://g.example/': meta39000([['private']]),
        'open@wss://g.example/': { kind: 39000, tags: [['d', 'open'], ['name', 'Offen']] }
      }
    };
    render(AreaAttachModal, { props: PROPS });
    const rows = screen.getAllByTestId('attach-candidate');
    // private group -> question with the wizard's radios
    await fireEvent.click(/** @type {Element} */ (rows.find((r) => r.textContent?.includes('Lesekreis'))));
    expect(screen.getByTestId('attach-access-invited')).toBeTruthy();
    expect(
      /** @type {HTMLInputElement} */ (screen.getByTestId('attach-access-invited')).checked
    ).toBe(true);
    // world-readable group -> no question
    await fireEvent.click(/** @type {Element} */ (rows.find((r) => r.textContent?.includes('Offen'))));
    expect(screen.queryByTestId('attach-access-invited')).toBeNull();
  });

  it('attaches a picked private group with the chosen access', async () => {
    myGroups.value = [{ id: 'book', relay: 'wss://g.example/' }];
    channelMeta.value = { byKey: { 'book@wss://g.example/': meta39000([['private']]) } };
    render(AreaAttachModal, { props: PROPS });
    await fireEvent.click(screen.getByTestId('attach-candidate'));
    await fireEvent.click(screen.getByTestId('attach-access-members'));
    await fireEvent.click(screen.getByTestId('attach-confirm'));
    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledOnce());
    expect(attachGroupChannel.mock.calls[0][0].pointer).toEqual({
      id: 'book',
      relay: 'wss://g.example/',
      access: 'members'
    });
  });

  it('paste path: previews before the confirm activates, then attaches without access for weltoffen', async () => {
    previewResult.value = { name: 'Lesekreis', picture: null, worldReadable: true };
    render(AreaAttachModal, { props: PROPS });
    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    const confirm = /** @type {HTMLButtonElement} */ (screen.getByTestId('attach-confirm'));
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(screen.getByTestId('attach-paste-input'), {
      target: { value: "https://g.example'book" }
    });
    await waitFor(() => expect(screen.getByTestId('attach-preview')).toBeTruthy());
    expect(confirm.disabled).toBe(false);
    await fireEvent.click(confirm);
    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledOnce());
    expect(attachGroupChannel.mock.calls[0][0].pointer).toEqual({
      id: 'book',
      relay: 'wss://g.example/'
    });
  });

  it('paste path: shows not-found when the host has no such group', async () => {
    previewResult.value = null;
    render(AreaAttachModal, { props: PROPS });
    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    await fireEvent.input(screen.getByTestId('attach-paste-input'), {
      target: { value: "g.example'nope" }
    });
    await waitFor(() =>
      expect(screen.getByTestId('attach-paste-error').textContent).toContain('No group was found')
    );
    expect(/** @type {HTMLButtonElement} */ (screen.getByTestId('attach-confirm')).disabled).toBe(
      true
    );
  });

  it('a community that already has group channels offers no concord rows', () => {
    concordAreas.value = [
      { communityId: 'area-1', name: 'Team intern', relay: 'wss://c', linkedToJoined: false }
    ];
    myGroups.value = [{ id: 'other', relay: 'wss://g.example/' }];
    const withGroups = {
      kind: 10222,
      pubkey: OWNER,
      tags: [['group', 'linked1', 'wss://g.example/']]
    };
    render(AreaAttachModal, { props: { ...PROPS, communikeyEvent: withGroups } });
    const rows = screen.getAllByTestId('attach-candidate');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Closed group')]);
  });

  it('shows the empty state when nothing is attachable', () => {
    render(AreaAttachModal, { props: PROPS });
    expect(screen.getByText(/not in any group/i)).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/components/__tests__/AreaAttachModal.test.svelte.js`
Expected: PASS. (Write the test first if you prefer strict TDD order — the component rewrite and its test land in one commit either way.)

Also run the neighbors that exercise the modal's callers:
`pnpm vitest run src/lib/components/__tests__ --silent 2>&1 | tail -5` — no new failures (pre-existing flaky inbox/DM files excepted, see memory).

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/components/community/channels/AreaAttachModal.svelte src/lib/components/__tests__/AreaAttachModal.test.svelte.js messages/en.json messages/de.json
git commit -m "feat(groups): unified attach picker with paste preview and conditional access"
```

---

### Task 4: Housekeeping — orphaned keys, full gates, live sanity

**Files:**

- Modify: `messages/en.json`, `messages/de.json` (delete orphans)

- [ ] **Step 1: Find and delete orphaned message keys**

For each of these candidate orphans, `grep -rn "m\.<key>(" src/` — delete from BOTH json files only the ones with zero remaining call sites:

`groups_attach_tab`, `concord_attach_tab`, `groups_protocol_notice`, `concord_protocol_notice`, `groups_attach_lead`, `concord_attach_lead`, `groups_attach_address_label`, `groups_attach_access_label`, `groups_attach_access_invited`, `groups_attach_access_members`, `groups_attach_access_hint`, `groups_attach_title`, `concord_attach_title`, `groups_attach_action`, `concord_attach_action`, `concord_attach_empty`, `concord_attach_own_only_hint`, `concord_attach_public_hint`.

Keys still referenced anywhere (e.g. `groups_attach_success/_failed`, `concord_attach_success/_failed`, `concord_attach_already_linked`, `groups_join_placeholder`, `groups_invalid_pointer`) STAY.

- [ ] **Step 2: Full gates**

Run: `pnpm vitest run src/lib/__tests__ && pnpm run check && npx eslint src/lib/groups/attach-candidates.js src/lib/groups/group-preview.js src/lib/components/community/channels/AreaAttachModal.svelte`
Expected: unit tests green, `0 ERRORS` from svelte-check, no lint errors.

- [ ] **Step 3: Live sanity (controller, not subagent)**

Against the running dev server (localhost:5173), with a throwaway account owning a 0xchat sandbox group: open the modal from community settings, confirm the picker lists the group with a category subtitle, paste `groups.0xchat.com'<id>` and confirm the preview card renders, attach, confirm the channel appears. (This mirrors the existing scripted E2E from the Stufe-B verification; reuse that script's login/attach scaffolding if convenient.)

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/de.json
git commit -m "chore(i18n): drop attach-modal keys orphaned by the picker redesign"
```
