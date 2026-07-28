# Concord Invite & Channel UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Concord direct-invite gap (invite by follows + npub), let users create open or private channels, and clear up the area-vs-channel/lock UX confusion.

**Architecture:** Pure client-side Svelte 5 UI work. Reuse the existing app-standard people-picker `ContactSearchInput` (follows search + npub paste) in the Concord invite sheet and create-wizard, both wired to the existing SDK call `grantChannelAccess(channelId, pubkey)`. Add a public/private toggle that flows into `createChannel(name, { private })`. No SDK, relay, or protocol changes.

**Tech Stack:** SvelteKit + Svelte 5 runes, DaisyUI/Tailwind, Paraglide i18n, Vitest + @testing-library/svelte (jsdom), `applesauce-concord` (via `src/lib/concord/` only).

## Global Constraints

- Concord code is accessed ONLY through `src/lib/concord/`; components import Concord submodules directly, never `applesauce-concord` directly, never the `src/lib/concord/index.js` barrel from a component. (This plan touches no `applesauce-concord` imports — the SDK calls used all already exist on the `community` object passed in as a prop.)
- All user-facing copy goes through Paraglide: add keys to BOTH `messages/de.json` and `messages/en.json`, then run `pnpm paraglide:compile`. German is the primary locale.
- Svelte 5 rules (see CLAUDE.md): `$state.raw()` for arrays that are replaced wholesale; plain `let` for subscriptions; `$derived` must be pure.
- Default channel visibility stays **private** (preserve current behaviour).
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit.
- Component tests live in `src/lib/components/__tests__/` with `/** @vitest-environment jsdom */`.
- Mock `ContactSearchInput` in tests via the existing fixture `src/lib/components/__tests__/fixtures/ContactSearchInputStub.svelte` (exposes `stub-select-a`, `stub-select-b`, `stub-raw-a` buttons and a `stub-exclude` div).

---

### Task 1: Paraglide messages (new keys + two renames)

**Files:**
- Modify: `messages/de.json`
- Modify: `messages/en.json`

**Interfaces:**
- Produces (message keys consumed by later tasks): `concord_invite_search_placeholder`, `concord_invite_direct_empty`, `concord_channel_visibility_label`, `concord_channel_visibility_public`, `concord_channel_visibility_public_hint`, `concord_channel_visibility_private`, `concord_channel_visibility_private_hint`, `concord_wizard_public_note`, `concord_legend_public`, `concord_legend_private`. Renamed values (keys unchanged): `concord_new_channel`, `concord_invites`.

- [ ] **Step 1: Add new keys + rename values in `messages/de.json`**

Change the two existing lines (2845-2846):
```json
  "concord_new_channel": "Neuer Kanal",
  "concord_invites": "Erhaltene Einladungen",
```
Add these keys (place them alongside the other `concord_*` keys, e.g. right after `concord_invites`):
```json
  "concord_invite_search_placeholder": "Name suchen oder npub einfügen…",
  "concord_invite_direct_empty": "Noch keine Mitglieder zum Direktwählen. Suche oben einen Kontakt, füge einen npub ein, oder teile den Einladungslink.",
  "concord_channel_visibility_label": "Sichtbarkeit",
  "concord_channel_visibility_public": "Offen",
  "concord_channel_visibility_public_hint": "Alle im Bereich können mitlesen.",
  "concord_channel_visibility_private": "Privat",
  "concord_channel_visibility_private_hint": "Nur ausgewählte Mitglieder.",
  "concord_wizard_public_note": "Offene Kanäle sind für alle Mitglieder des Bereichs sichtbar — der Zugang hängt an deiner Bereichs-Mitgliedschaft, nicht an einem separaten Kanal-Schlüssel.",
  "concord_legend_public": "# offen — alle im Bereich",
  "concord_legend_private": "🔒 privat — nur Ausgewählte",
```

- [ ] **Step 2: Mirror in `messages/en.json`**

Change the two existing lines (2845-2846):
```json
  "concord_new_channel": "New channel",
  "concord_invites": "Received invitations",
```
Add the matching keys:
```json
  "concord_invite_search_placeholder": "Search a name or paste an npub…",
  "concord_invite_direct_empty": "No members to pick yet. Search a contact above, paste an npub, or share the invite link.",
  "concord_channel_visibility_label": "Visibility",
  "concord_channel_visibility_public": "Open",
  "concord_channel_visibility_public_hint": "Everyone in the area can read it.",
  "concord_channel_visibility_private": "Private",
  "concord_channel_visibility_private_hint": "Only chosen members.",
  "concord_wizard_public_note": "Open channels are visible to all members of the area — access depends on your area membership, not a separate channel key.",
  "concord_legend_public": "# open — everyone in the area",
  "concord_legend_private": "🔒 private — only chosen members",
```

- [ ] **Step 3: Compile and verify keys resolve**

Run: `pnpm paraglide:compile`
Expected: completes with no error; regenerates `src/lib/paraglide/messages/`.

Run: `node -e "import('./src/lib/paraglide/messages.js').then(m => console.log(m.concord_new_channel(), '|', m.concord_legend_private(), '|', m.concord_invite_direct_empty()))"`
Expected: prints `Neuer Kanal | 🔒 privat — nur Ausgewählte | Noch keine Mitglieder…` (German is the base locale). If the ESM import path errors in your Node setup, instead just grep the generated dir: `ls src/lib/paraglide/messages/ | grep -E "concord_legend_private|concord_invite_direct_empty"` and expect both files present.

- [ ] **Step 4: Commit**

```bash
git add messages/de.json messages/en.json src/lib/paraglide
git commit -m "i18n(concord): add invite/channel UX strings; rename channel + inbox labels"
```

---

### Task 2: Direct-invite picker + empty-state in `ChannelInviteSheet`

**Files:**
- Modify: `src/lib/components/community/channels/ChannelInviteSheet.svelte` (the `{:else}` direct-tab block, currently lines ~199-217)
- Create: `src/lib/components/__tests__/ChannelInviteSheet.test.js`

**Interfaces:**
- Consumes: `ContactSearchInput` (`onselect: (c: {pubkey: string}) => void`, `onrawpubkey: (hex: string) => void`, `exclude: string[]`, `acceptPubkeyInput`, `bind:value`); existing local `directInvite(pubkey)` and `sent: string[]`; message keys from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `src/lib/components/__tests__/ChannelInviteSheet.test.js`:
```js
/** @vitest-environment jsdom */
/**
 * ChannelInviteSheet — direct-invite picker. The Direct tab must let you
 * invite anyone via the shared ContactSearchInput (follows search + npub
 * paste), each selection calling grantChannelAccess, and show a real
 * empty-state hint when there are no quick-pick members.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

const PK_A = 'a'.repeat(64);
const SELF = 'f'.repeat(64);

vi.mock('$lib/concord/client.svelte.js', () => ({
  getConcordClient: () => ({ invites: { forCommunity: () => [] } })
}));
// No community members → exercises the empty quick-list + empty-state hint.
vi.mock('$lib/helpers/contentTypes.js', () => ({
  getVerifiedMembers: () => ({ allMembers: [SELF], perSection: new Map() })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: { pubkey: SELF } } }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:,') } }));
vi.mock('$lib/concord/invite-helpers.js', () => ({
  pickLatestChannelInvite: () => undefined,
  createChannelInviteOnce: () => Promise.resolve({ url: 'http://x/invite/abc' })
}));
vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
// getContext('profileAccess') → a stub with the ProfileListAccess shape.
vi.mock('svelte', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getContext: () => ({ getMembers: () => [], isLoading: false }) };
});

import ChannelInviteSheet from '$lib/components/community/channels/ChannelInviteSheet.svelte';

const grantChannelAccess = vi.fn(() => Promise.resolve());
const community = { communityId: 'cid', grantChannelAccess };
const channel = { channel_id: 'chan1', name: 'ideen', private: true };

beforeEach(() => grantChannelAccess.mockClear());

async function openDirectTab() {
  render(ChannelInviteSheet, {
    props: { community, channel, communikeyEvent: { pubkey: SELF }, canDirect: true, onClose: () => {} }
  });
  await fireEvent.click(screen.getByRole('button', { name: /Direkt einladen|Direct/ }));
}

describe('ChannelInviteSheet direct tab', () => {
  it('invites a followed contact via the picker', async () => {
    await openDirectTab();
    await fireEvent.click(await screen.findByTestId('stub-select-a'));
    await waitFor(() => expect(grantChannelAccess).toHaveBeenCalledWith('chan1', PK_A));
  });

  it('invites a pasted npub via the picker', async () => {
    await openDirectTab();
    await fireEvent.click(await screen.findByTestId('stub-raw-a'));
    await waitFor(() => expect(grantChannelAccess).toHaveBeenCalledWith('chan1', PK_A));
  });

  it('shows the empty-state hint when there are no quick-pick members', async () => {
    await openDirectTab();
    expect(screen.getByText(/Noch keine Mitglieder|No members to pick/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:component -- src/lib/components/__tests__/ChannelInviteSheet.test.js`
Expected: FAIL — the stub picker buttons don't exist yet (Direct tab still renders only the member list + lead text).

- [ ] **Step 3: Add imports to `ChannelInviteSheet.svelte`**

In the `<script>` block, after the existing `getVerifiedMembers` import (line 35), add:
```js
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
```

- [ ] **Step 4: Replace the direct-tab body with picker + quick-list + empty-state**

Replace the current direct-tab block (the `{:else}` branch, lines ~199-217, from `<p ...concord_invite_direct_lead...>` through its closing `</div>`) with:
```svelte
      <p class="mb-3 text-sm text-base-content/60">{m.concord_invite_direct_lead()}</p>
      <ContactSearchInput
        acceptPubkeyInput
        placeholder={m.concord_invite_search_placeholder()}
        exclude={[...sent, manager.active?.pubkey].filter(Boolean)}
        onselect={(/** @type {{ pubkey: string }} */ c) => directInvite(c.pubkey)}
        onrawpubkey={(/** @type {string} */ hex) => directInvite(hex)}
      />
      {#if invitable.length > 0}
        <div class="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
          {#each invitable as pubkey (pubkey)}
            <div class="flex items-center gap-2 px-2 py-1">
              <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
              <span class="flex-1 truncate text-sm"
                >{getProfiles().get(pubkey)?.name ?? pubkey.slice(0, 12)}</span
              >
              {#if sent.includes(pubkey)}
                <span class="text-xs font-semibold text-success">✓ {m.concord_invited()}</span>
              {:else}
                <button class="btn btn-ghost btn-xs" onclick={() => directInvite(pubkey)}
                  >{m.concord_invite_action()}</button
                >
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="mt-3 alert text-sm">{m.concord_invite_direct_empty()}</div>
      {/if}
```
(`manager` and `ProfileAvatar` are already imported at the top of this file; `invitable`, `sent`, `getProfiles`, and `directInvite` already exist.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:component -- src/lib/components/__tests__/ChannelInviteSheet.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/community/channels/ChannelInviteSheet.svelte src/lib/components/__tests__/ChannelInviteSheet.test.js
git commit -m "feat(concord): direct-invite via follows/npub picker + empty-state"
```

---

### Task 3: Create-wizard — public/private toggle + picker + conditional key note

**Files:**
- Modify: `src/lib/components/community/channels/ChannelCreateWizard.svelte`
- Modify: `src/lib/components/__tests__/ChannelCreateWizard.test.js`

**Interfaces:**
- Consumes: `ContactSearchInput` (same props as Task 2); existing `selected: string[]`, `toggle(pubkey)`, `create()`; message keys from Task 1.
- Produces: passes `{ private: isPrivate }` to `target.createChannel(name, opts)`.

- [ ] **Step 1: Write the failing tests (append to `ChannelCreateWizard.test.js`)**

Add a new `describe` block at the end of the file. It reuses the existing mocks in that file (`foundConcordArea`, `getVerifiedMembers`, toast). Add a picker stub mock near the other `vi.mock` calls at the top of the file:
```js
vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
```
Then append:
```js
describe('ChannelCreateWizard visibility + picker', () => {
  const PK_A = 'a'.repeat(64);

  function makeCommunity() {
    return {
      createChannel: vi.fn(() => Promise.resolve('new-chan')),
      grantChannelAccess: vi.fn(() => Promise.resolve())
    };
  }

  it('creates a PRIVATE channel by default', async () => {
    const community = makeCommunity();
    render(ChannelCreateWizard, {
      props: { communikeyEvent: { pubkey: PUBKEY }, community, onClose: () => {}, onCreated: () => {} }
    });
    await walkToCreate();
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));
    await waitFor(() =>
      expect(community.createChannel).toHaveBeenCalledWith('Staff room', { private: true })
    );
  });

  it('creates an OPEN channel when public is chosen', async () => {
    const community = makeCommunity();
    render(ChannelCreateWizard, {
      props: { communikeyEvent: { pubkey: PUBKEY }, community, onClose: () => {}, onCreated: () => {} }
    });
    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });
    await fireEvent.click(screen.getByTestId('concord-visibility-public'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 1
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 2
    await fireEvent.click(screen.getByTestId('concord-wizard-ack-checkbox'));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));
    await waitFor(() =>
      expect(community.createChannel).toHaveBeenCalledWith('Staff room', { private: false })
    );
  });

  it('invites a pasted npub from step 2 via the picker', async () => {
    const community = makeCommunity();
    render(ChannelCreateWizard, {
      props: { communikeyEvent: { pubkey: PUBKEY }, community, onClose: () => {}, onCreated: () => {} }
    });
    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 1 (invite)
    await fireEvent.click(await screen.findByTestId('stub-raw-a'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 2
    await fireEvent.click(screen.getByTestId('concord-wizard-ack-checkbox'));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));
    await waitFor(() => expect(community.grantChannelAccess).toHaveBeenCalledWith('new-chan', PK_A));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:component -- src/lib/components/__tests__/ChannelCreateWizard.test.js`
Expected: FAIL — `concord-visibility-public` testid and the stub picker don't exist; default test may fail because `createChannel` is currently called with a hard-coded `{ private: true }` only when the name matches — verify the new tests specifically fail.

- [ ] **Step 3: Add state, import, and toggle-aware create in the `<script>`**

Add the import after line 13 (`ProfileAvatar` import):
```js
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
```
Add visibility state after `let name = $state('');` (line 26):
```js
  let isPrivate = $state(true);
```
Change the `createChannel` call (line 82) from:
```js
      const channelId = await target.createChannel(name.trim(), { private: true });
```
to:
```js
      const channelId = await target.createChannel(name.trim(), { private: isPrivate });
```

- [ ] **Step 4: Add the visibility toggle to step 0 (Grundlagen)**

Immediately after the name `<label>...</label>` block (ends line 147) and before the `<div class="alert ...invisible_hint...">` (line 148), insert:
```svelte
      <fieldset class="mb-3">
        <legend class="label-text mb-1 font-bold">{m.concord_channel_visibility_label()}</legend>
        <label class="flex cursor-pointer items-start gap-2 py-1 text-sm">
          <input type="radio" class="radio radio-sm mt-0.5" data-testid="concord-visibility-private"
            checked={isPrivate} onchange={() => (isPrivate = true)} />
          <span>🔒 <b>{m.concord_channel_visibility_private()}</b> — {m.concord_channel_visibility_private_hint()}</span>
        </label>
        <label class="flex cursor-pointer items-start gap-2 py-1 text-sm">
          <input type="radio" class="radio radio-sm mt-0.5" data-testid="concord-visibility-public"
            checked={!isPrivate} onchange={() => (isPrivate = false)} />
          <span># <b>{m.concord_channel_visibility_public()}</b> — {m.concord_channel_visibility_public_hint()}</span>
        </label>
      </fieldset>
```

- [ ] **Step 5: Swap step 1 member buttons for the picker + quick-list**

Replace the step-1 block (lines ~150-165, from `<p ...invite_lead...>` through the `<div class="mt-3 alert...link_hint...">`) with:
```svelte
      <p class="mb-3 text-sm text-base-content/70">{m.concord_wizard_invite_lead()}</p>
      <ContactSearchInput
        acceptPubkeyInput
        placeholder={m.concord_invite_search_placeholder()}
        exclude={selected}
        onselect={(/** @type {{ pubkey: string }} */ c) => toggle(c.pubkey)}
        onrawpubkey={(/** @type {string} */ hex) => toggle(hex)}
      />
      <div class="mt-2 flex max-h-52 flex-col gap-1 overflow-y-auto">
        {#each invitable as pubkey (pubkey)}
          <button
            class="btn justify-start gap-2 btn-ghost btn-sm {selected.includes(pubkey) ? 'btn-active' : ''}"
            onclick={() => toggle(pubkey)}
          >
            <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
            <span class="truncate">{getProfiles().get(pubkey)?.name ?? pubkey.slice(0, 12)}</span>
            <span class="ml-auto">{selected.includes(pubkey) ? '✓' : '+'}</span>
          </button>
        {/each}
      </div>
      <div class="mt-3 alert text-sm">{m.concord_wizard_link_hint()}</div>
```
(Note: the picker's `onrawpubkey`/`onselect` call `toggle(pubkey)`, which adds the pubkey to `selected`; the existing `create()` loop then grants each. Since `toggle` also removes on second call, selecting the same person twice is a no-op add/remove — acceptable.)

- [ ] **Step 6: Add the conditional public note to step 2 (Wichtig zu wissen)**

In the step-2 `{:else}` warning block, after the `<label>...ack...</label>` (line 179), before the block closes, insert a note shown only for public channels:
```svelte
      {#if !isPrivate}
        <p class="mt-3 text-xs text-base-content/60">{m.concord_wizard_public_note()}</p>
      {/if}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test:component -- src/lib/components/__tests__/ChannelCreateWizard.test.js`
Expected: PASS (existing tests + 3 new).

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/community/channels/ChannelCreateWizard.svelte src/lib/components/__tests__/ChannelCreateWizard.test.js
git commit -m "feat(concord): public/private channel toggle + follows/npub picker in create wizard"
```

---

### Task 4: Rail icon legend + per-row tooltips in `PrivateChannelsView`

**Files:**
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte`
- Modify: `src/lib/components/__tests__/PrivateChannelsView.test.js`

**Interfaces:**
- Consumes: message keys `concord_legend_public`, `concord_legend_private` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test (append to `PrivateChannelsView.test.js`)**

Append a test asserting the legend renders when channels are present. Match the file's existing render harness/mocks (reuse whatever `renderView`/props helper the file already defines; if it renders the rail with at least one channel, assert on the legend text):
```js
describe('PrivateChannelsView legend', () => {
  it('renders the # / 🔒 legend explaining channel visibility', async () => {
    // Use the file's existing helper that mounts the rail with channels.
    // (If the file exposes `renderWithChannels()`, call it; otherwise mirror
    // the existing successful-render test's setup.)
    await renderWithChannels();
    expect(screen.getByText(/alle im Bereich|everyone in the area/)).toBeTruthy();
    expect(screen.getByText(/nur Ausgewählte|only chosen members/)).toBeTruthy();
  });
});
```
If `PrivateChannelsView.test.js` has no reusable channel-rendering helper, add the assertion inside the existing "renders channels" test instead of a new block — do not duplicate the mount scaffolding.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:component -- src/lib/components/__tests__/PrivateChannelsView.test.js`
Expected: FAIL — legend text not present.

- [ ] **Step 3: Add the legend under the rail header**

In `PrivateChannelsView.svelte`, immediately after the header `<div class="flex items-center justify-between px-2 pt-2 pb-1">...</div>` (closes line 238) and before the `{#each channels}` loop (line 244), insert:
```svelte
      {#if channels.length > 0}
        <p class="px-2 pb-1 text-[0.65rem] leading-tight text-base-content/50">
          <span class="block">{m.concord_legend_public()}</span>
          <span class="block">{m.concord_legend_private()}</span>
        </p>
      {/if}
```

- [ ] **Step 4: Add a per-row tooltip on the icon**

On the channel-row icon span (line 256), add a `title`:
```svelte
          <span aria-hidden="true" title={channel.private ? m.concord_legend_private() : m.concord_legend_public()}
            >{channel.private ? '🔒' : '#'}</span
          >
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:component -- src/lib/components/__tests__/PrivateChannelsView.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/community/channels/PrivateChannelsView.svelte src/lib/components/__tests__/PrivateChannelsView.test.js
git commit -m "feat(concord): rail legend + icon tooltips clarifying # vs 🔒 channels"
```

---

### Task 5: Visible "Einladen" button in the channel header (`ChannelChat`)

**Files:**
- Modify: `src/lib/components/community/channels/ChannelChat.svelte` (header, around lines 259-265)
- Modify: `src/lib/components/__tests__/ChannelChat.test.js`

**Interfaces:**
- Consumes: existing `openOverlay(name)` prop, existing `dissolved` prop, existing message key `concord_menu_invite`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test (append to `ChannelChat.test.js`)**

Reuse the file's existing render helper/mocks. Add:
```js
describe('ChannelChat header invite button', () => {
  it('calls openOverlay("invite") from a visible header button', async () => {
    const openOverlay = vi.fn();
    // Mirror the file's existing successful-render setup, passing our spy:
    renderChat({ openOverlay, dissolved: false }); // adapt to the file's helper/props
    await fireEvent.click(screen.getByTestId('concord-header-invite'));
    expect(openOverlay).toHaveBeenCalledWith('invite');
  });
});
```
If `ChannelChat.test.js` lacks a reusable `renderChat` helper, mirror the mount + mocks of the nearest existing header test in that file rather than inventing new scaffolding.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:component -- src/lib/components/__tests__/ChannelChat.test.js`
Expected: FAIL — `concord-header-invite` testid not found.

- [ ] **Step 3: Add the header invite button**

In `ChannelChat.svelte`, immediately before the members button `<button ... data-testid="concord-members-button" ...>` (line 259), insert (shown only when the area is live):
```svelte
  {#if !dissolved}
    <button
      class="btn btn-ghost btn-sm"
      data-testid="concord-header-invite"
      onclick={() => openOverlay('invite')}
    >
      ✉ {m.concord_menu_invite()}
    </button>
  {/if}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:component -- src/lib/components/__tests__/ChannelChat.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/community/channels/ChannelChat.svelte src/lib/components/__tests__/ChannelChat.test.js
git commit -m "feat(concord): surface Einladen as a visible channel-header button"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check**

Run: `pnpm check`
Expected: no new errors in the five touched components. (Pre-existing unrelated warnings elsewhere are acceptable; nothing new from these files.)

- [ ] **Step 2: Run the full Concord/invite component suite**

Run: `pnpm test:component -- src/lib/components/__tests__/ChannelInviteSheet.test.js src/lib/components/__tests__/ChannelCreateWizard.test.js src/lib/components/__tests__/PrivateChannelsView.test.js src/lib/components/__tests__/ChannelChat.test.js`
Expected: all PASS.

- [ ] **Step 3: Manual smoke (dev server, Concord-enabled community)**

Drive the real flow (per the `verify` skill): open a community's Kanäle tab →
  1. `+ Neuer Kanal` → toggle shows; create an **Offen** channel → it appears with `#`; create a **Privat** one → `🔒`.
  2. Legend + icon tooltips render under the header.
  3. Channel header shows a visible **Einladen** button → opens the invite sheet.
  4. Invite sheet → **Direkt einladen** → search a follow AND paste an npub → both invite (toast / ✓); empty-state hint shows when no members.
  5. Sidebar button now reads **Erhaltene Einladungen**.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A && git commit -m "chore(concord): verification fixups for invite/channel UX"
```
(Skip if steps 1-3 needed no changes.)

---

## Self-Review

**Spec coverage:**
- Direct-invite picker (follows + npub) → Task 2 (sheet) + Task 3 (wizard step 2). ✓
- Empty-state fix → Task 2 step 4. ✓
- Public/private toggle + softened key note → Task 3. ✓
- Icon legend + tooltips → Task 4. ✓
- Relabel `+ Neuer privater Kanal` → Task 1 (`concord_new_channel`). ✓
- Rename received-invites inbox → Task 1 (`concord_invites`). ✓
- Surface `Einladen` in header → Task 5. ✓
- Tests + de/en strings → each task + Task 1. ✓
- Scope boundaries (no link/inbox/SDK/relay changes) → honoured; no task touches `createInvite`, `InviteInboxModal`, or `applesauce-concord`. ✓

**Type/name consistency:** `createChannel(name, { private })`, `grantChannelAccess(channelId, pubkey)`, `directInvite(pubkey)`, `toggle(pubkey)`, `isPrivate`, `selected`, `sent`, `invitable` are used identically across tasks and match the current source. Message keys are defined once in Task 1 and referenced verbatim later.

**Placeholder scan:** No TBD/TODO; every code step shows concrete code; test steps show real assertions. The two tests that adapt to an existing file's render helper (Task 4 step 1, Task 5 step 1) explicitly instruct mirroring the file's existing scaffolding rather than leaving a blank — acceptable because inventing a second mount harness would duplicate setup the file already owns.
