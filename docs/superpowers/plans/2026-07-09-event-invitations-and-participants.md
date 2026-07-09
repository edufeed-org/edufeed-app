# Event Invitations & Person Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Forgejo issue #14 — invite people to calendar events via NIP-17 DMs, and associate persons (speakers/organizers) with events via NIP-52 p-tags with roles.

**Architecture:** Two independent mechanisms per the approved spec (`docs/superpowers/specs/2026-07-09-event-invitations-and-participants-design.md`). (1) Invitations are private NIP-17 DMs containing a `nostr:naddr` link, sent per-recipient through the existing `SendWrappedMessage` applesauce action; the receiving DM thread *already* renders calendar naddrs as `CalendarEventPreview` cards — we only add `InlineRsvp` to that card. (2) Person association writes NIP-52 `["p", pubkey, relay, role]` tags from a new Participants section in the event form; display already works.

**Tech Stack:** SvelteKit + Svelte 5 runes, applesauce (actions/core/common), Vitest (+ @testing-library/svelte for jsdom component tests), Paraglide i18n, TailwindCSS/DaisyUI.

## Global Constraints

- Work in a **git worktree** off `dev` (not the main checkout). Copy `.env` from the main checkout into the worktree before running anything.
- Run all commands inside the nix dev shell (`direnv`/`nix develop`); package manager is `pnpm`.
- JavaScript with JSDoc annotations — no TypeScript syntax in source files.
- Svelte 5 runes: plain `let` for subscriptions/internal refs, `$state.raw()` for event arrays with Symbol metadata, `$derived` must be pure.
- i18n: every user-facing string is a Paraglide message with **both** `messages/en.json` and `messages/de.json` entries. Never put `@` directly before a `{param}` placeholder in a message value (breaks svelte-check).
- Roles are stored as stable English values (`speaker`, `organizer`, `moderator`, `participant`); only their display labels are localized. Custom roles stored/displayed as-is.
- Never use nostr-tools SimplePool; all relay communication via applesauce (already true for every API used here).
- Commit after each task; pre-push hook runs in the main checkout (run `pnpm install` there first if deps changed — they don't in this plan).

---

### Task 1: Participant p-tags in `buildCalendarEventTags`

**Files:**
- Modify: `src/lib/helpers/calendar.js` (function `buildCalendarEventTags`, ~line 796)
- Modify: `src/lib/types/calendar.js` (typedef `EventFormData`, ~line 80)
- Test: `src/lib/__tests__/calendar-tags.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildCalendarEventTags(formData, eventData, dTag, hTag)` now reads `formData.participants: Array<{pubkey: string, relay?: string, role?: string}> | undefined` and emits NIP-52 p-tags. Later tasks (2, 3) rely on exactly this `participants` shape on `formData` — it matches what `getCalendarEventMetadata` (`src/lib/helpers/eventUtils.js:50-57`) already parses, giving a lossless edit round-trip.

- [ ] **Step 1: Baseline — run the existing tag tests**

Run: `pnpm vitest run src/lib/__tests__/calendar-tags.test.js`
Expected: PASS (all existing tests green before changes).

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/__tests__/calendar-tags.test.js`, inside the top-level `describe('buildCalendarEventTags', ...)` block (the `findTags` helper already exists at the top of the file):

```javascript
  describe('participant p-tags (NIP-52)', () => {
    const formBase = { startDate: '2024-06-15', eventType: 'date', title: 'Test Event' };
    const eventBase = { kind: 31922, title: 'Test Event' };
    const PK_A = 'a'.repeat(64);
    const PK_B = 'b'.repeat(64);

    it('emits ["p", pubkey, relay, role] when all fields present', () => {
      const formData = {
        ...formBase,
        participants: [{ pubkey: PK_A, relay: 'wss://relay.example.com/', role: 'speaker' }]
      };
      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventBase),
        'd1'
      );
      expect(findTags(tags, 'p')).toEqual([['p', PK_A, 'wss://relay.example.com/', 'speaker']]);
    });

    it('emits empty relay placeholder when role present without relay', () => {
      const formData = { ...formBase, participants: [{ pubkey: PK_A, role: 'organizer' }] };
      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventBase),
        'd1'
      );
      expect(findTags(tags, 'p')).toEqual([['p', PK_A, '', 'organizer']]);
    });

    it('emits short tags when relay/role missing', () => {
      const formData = {
        ...formBase,
        participants: [{ pubkey: PK_A }, { pubkey: PK_B, relay: 'wss://r.example/' }]
      };
      const tags = buildCalendarEventTags(
        /** @type {any} */ (formData),
        /** @type {any} */ (eventBase),
        'd1'
      );
      expect(findTags(tags, 'p')).toEqual([
        ['p', PK_A],
        ['p', PK_B, 'wss://r.example/']
      ]);
    });

    it('skips entries without pubkey and emits nothing when participants absent', () => {
      const noPk = { ...formBase, participants: [{ role: 'speaker' }] };
      expect(
        findTags(
          buildCalendarEventTags(/** @type {any} */ (noPk), /** @type {any} */ (eventBase), 'd1'),
          'p'
        )
      ).toHaveLength(0);
      expect(
        findTags(
          buildCalendarEventTags(
            /** @type {any} */ (formBase),
            /** @type {any} */ (eventBase),
            'd1'
          ),
          'p'
        )
      ).toHaveLength(0);
    });

    it('round-trips through getCalendarEventMetadata', async () => {
      const { getCalendarEventMetadata } = await import('../helpers/eventUtils.js');
      const participants = [
        { pubkey: PK_A, relay: 'wss://relay.example.com/', role: 'speaker' },
        { pubkey: PK_B, relay: undefined, role: undefined }
      ];
      const tags = buildCalendarEventTags(
        /** @type {any} */ ({ ...formBase, participants }),
        /** @type {any} */ (eventBase),
        'd1'
      );
      const rawEvent = {
        id: 'e1',
        pubkey: 'c'.repeat(64),
        kind: 31922,
        content: '',
        created_at: 1718452800,
        tags
      };
      const parsed = getCalendarEventMetadata(/** @type {any} */ (rawEvent));
      expect(parsed.participants).toEqual(participants);
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/calendar-tags.test.js`
Expected: FAIL — the new `participant p-tags` tests fail (no `p` tags emitted); all pre-existing tests still pass.

- [ ] **Step 4: Implement p-tag emission**

In `src/lib/helpers/calendar.js`, inside `buildCalendarEventTags`, after the geohash block (`if (eventData.geohash) {...}`) and before `return tags;`:

```javascript
  // Participants (NIP-52): ["p", pubkey, relay hint, role]
  if (formData.participants) {
    for (const participant of formData.participants) {
      if (!participant?.pubkey) continue;
      if (participant.role) {
        tags.push(['p', participant.pubkey, participant.relay || '', participant.role]);
      } else if (participant.relay) {
        tags.push(['p', participant.pubkey, participant.relay]);
      } else {
        tags.push(['p', participant.pubkey]);
      }
    }
  }
```

In `src/lib/types/calendar.js`, add to the `EventFormData` typedef (with the other `@property` lines):

```javascript
 * @property {Array<{pubkey: string, relay?: string, role?: string}>} [participants] - NIP-52 participants (p-tags)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/calendar-tags.test.js`
Expected: PASS (all, including pre-existing).

- [ ] **Step 6: Commit**

```bash
git add src/lib/helpers/calendar.js src/lib/types/calendar.js src/lib/__tests__/calendar-tags.test.js
git commit -m "feat(calendar): emit NIP-52 participant p-tags in buildCalendarEventTags (#14)"
```

---

### Task 2: Pass participants through create/update publish path

**Files:**
- Modify: `src/lib/stores/calendar-actions.svelte.js` (`createEvent` ~line 102, `updateEvent` ~line 193)

**Interfaces:**
- Consumes: `formData.participants` (Task 1 shape). `buildCalendarEventTags` is already called with `formData` in both functions, so p-tags flow automatically — this task only wires the outbox model.
- Produces: participant pubkeys passed as `taggedPubkeys` to `publishEventOptimistic`/`publishEvent`, so the signed event is also published to each participant's NIP-65 read relays.

- [ ] **Step 1: Baseline — run calendar store tests**

Run: `pnpm vitest run src/lib/__tests__/calendar-update-event-communities.test.js src/lib/__tests__/calendar-tags.test.js`
Expected: PASS.

- [ ] **Step 2: Wire taggedPubkeys in `createEvent`**

In `src/lib/stores/calendar-actions.svelte.js`, `createEvent`, replace:

```javascript
        // Publish optimistically in background (returns immediately)
        publishEventOptimistic(calendarEvent, [], { communityEvent });
```

with:

```javascript
        // Publish optimistically in background (returns immediately).
        // Participants are tagged pubkeys: outbox model also targets their read relays.
        const participantPubkeys = (formData.participants || [])
          .map((/** @type {{pubkey: string}} */ p) => p.pubkey)
          .filter(Boolean);
        publishEventOptimistic(calendarEvent, participantPubkeys, { communityEvent });
```

- [ ] **Step 3: Wire taggedPubkeys in `updateEvent`**

In the same file, `updateEvent`, replace:

```javascript
        await publishEvent(updatedEvent, [], { communityEvent });
```

with:

```javascript
        const participantPubkeys = (formData.participants || [])
          .map((/** @type {{pubkey: string}} */ p) => p.pubkey)
          .filter(Boolean);
        await publishEvent(updatedEvent, participantPubkeys, { communityEvent });
```

- [ ] **Step 4: Verify no regressions**

Run: `pnpm vitest run src/lib/__tests__/calendar-update-event-communities.test.js src/lib/__tests__/calendar-tags.test.js && pnpm run check`
Expected: tests PASS; svelte-check reports no NEW errors (compare against `dev` baseline if unsure).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/calendar-actions.svelte.js
git commit -m "feat(calendar): publish events to participant read relays (outbox) (#14)"
```

---

### Task 3: ParticipantsEditor component + event form integration

**Files:**
- Create: `src/lib/components/calendar/ParticipantsEditor.svelte`
- Create: `src/lib/components/__tests__/fixtures/ContactSearchInputStub.svelte`
- Create: `src/lib/components/__tests__/fixtures/ParticipantsEditorHost.svelte`
- Test: `src/lib/components/__tests__/ParticipantsEditor.test.js`
- Modify: `src/lib/components/calendar/CalendarEventModal.svelte` (formData init ~line 65, resets ~lines 184/231, edit prefill ~line 262, template near the references input ~line 565)
- Modify: `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: `ContactSearchInput` props (`value` bindable, `onselect(contact: EnrichedContact)` — contact has `.pubkey`; `onrawpubkey(hex)`; `exclude: string[]`; `acceptPubkeyInput`), `getPrimaryWriteRelay(pubkey): Promise<string|undefined>` from `$lib/services/relay-service.svelte.js`, `useProfileMap` hook, `getDisplayName` from `applesauce-core/helpers`, Task 1's `participants` shape.
- Produces: `<ParticipantsEditor bind:participants disabled={bool} />` where `participants` is `Array<{pubkey, relay?, role?}>`. Exports nothing else.

- [ ] **Step 1: Add i18n messages**

Add to `messages/en.json` (keep alphabetical-ish placement near other `event_modal_*` keys):

```json
  "event_modal_participants_label": "Participants",
  "event_modal_participants_help": "People added here are publicly listed on the event (e.g. speakers, organizers).",
  "event_modal_participants_add_placeholder": "Search name or paste npub…",
  "event_modal_participants_remove": "Remove participant",
  "participant_role_participant": "Participant",
  "participant_role_speaker": "Speaker",
  "participant_role_organizer": "Organizer",
  "participant_role_moderator": "Moderator",
  "participant_role_custom": "Custom…",
  "participant_role_custom_placeholder": "Custom role"
```

Add to `messages/de.json`:

```json
  "event_modal_participants_label": "Mitwirkende",
  "event_modal_participants_help": "Hier hinzugefügte Personen werden öffentlich am Termin angezeigt (z. B. Vortragende, Organisation).",
  "event_modal_participants_add_placeholder": "Name suchen oder npub einfügen…",
  "event_modal_participants_remove": "Mitwirkende:n entfernen",
  "participant_role_participant": "Teilnehmer:in",
  "participant_role_speaker": "Vortragende:r",
  "participant_role_organizer": "Organisator:in",
  "participant_role_moderator": "Moderator:in",
  "participant_role_custom": "Eigene…",
  "participant_role_custom_placeholder": "Eigene Rolle"
```

- [ ] **Step 2: Write the stub + host fixtures**

`src/lib/components/__tests__/fixtures/ContactSearchInputStub.svelte`:

```svelte
<script>
  let { value = $bindable(''), onselect, onrawpubkey, exclude = [] } = $props();
  const PK_A = 'a'.repeat(64);
  const PK_B = 'b'.repeat(64);
</script>

<button data-testid="stub-select-a" onclick={() => onselect?.({ pubkey: PK_A })}>a</button>
<button data-testid="stub-select-b" onclick={() => onselect?.({ pubkey: PK_B })}>b</button>
<button data-testid="stub-raw-a" onclick={() => onrawpubkey?.(PK_A)}>raw a</button>
<div data-testid="stub-exclude">{exclude.join(',')}</div>
<div data-testid="stub-value">{value}</div>
```

`src/lib/components/__tests__/fixtures/ParticipantsEditorHost.svelte`:

```svelte
<script>
  import ParticipantsEditor from '$lib/components/calendar/ParticipantsEditor.svelte';
  let { initial = [] } = $props();
  let participants = $state(initial);
</script>

<ParticipantsEditor bind:participants />
<pre data-testid="participants-json">{JSON.stringify(participants)}</pre>
```

- [ ] **Step 3: Write the failing component test**

`src/lib/components/__tests__/ParticipantsEditor.test.js`:

```javascript
/**
 * ParticipantsEditor: add/remove NIP-52 participants with role selection.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPrimaryWriteRelay: vi.fn(async () => 'wss://relay.test/')
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

import Host from './fixtures/ParticipantsEditorHost.svelte';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

/** @param {HTMLElement} el @returns {any[]} */
const readParticipants = (el) => JSON.parse(el.textContent || '[]');

describe('ParticipantsEditor', () => {
  it('adds a selected contact with default role and relay hint', async () => {
    const { getByTestId } = render(Host);
    getByTestId('stub-select-a').click();
    // relay hint resolution is async
    await vi.waitFor(() => {
      const list = readParticipants(getByTestId('participants-json'));
      expect(list).toEqual([{ pubkey: PK_A, relay: 'wss://relay.test/', role: 'participant' }]);
    });
  });

  it('does not add the same pubkey twice and excludes added pubkeys from search', async () => {
    const { getByTestId } = render(Host);
    getByTestId('stub-select-a').click();
    await vi.waitFor(() =>
      expect(readParticipants(getByTestId('participants-json'))).toHaveLength(1)
    );
    getByTestId('stub-select-a').click();
    await tick();
    expect(readParticipants(getByTestId('participants-json'))).toHaveLength(1);
    expect(getByTestId('stub-exclude').textContent).toContain(PK_A);
  });

  it('uses the selected preset role for newly added participants', async () => {
    const { getByTestId, container } = render(Host);
    const select = /** @type {HTMLSelectElement} */ (
      container.querySelector('[data-testid="participant-role-select"]')
    );
    select.value = 'speaker';
    select.dispatchEvent(new Event('change'));
    await tick();
    getByTestId('stub-select-b').click();
    await vi.waitFor(() => {
      expect(readParticipants(getByTestId('participants-json'))[0].role).toBe('speaker');
    });
  });

  it('uses trimmed custom role text when custom is selected', async () => {
    const { getByTestId, container } = render(Host);
    const select = /** @type {HTMLSelectElement} */ (
      container.querySelector('[data-testid="participant-role-select"]')
    );
    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    await tick();
    const input = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="participant-role-custom"]')
    );
    input.value = '  Keynote  ';
    input.dispatchEvent(new Event('input'));
    await tick();
    getByTestId('stub-select-a').click();
    await vi.waitFor(() => {
      expect(readParticipants(getByTestId('participants-json'))[0].role).toBe('Keynote');
    });
  });

  it('removes a participant and prefills from initial value', async () => {
    const initial = [{ pubkey: PK_B, relay: 'wss://r.example/', role: 'organizer' }];
    const { getByTestId, container } = render(Host, { initial });
    expect(readParticipants(getByTestId('participants-json'))).toEqual(initial);
    const removeBtn = /** @type {HTMLButtonElement} */ (
      container.querySelector('[data-testid="participant-remove"]')
    );
    removeBtn.click();
    await tick();
    expect(readParticipants(getByTestId('participants-json'))).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/ParticipantsEditor.test.js`
Expected: FAIL — `ParticipantsEditor.svelte` does not exist.

- [ ] **Step 5: Implement `ParticipantsEditor.svelte`**

`src/lib/components/calendar/ParticipantsEditor.svelte`:

```svelte
<!--
  ParticipantsEditor - Add/remove NIP-52 participants ("p" tags) with roles.
  Bound value shape matches getCalendarEventMetadata().participants:
  Array<{pubkey: string, relay?: string, role?: string}>
-->

<script>
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import { getPrimaryWriteRelay } from '$lib/services/relay-service.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{participants?: Array<{pubkey: string, relay?: string, role?: string}>, disabled?: boolean}} */
  let { participants = $bindable([]), disabled = false } = $props();

  const ROLE_PRESETS = ['participant', 'speaker', 'organizer', 'moderator'];
  /** @type {Record<string, () => string>} */
  const roleLabels = {
    participant: m.participant_role_participant,
    speaker: m.participant_role_speaker,
    organizer: m.participant_role_organizer,
    moderator: m.participant_role_moderator
  };

  let searchValue = $state('');
  let selectedRole = $state('participant');
  let customRole = $state('');

  const getProfiles = useProfileMap(() => participants.map((p) => p.pubkey));
  let profiles = $derived(getProfiles());

  /** @param {string} role */
  function roleLabel(role) {
    return roleLabels[role] ? roleLabels[role]() : role;
  }

  /** @param {string} pubkey */
  async function addParticipant(pubkey) {
    if (!pubkey || participants.some((p) => p.pubkey === pubkey)) return;
    const role = selectedRole === 'custom' ? customRole.trim() : selectedRole;
    let relay;
    try {
      relay = (await getPrimaryWriteRelay(pubkey)) || undefined;
    } catch {
      relay = undefined;
    }
    participants = [...participants, { pubkey, relay, role: role || undefined }];
    searchValue = '';
  }

  /** @param {string} pubkey */
  function removeParticipant(pubkey) {
    participants = participants.filter((p) => p.pubkey !== pubkey);
  }
</script>

<div class="form-control">
  <label class="label" for="participants-editor-search">
    <span class="label-text">{m.event_modal_participants_label()}</span>
  </label>

  {#if participants.length > 0}
    <ul class="mb-2 space-y-1">
      {#each participants as participant (participant.pubkey)}
        <li class="flex items-center gap-2 rounded-lg bg-base-200 px-2 py-1">
          <ProfileAvatar pubkey={participant.pubkey} size="xs" />
          <span class="min-w-0 flex-1 truncate text-sm">
            {getDisplayName(profiles?.get(participant.pubkey)) ||
              participant.pubkey.slice(0, 12) + '…'}
          </span>
          {#if participant.role}
            <span class="badge badge-outline badge-sm">{roleLabel(participant.role)}</span>
          {/if}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            data-testid="participant-remove"
            aria-label={m.event_modal_participants_remove()}
            {disabled}
            onclick={() => removeParticipant(participant.pubkey)}
          >
            <CloseIcon class_="w-3 h-3" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="flex flex-wrap items-start gap-2">
    <div class="min-w-48 flex-1">
      <ContactSearchInput
        id="participants-editor-search"
        bind:value={searchValue}
        placeholder={m.event_modal_participants_add_placeholder()}
        {disabled}
        acceptPubkeyInput={true}
        exclude={participants.map((p) => p.pubkey)}
        onselect={(contact) => addParticipant(contact.pubkey)}
        onrawpubkey={(pubkey) => addParticipant(pubkey)}
      />
    </div>
    <select
      class="select-bordered select select-sm"
      data-testid="participant-role-select"
      bind:value={selectedRole}
      {disabled}
    >
      {#each ROLE_PRESETS as role (role)}
        <option value={role}>{roleLabel(role)}</option>
      {/each}
      <option value="custom">{m.participant_role_custom()}</option>
    </select>
    {#if selectedRole === 'custom'}
      <input
        type="text"
        class="input-bordered input input-sm w-36"
        data-testid="participant-role-custom"
        placeholder={m.participant_role_custom_placeholder()}
        bind:value={customRole}
        {disabled}
      />
    {/if}
  </div>

  <p class="mt-1 text-xs text-base-content/60">{m.event_modal_participants_help()}</p>
</div>
```

Note: check `ProfileAvatar.svelte`'s actual props before use (`grep -n "let {" src/lib/components/shared/ProfileAvatar.svelte`) — if it takes a `profile`/different prop instead of `pubkey`, adapt the call site (the test doesn't assert on the avatar).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/lib/components/__tests__/ParticipantsEditor.test.js`
Expected: PASS.

- [ ] **Step 7: Integrate into `CalendarEventModal`**

In `src/lib/components/calendar/CalendarEventModal.svelte`:

1. Import (with the other component imports):
```javascript
  import ParticipantsEditor from '$lib/components/calendar/ParticipantsEditor.svelte';
```
2. Add `participants: []` to the initial `formData` object (~line 65) **and both reset blocks** (~lines 184 and 231) — each gets the extra line:
```javascript
      participants: [],
```
3. In the edit-prefill function (~line 262, the `formData = { ... }` built from `existingEvent`), add:
```javascript
      participants: existingEvent.participants || [],
```
4. In the template, directly after the references input block (`</...>` following ~line 571), add:
```svelte
        <ParticipantsEditor bind:participants={formData.participants} disabled={isSubmitting} />
```

- [ ] **Step 8: Verify full flow**

Run: `pnpm vitest run src/lib/components/__tests__/ParticipantsEditor.test.js src/lib/__tests__/calendar-tags.test.js && pnpm run check && pnpm run lint`
Expected: PASS / no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/calendar/ParticipantsEditor.svelte \
  src/lib/components/calendar/CalendarEventModal.svelte \
  src/lib/components/__tests__/ParticipantsEditor.test.js \
  src/lib/components/__tests__/fixtures/ContactSearchInputStub.svelte \
  src/lib/components/__tests__/fixtures/ParticipantsEditorHost.svelte \
  messages/en.json messages/de.json
git commit -m "feat(calendar): participants section with roles in event form (#14)"
```

---

### Task 4: InlineRsvp in CalendarEventPreview

**Files:**
- Modify: `src/lib/components/shared/NostrPreviews/CalendarEventPreview.svelte`
- Create: `src/lib/components/shared/__tests__/fixtures/InlineRsvpStub.svelte`
- Test: `src/lib/components/shared/__tests__/CalendarEventPreview.test.js`

**Interfaces:**
- Consumes: `InlineRsvp` (`src/lib/components/calendar/InlineRsvp.svelte`) — props `calendarEvent` (**raw Nostr event**: `createRsvp` reads `calendarEvent.tags` for the d-tag), `size`, `compact`. `useActiveUser` from `$lib/stores/accounts.svelte`. The preview's `event.originalEvent` already holds the raw event.
- Produces: embedded calendar-event cards (DMs, chat, comments, threads) show RSVP buttons for logged-in users. No API changes.

- [ ] **Step 1: Write the stub fixture**

`src/lib/components/shared/__tests__/fixtures/InlineRsvpStub.svelte`:

```svelte
<script>
  let { calendarEvent } = $props();
</script>

<div data-testid="inline-rsvp-stub" data-event-id={calendarEvent?.id}></div>
```

- [ ] **Step 2: Write the failing component test**

`src/lib/components/shared/__tests__/CalendarEventPreview.test.js`:

```javascript
/**
 * CalendarEventPreview: embedded event card shows InlineRsvp for logged-in
 * users (block variant only) and hides it when logged out or inline.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const RAW_EVENT = {
  id: 'raw1',
  pubkey: 'c'.repeat(64),
  kind: 31923,
  content: 'desc',
  created_at: 1718452800,
  tags: [
    ['d', 'd1'],
    ['title', 'Test Event'],
    ['start', '1718452800']
  ]
};

// Login state toggled per test
let mockUser = /** @type {any} */ (null);

vi.mock('$lib/helpers/nostrUtils.js', async (importOriginal) => {
  const original = /** @type {any} */ (await importOriginal());
  return { ...original, fetchEventById: vi.fn(async () => RAW_EVENT) };
});
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockUser
}));
vi.mock(
  '$lib/components/calendar/InlineRsvp.svelte',
  () => import('./fixtures/InlineRsvpStub.svelte')
);

import CalendarEventPreview from '../NostrPreviews/CalendarEventPreview.svelte';

const PROPS = { identifier: 'naddr1test', decoded: { success: true }, inline: false };

describe('CalendarEventPreview RSVP', () => {
  beforeEach(() => {
    mockUser = null;
  });

  it('shows InlineRsvp with the raw event when logged in', async () => {
    mockUser = { pubkey: 'u'.repeat(64) };
    const { findByTestId } = render(CalendarEventPreview, PROPS);
    const stub = await findByTestId('inline-rsvp-stub');
    expect(stub.getAttribute('data-event-id')).toBe('raw1');
  });

  it('hides InlineRsvp when logged out', async () => {
    const { findByText, queryByTestId } = render(CalendarEventPreview, PROPS);
    await findByText('Test Event');
    expect(queryByTestId('inline-rsvp-stub')).toBeNull();
  });

  it('hides InlineRsvp in inline variant', async () => {
    mockUser = { pubkey: 'u'.repeat(64) };
    const { findByText, queryByTestId } = render(CalendarEventPreview, {
      ...PROPS,
      inline: true
    });
    await findByText('Test Event');
    expect(queryByTestId('inline-rsvp-stub')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/shared/__tests__/CalendarEventPreview.test.js`
Expected: FAIL — `inline-rsvp-stub` never rendered (first test); others may pass.

- [ ] **Step 4: Implement**

In `src/lib/components/shared/NostrPreviews/CalendarEventPreview.svelte`:

1. Add imports:
```javascript
  import InlineRsvp from '$lib/components/calendar/InlineRsvp.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
```
2. After the `let { identifier, decoded: _decoded, inline: _inline = false } = $props();` line:
```javascript
  const getActiveUser = useActiveUser();
  let activeUser = $derived(getActiveUser());
```
3. In the template, inside the `{:else if event}` branch, after the closing `</a>` of the card (and after the `<!-- eslint-enable ... -->` comment), add:
```svelte
  {#if !_inline && activeUser && event.originalEvent}
    <div class="mb-2 -mt-1 pl-1">
      <InlineRsvp calendarEvent={event.originalEvent} size="sm" compact={true} />
    </div>
  {/if}
```

Important: the RSVP block must be **outside** the `<a>` element — interactive buttons must not nest inside the card link.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/components/shared/__tests__/CalendarEventPreview.test.js src/lib/components/shared/__tests__/NostrContentRenderer.test.js`
Expected: PASS (both files — the second guards against regressions in the shared preview pipeline).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/shared/NostrPreviews/CalendarEventPreview.svelte \
  src/lib/components/shared/__tests__/CalendarEventPreview.test.js \
  src/lib/components/shared/__tests__/fixtures/InlineRsvpStub.svelte
git commit -m "feat(calendar): inline RSVP on embedded calendar event previews (#14)"
```

---

### Task 5: InviteToEventModal + Invite button

**Files:**
- Create: `src/lib/components/calendar/InviteToEventModal.svelte`
- Test: `src/lib/components/__tests__/InviteToEventModal.test.js`
- Modify: `src/lib/components/ModalManager.svelte` (import + branch, near the `shareByNaddr` entry ~line 326)
- Modify: `src/lib/components/calendar/CalendarEventDetailView.svelte` (RSVP card, ~line 425)
- Modify: `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: `modalStore` (`openModal(name, props)` / `closeModal()` / `modalProps`), `actionRunnerOptimistic.run(SendWrappedMessage, pubkeyHex, contentString)` (pattern from `MembershipApprovalsPanel.svelte:254`), `ensureDmRelayList()` from `$lib/services/dm-relay-backfill.js`, `encodeEventToNaddr(rawEvent)` from `$lib/helpers/nostrUtils.js` (relay hints auto-derived from seen relays), `ContactSearchInput` stub fixture from Task 3.
- Produces: modal registered as activeModal name `'inviteToEvent'`, opened with props `{ rawEvent }`.

- [ ] **Step 1: Add i18n messages**

`messages/en.json`:

```json
  "event_invite_button": "Invite",
  "invite_modal_title": "Invite to event",
  "invite_modal_recipients_label": "Recipients",
  "invite_modal_search_placeholder": "Search name or paste npub…",
  "invite_modal_note_label": "Personal message (optional)",
  "invite_modal_note_placeholder": "I'd love to see you there!",
  "invite_modal_send": "Send invitation",
  "invite_modal_sending": "Sending…",
  "invite_modal_sent_all": "Invitations sent!",
  "invite_modal_some_failed": "Some invitations could not be sent. You can retry the failed ones.",
  "invite_modal_retry_failed": "Retry failed",
  "invite_modal_privacy_hint": "Invitations are sent as private direct messages. Recipients using other Nostr apps see a text message with the event link."
```

`messages/de.json`:

```json
  "event_invite_button": "Einladen",
  "invite_modal_title": "Zum Termin einladen",
  "invite_modal_recipients_label": "Empfänger:innen",
  "invite_modal_search_placeholder": "Name suchen oder npub einfügen…",
  "invite_modal_note_label": "Persönliche Nachricht (optional)",
  "invite_modal_note_placeholder": "Ich würde mich freuen, dich dort zu sehen!",
  "invite_modal_send": "Einladung senden",
  "invite_modal_sending": "Wird gesendet…",
  "invite_modal_sent_all": "Einladungen verschickt!",
  "invite_modal_some_failed": "Einige Einladungen konnten nicht verschickt werden. Fehlgeschlagene kannst du erneut senden.",
  "invite_modal_retry_failed": "Fehlgeschlagene erneut senden",
  "invite_modal_privacy_hint": "Einladungen werden als private Direktnachricht verschickt. Empfänger:innen mit anderen Nostr-Apps sehen eine Textnachricht mit dem Termin-Link."
```

- [ ] **Step 2: Write the failing component test**

`src/lib/components/__tests__/InviteToEventModal.test.js`:

```javascript
/**
 * InviteToEventModal: per-recipient NIP-17 DM sending with naddr link,
 * failure tracking and retry.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

const RAW_EVENT = {
  id: 'raw1',
  pubkey: 'c'.repeat(64),
  kind: 31923,
  content: '',
  created_at: 1718452800,
  tags: [
    ['d', 'd1'],
    ['title', 'Test Event'],
    ['start', '1718452800']
  ]
};

const runMock = vi.fn(async () => {});

vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { modalProps: { rawEvent: RAW_EVENT }, closeModal: vi.fn(), openModal: vi.fn() }
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: { run: runMock }
}));
vi.mock('$lib/services/dm-relay-backfill.js', () => ({
  ensureDmRelayList: vi.fn(async () => {})
}));
vi.mock('$lib/helpers/nostrUtils.js', async (importOriginal) => {
  const original = /** @type {any} */ (await importOriginal());
  return { ...original, encodeEventToNaddr: vi.fn(() => 'naddr1testxyz') };
});
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

import { SendWrappedMessage } from 'applesauce-actions/actions';
import InviteToEventModal from '../calendar/InviteToEventModal.svelte';

/** @param {ReturnType<typeof render>} r @param {string} testId */
const click = (r, testId) => r.getByTestId(testId).click();

describe('InviteToEventModal', () => {
  beforeEach(() => {
    runMock.mockClear();
    runMock.mockImplementation(async () => {});
  });

  it('sends one DM per recipient with note and naddr link', async () => {
    const r = render(InviteToEventModal);
    click(r, 'stub-select-a');
    click(r, 'stub-select-b');
    await tick();
    const note = /** @type {HTMLTextAreaElement} */ (r.getByTestId('invite-note'));
    note.value = 'Come along!';
    note.dispatchEvent(new Event('input'));
    await tick();
    click(r, 'invite-send');
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledTimes(2));
    expect(runMock).toHaveBeenCalledWith(
      SendWrappedMessage,
      PK_A,
      'Come along!\n\nnostr:naddr1testxyz'
    );
    expect(runMock).toHaveBeenCalledWith(
      SendWrappedMessage,
      PK_B,
      'Come along!\n\nnostr:naddr1testxyz'
    );
  });

  it('sends only the link when the note is empty', async () => {
    const r = render(InviteToEventModal);
    click(r, 'stub-select-a');
    await tick();
    click(r, 'invite-send');
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
    expect(runMock).toHaveBeenCalledWith(SendWrappedMessage, PK_A, 'nostr:naddr1testxyz');
  });

  it('marks failed recipients and retries only those', async () => {
    runMock.mockImplementation(async (_action, pubkey) => {
      if (pubkey === PK_B) throw new Error('relay down');
    });
    const r = render(InviteToEventModal);
    click(r, 'stub-select-a');
    click(r, 'stub-select-b');
    await tick();
    click(r, 'invite-send');
    await vi.waitFor(() => expect(r.queryByTestId('invite-retry')).not.toBeNull());

    runMock.mockClear();
    runMock.mockImplementation(async () => {});
    click(r, 'invite-retry');
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
    expect(runMock).toHaveBeenCalledWith(SendWrappedMessage, PK_B, 'nostr:naddr1testxyz');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/InviteToEventModal.test.js`
Expected: FAIL — `InviteToEventModal.svelte` does not exist.

- [ ] **Step 4: Implement `InviteToEventModal.svelte`**

`src/lib/components/calendar/InviteToEventModal.svelte`:

```svelte
<!--
  InviteToEventModal - Invite people to a calendar event via private NIP-17 DMs.
  The invitation is an ordinary DM: optional personal note + nostr:naddr link.
  Opened via modalStore.openModal('inviteToEvent', { rawEvent }).
-->

<script>
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import { actionRunnerOptimistic } from '$lib/stores/action-runner.svelte.js';
  import { SendWrappedMessage } from 'applesauce-actions/actions';
  import { ensureDmRelayList } from '$lib/services/dm-relay-backfill.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  let { modalId = 'invite-to-event-modal' } = $props();

  /** @type {import('nostr-tools').NostrEvent | null} */
  let rawEvent = $derived(
    /** @type {any} */ (/** @type {any} */ (modalStore.modalProps)?.rawEvent) || null
  );

  /** @type {string[]} */
  let recipients = $state([]);
  let searchValue = $state('');
  let note = $state('');
  let isSending = $state(false);
  /** @type {Record<string, 'sent' | 'failed'>} */
  let sendStatus = $state({});
  let hasSent = $state(false);

  const getProfiles = useProfileMap(() => recipients);
  let profiles = $derived(getProfiles());

  let failedRecipients = $derived(recipients.filter((p) => sendStatus[p] === 'failed'));
  let allSent = $derived(
    hasSent && recipients.length > 0 && recipients.every((p) => sendStatus[p] === 'sent')
  );

  /** @param {string} pubkey */
  function addRecipient(pubkey) {
    if (pubkey && !recipients.includes(pubkey)) {
      recipients = [...recipients, pubkey];
    }
    searchValue = '';
  }

  /** @param {string} pubkey */
  function removeRecipient(pubkey) {
    recipients = recipients.filter((p) => p !== pubkey);
  }

  /** @returns {string} */
  function buildInviteContent() {
    if (!rawEvent) return '';
    const link = `nostr:${encodeEventToNaddr(rawEvent)}`;
    const trimmedNote = note.trim();
    return trimmedNote ? `${trimmedNote}\n\n${link}` : link;
  }

  /** @param {string[]} targets */
  async function sendTo(targets) {
    if (!rawEvent || targets.length === 0 || isSending) return;
    isSending = true;
    const content = buildInviteContent();
    try {
      await ensureDmRelayList();
    } catch (err) {
      console.warn('ensureDmRelayList failed, continuing with defaults', err);
    }
    for (const pubkey of targets) {
      try {
        await actionRunnerOptimistic.run(SendWrappedMessage, pubkey, content);
        sendStatus = { ...sendStatus, [pubkey]: 'sent' };
      } catch (err) {
        console.warn('Invite DM failed for', pubkey, err);
        sendStatus = { ...sendStatus, [pubkey]: 'failed' };
      }
    }
    isSending = false;
    hasSent = true;
  }

  function handleClose() {
    recipients = [];
    searchValue = '';
    note = '';
    sendStatus = {};
    hasSent = false;
    modalStore.closeModal();
  }
</script>

<div class="modal-open modal" role="dialog" id={modalId}>
  <div class="modal-box max-w-lg">
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg font-bold">{m.invite_modal_title()}</h3>
      <button class="btn btn-ghost btn-sm" onclick={handleClose} aria-label="Close">
        <CloseIcon class_="w-4 h-4" />
      </button>
    </div>

    <div class="form-control mb-3">
      <label class="label" for="invite-recipient-search">
        <span class="label-text">{m.invite_modal_recipients_label()}</span>
      </label>

      {#if recipients.length > 0}
        <ul class="mb-2 space-y-1">
          {#each recipients as pubkey (pubkey)}
            <li class="flex items-center gap-2 rounded-lg bg-base-200 px-2 py-1">
              <ProfileAvatar {pubkey} size="xs" />
              <span class="min-w-0 flex-1 truncate text-sm">
                {getDisplayName(profiles?.get(pubkey)) || pubkey.slice(0, 12) + '…'}
              </span>
              {#if sendStatus[pubkey] === 'sent'}
                <span class="badge badge-sm badge-success">✓</span>
              {:else if sendStatus[pubkey] === 'failed'}
                <span class="badge badge-sm badge-error">✕</span>
              {/if}
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                disabled={isSending}
                onclick={() => removeRecipient(pubkey)}
              >
                <CloseIcon class_="w-3 h-3" />
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <ContactSearchInput
        id="invite-recipient-search"
        bind:value={searchValue}
        placeholder={m.invite_modal_search_placeholder()}
        disabled={isSending}
        acceptPubkeyInput={true}
        exclude={recipients}
        onselect={(contact) => addRecipient(contact.pubkey)}
        onrawpubkey={(pubkey) => addRecipient(pubkey)}
      />
    </div>

    <div class="form-control mb-3">
      <label class="label" for="invite-note">
        <span class="label-text">{m.invite_modal_note_label()}</span>
      </label>
      <textarea
        id="invite-note"
        data-testid="invite-note"
        class="textarea-bordered textarea w-full"
        rows="2"
        placeholder={m.invite_modal_note_placeholder()}
        bind:value={note}
        disabled={isSending}
      ></textarea>
    </div>

    <p class="mb-4 text-xs text-base-content/60">{m.invite_modal_privacy_hint()}</p>

    {#if allSent}
      <div class="alert alert-success text-sm">{m.invite_modal_sent_all()}</div>
    {:else if hasSent && failedRecipients.length > 0}
      <div class="alert alert-warning text-sm">{m.invite_modal_some_failed()}</div>
    {/if}

    <div class="modal-action">
      {#if hasSent && failedRecipients.length > 0}
        <button
          class="btn btn-warning"
          data-testid="invite-retry"
          disabled={isSending}
          onclick={() => sendTo(failedRecipients)}
        >
          {m.invite_modal_retry_failed()}
        </button>
      {/if}
      {#if !allSent}
        <button
          class="btn btn-primary"
          data-testid="invite-send"
          disabled={isSending || recipients.length === 0 || !rawEvent}
          onclick={() => sendTo(recipients)}
        >
          {isSending ? m.invite_modal_sending() : m.invite_modal_send()}
        </button>
      {/if}
    </div>
  </div>
  <button class="modal-backdrop" onclick={handleClose} aria-label="Close"></button>
</div>
```

Before finishing, compare the modal scaffold (`modal-open modal`, `modal-box`, backdrop) with `ShareByNaddrModal.svelte`'s template and match its structure if it differs — modals in this app must look consistent.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/components/__tests__/InviteToEventModal.test.js`
Expected: PASS.

- [ ] **Step 6: Register in ModalManager and add the Invite button**

In `src/lib/components/ModalManager.svelte`:
1. Import with the other modal imports:
```javascript
  import InviteToEventModal from '$lib/components/calendar/InviteToEventModal.svelte';
```
2. Add a branch next to the `shareByNaddr` entry (~line 326):
```svelte
{:else if modal.activeModal === 'inviteToEvent'}
  <InviteToEventModal />
```

In `src/lib/components/calendar/CalendarEventDetailView.svelte`, in the RSVP card (~line 428), change the title row to include the button (the `UserIcon`, `modalStore`, `activeUser`, and `rawEvent` are already available in this component):

```svelte
      <div class="flex items-center justify-between">
        <h2 class="card-title text-2xl">
          <UserIcon class_="w-6 h-6" />
          {m.calendar_detail_rsvp_title()}
        </h2>
        {#if activeUser && rawEvent}
          <button
            class="btn btn-sm btn-outline"
            onclick={() => modalStore.openModal('inviteToEvent', { rawEvent })}
          >
            {m.event_invite_button()}
          </button>
        {/if}
      </div>
```

(Verify `modalStore` is imported in `CalendarEventDetailView.svelte` — it is used by `handleEdit`, so it already is.)

- [ ] **Step 7: Full verification**

Run: `pnpm vitest run src/lib/components/__tests__/InviteToEventModal.test.js && pnpm run check && pnpm run lint`
Expected: PASS / no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/calendar/InviteToEventModal.svelte \
  src/lib/components/__tests__/InviteToEventModal.test.js \
  src/lib/components/ModalManager.svelte \
  src/lib/components/calendar/CalendarEventDetailView.svelte \
  messages/en.json messages/de.json
git commit -m "feat(calendar): invite people to events via NIP-17 DMs (#14)"
```

---

### Task 6: Final verification

**Files:** none new.

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS. Known caveat: inbox/DM test files are flaky under the full parallel run (documented project issue) — if only those known-flaky files fail, re-run them in isolation to confirm they pass: `pnpm vitest run <failing-file>`.

- [ ] **Step 2: Type check and lint**

Run: `pnpm run check && pnpm run lint`
Expected: no new errors versus `dev`.

- [ ] **Step 3: Manual end-to-end verification (verify skill)**

Start the dev server (`pnpm run dev`) and drive the real flows:
1. Create an event with two participants (one `speaker`, one custom role) → open the event page → participants render with role badges → inspect the published event's tags (browser devtools/relay) → `["p", <pk>, <relay>, "speaker"]` present.
2. Edit that event → participants prefilled → remove one → save → event updated correctly.
3. On the event page, click **Invite** → pick a test account → send → log in as the test account → the DM shows the event card with RSVP buttons → RSVP `accepted` → the RSVP appears on the event page attendee list.
4. Paste an event naddr into any DM manually → same card + RSVP renders (the generalized path).

- [ ] **Step 4: Merge/PR decision**

Follow superpowers:finishing-a-development-branch — present merge/PR options to the user. Reference issue #14 (Forgejo: `https://git.edufeed.org/edufeed/edufeed-app/issues/14`) in the PR body.
