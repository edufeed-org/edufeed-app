# Concord Channel-Delete + Dissolve Recovery/Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-channel delete, an in-place recovery path out of a dissolved area, and a typed confirmation on the destructive dissolve action.

**Architecture:** Client-side Svelte 5 UI only, wiring existing SDK methods (`community.deleteChannel`, the wizard's found-fresh path). No SDK/relay/protocol changes.

**Tech Stack:** SvelteKit + Svelte 5 runes, DaisyUI/Tailwind, Paraglide i18n, Vitest + @testing-library/svelte (jsdom), `applesauce-concord` via `src/lib/concord/` only.

## Global Constraints

- Concord components import Concord submodules directly (never `applesauce-concord`, never the `src/lib/concord/index.js` barrel). This plan adds no new Concord import — `deleteChannel` is a method on the `community` object already in scope.
- All copy via Paraglide in BOTH `messages/de.json` and `messages/en.json`; run `pnpm paraglide:compile` after editing. German is the base locale.
- Default behavior preserved: dissolve stays owner-only; delete is owner-only and hidden for the last remaining channel.
- Focused test runner in this repo: `npx vitest run --environment jsdom <file>` (the `pnpm test:component -- <file>` filter does NOT work here).
- TDD: failing test first, watch it fail, implement, watch it pass, commit.

---

### Task 1: Paraglide messages

**Files:** Modify `messages/de.json`, `messages/en.json`

**Interfaces — Produces (keys consumed later):** `concord_menu_delete_channel`, `concord_delete_channel_title`, `concord_delete_channel_body`, `concord_delete_channel_action`, `concord_channel_deleted`, `concord_channel_delete_failed`, `concord_dissolved_recover`, `concord_dissolve_confirm_label`, `concord_dissolve_confirm_placeholder`, `concord_dissolve_confirm_fallback`.

- [ ] **Step 1: Add keys to `messages/de.json`** (alongside the other `concord_*` keys):
```json
  "concord_menu_delete_channel": "Kanal löschen",
  "concord_delete_channel_title": "Kanal löschen?",
  "concord_delete_channel_body": "„{name}“ und der gesamte Verlauf werden für alle Mitglieder entfernt. Das lässt sich nicht rückgängig machen.",
  "concord_delete_channel_action": "Kanal löschen",
  "concord_channel_deleted": "Kanal gelöscht.",
  "concord_channel_delete_failed": "Kanal konnte nicht gelöscht werden.",
  "concord_dissolved_recover": "Neuen Bereich gründen",
  "concord_dissolve_confirm_label": "Tippe zur Bestätigung den Namen des Bereichs: {name}",
  "concord_dissolve_confirm_placeholder": "Name des Bereichs",
  "concord_dissolve_confirm_fallback": "AUFLÖSEN",
```

- [ ] **Step 2: Add matching keys to `messages/en.json`:**
```json
  "concord_menu_delete_channel": "Delete channel",
  "concord_delete_channel_title": "Delete channel?",
  "concord_delete_channel_body": "\"{name}\" and its full history will be removed for all members. This can't be undone.",
  "concord_delete_channel_action": "Delete channel",
  "concord_channel_deleted": "Channel deleted.",
  "concord_channel_delete_failed": "Couldn't delete the channel.",
  "concord_dissolved_recover": "Start a new area",
  "concord_dissolve_confirm_label": "Type the area name to confirm: {name}",
  "concord_dissolve_confirm_placeholder": "Area name",
  "concord_dissolve_confirm_fallback": "DISSOLVE",
```

- [ ] **Step 3: Compile & verify.** Run `pnpm paraglide:compile` (must succeed). Then `ls src/lib/paraglide/messages/ | grep -E "concord_delete_channel_body|concord_dissolve_confirm_label|concord_dissolved_recover"` → all three present.

- [ ] **Step 4: Commit.**
```bash
git add messages/de.json messages/en.json src/lib/paraglide
git commit -m "i18n(concord): channel-delete + dissolve-recovery/confirm strings"
```

---

### Task 2: ChannelChat — delete menu item, banner recover button, `channelCount` prop

**Files:** Modify `src/lib/components/community/channels/ChannelChat.svelte`; Modify `src/lib/components/__tests__/ChannelChat.test.js`

**Interfaces:**
- Consumes: `openOverlay(name)` prop, `isOwner`, `dissolved`, message keys from Task 1.
- Produces: new prop `channelCount` (number, default 1). Menu item → `openOverlay('delete-channel')`; banner button → `openOverlay('create')`.

- [ ] **Step 1: Write failing tests (append to `ChannelChat.test.js`).** Reuse the file's existing render pattern (the reaction-parity block's `render` + `makeCommunity([])` + `CHANNEL`; pass extra props). Add:
```js
describe('ChannelChat delete + dissolved recovery', () => {
  it('shows "Kanal löschen" and calls openOverlay(delete-channel) when owner, live, >1 channel', async () => {
    const openOverlay = vi.fn();
    renderChat({ openOverlay, isOwner: true, dissolved: false, channelCount: 2 }); // adapt to the file's render helper/props
    await fireEvent.click(screen.getByTestId('concord-chat-menu'));
    await fireEvent.click(screen.getByRole('button', { name: /Kanal löschen|Delete channel/ }));
    expect(openOverlay).toHaveBeenCalledWith('delete-channel');
  });

  it('hides "Kanal löschen" for the last remaining channel', async () => {
    renderChat({ openOverlay: vi.fn(), isOwner: true, dissolved: false, channelCount: 1 });
    await fireEvent.click(screen.getByTestId('concord-chat-menu'));
    expect(screen.queryByRole('button', { name: /Kanal löschen|Delete channel/ })).toBeNull();
  });

  it('shows the dissolved recover button (owner) and calls openOverlay(create)', async () => {
    const openOverlay = vi.fn();
    renderChat({ openOverlay, isOwner: true, dissolved: true, channelCount: 1 });
    await fireEvent.click(screen.getByRole('button', { name: /Neuen Bereich gründen|Start a new area/ }));
    expect(openOverlay).toHaveBeenCalledWith('create');
  });

  it('hides the recover button for non-owners', () => {
    renderChat({ openOverlay: vi.fn(), isOwner: false, dissolved: true, channelCount: 1 });
    expect(screen.queryByRole('button', { name: /Neuen Bereich gründen|Start a new area/ })).toBeNull();
  });
});
```
If `ChannelChat.test.js` has no reusable `renderChat`, mirror the nearest existing header test's `render(...)` call with these props instead of inventing new scaffolding.

- [ ] **Step 2: Run to verify fail.** `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelChat.test.js` → new tests FAIL (`channelCount` unknown / testids absent).

- [ ] **Step 3: Add `channelCount` prop.** In `ChannelChat.svelte` line 36, add `channelCount = 1` to the `$props()` destructure:
```js
  let { community, channel, dissolved = false, isOwner = false, channelCount = 1, openOverlay, onBack } = $props();
```

- [ ] **Step 4: Add the delete menu item.** In the `⋯` dropdown `<ul>`, immediately before the existing dissolve block `{#if isOwner && !dissolved}` (line 324), insert:
```svelte
        {#if isOwner && !dissolved && channelCount > 1}
          <li>
            <button
              class="text-error"
              data-testid="concord-menu-delete-channel"
              onclick={() => {
                menuOpen = false;
                openOverlay('delete-channel');
              }}>{m.concord_menu_delete_channel()}</button
            >
          </li>
        {/if}
```

- [ ] **Step 5: Add the recover button to the dissolved banner.** Replace the dissolved banner block (lines 340-343) with:
```svelte
{#if dissolved}
  <div
    class="flex items-center gap-3 border-b border-base-300 bg-base-200 px-4 py-2 text-sm text-base-content/70"
  >
    <span class="flex-1">{m.concord_dissolved_banner()}</span>
    {#if isOwner}
      <button
        class="btn btn-xs btn-neutral"
        data-testid="concord-dissolved-recover"
        onclick={() => openOverlay('create')}>{m.concord_dissolved_recover()}</button
      >
    {/if}
  </div>
{:else if showKeyBar}
```
(Leave the `{:else if showKeyBar}` block and the rest unchanged.)

- [ ] **Step 6: Run to verify pass.** `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelChat.test.js` → all pass.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/components/community/channels/ChannelChat.svelte src/lib/components/__tests__/ChannelChat.test.js
git commit -m "feat(concord): channel-delete menu item + dissolved recover button"
```

---

### Task 3: PrivateChannelsView — delete modal, dissolve typed-confirm, create force-found, pass channelCount

**Files:** Modify `src/lib/components/community/channels/PrivateChannelsView.svelte`; Create `src/lib/components/__tests__/PrivateChannelsView.management.test.svelte.js`

**Interfaces:**
- Consumes: `concord.community.deleteChannel(channelId)`, `selectConcordChannel`, `channels`, `activeChannel`, `communityProfile`, message keys from Task 1; ChannelChat's `channelCount` prop and its `openOverlay('delete-channel'|'create')`.
- Produces: nothing downstream.

- [ ] **Step 1: Write failing tests.** Create `PrivateChannelsView.management.test.svelte.js`. Reuse the mock block from `PrivateChannelsView.shared-selection.test.svelte.js` (accounts, config, toast, notifications, `useConcordArea` via a mutable `concordFixture`). Stub the two children so overlays can be driven directly and the wizard's `community` prop captured:
```js
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const CH1 = { channel_id: 'c1', name: 'alpha', private: false, accessible: true };
const CH2 = { channel_id: 'c2', name: 'beta', private: true, accessible: true };

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: OWNER })
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: { concord: { enabled: true, relays: [] } } }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toastSpy }));
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  channelUnreadState: () => ({ unread: false, mentioned: false }),
  markChannelRead: vi.fn(),
  getToastsEnabled: () => false,
  setToastsEnabled: vi.fn()
}));
const selectSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/concord/active-channel.svelte.js', () => ({
  setActiveConcordChannel: vi.fn(),
  clearActiveConcordChannel: vi.fn(),
  selectConcordChannel: selectSpy,
  getSelectedConcordChannel: () => 'c2' // active = CH2 (beta)
}));
const deleteChannel = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const concordFixture = vi.hoisted(() => ({ value: null }));
vi.mock('$lib/concord/community.svelte.js', () => ({ useConcordArea: () => () => concordFixture.value }));
// Stub ChannelChat: expose buttons to invoke openOverlay, and echo the props we assert on.
vi.mock('$lib/components/community/channels/ChannelChat.svelte', () => ({
  default: (await import('./fixtures/ChannelChatStub.svelte')).default
}));
// Stub the wizard to capture the `community` prop it receives.
const wizardCommunity = vi.hoisted(() => ({ value: 'UNSET' }));
vi.mock('$lib/components/community/channels/ChannelCreateWizard.svelte', () => ({
  default: (await import('./fixtures/ChannelCreateWizardStub.svelte')).default
}));

import PrivateChannelsView from '$lib/components/community/channels/PrivateChannelsView.svelte';

function base(overrides = {}) {
  return {
    enabled: true, phase: 'ready', community: { material: { owner: OWNER }, deleteChannel },
    communityId: 'cid', channels: [CH1, CH2], dissolved: false, signerHasNip44: true, ...overrides
  };
}
beforeEach(() => { toastSpy.mockClear(); selectSpy.mockClear(); deleteChannel.mockClear(); });

describe('PrivateChannelsView management', () => {
  it('deletes the active channel and re-selects a survivor', async () => {
    concordFixture.value = base();
    render(PrivateChannelsView, { props: { communityId: 'cid', communityProfile: { name: 'Area' } } });
    await fireEvent.click(await screen.findByTestId('stub-open-delete-channel')); // ChannelChatStub → openOverlay('delete-channel')
    await fireEvent.click(await screen.findByTestId('concord-delete-channel-confirm'));
    await waitFor(() => expect(deleteChannel).toHaveBeenCalledWith('c2'));
    expect(selectSpy).toHaveBeenCalledWith('cid', 'c1');
  });

  it('disables the dissolve confirm until the area name is typed', async () => {
    concordFixture.value = base();
    render(PrivateChannelsView, { props: { communityId: 'cid', communityProfile: { name: 'Area' } } });
    await fireEvent.click(await screen.findByTestId('stub-open-dissolve'));
    const confirm = await screen.findByTestId('concord-dissolve-confirm');
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(screen.getByTestId('concord-dissolve-confirm-input'), { target: { value: 'Area' } });
    expect(confirm.disabled).toBe(false);
  });

  it('passes community=undefined to the wizard when dissolved (force-found)', async () => {
    concordFixture.value = base({ dissolved: true });
    render(PrivateChannelsView, { props: { communityId: 'cid', communityProfile: { name: 'Area' } } });
    await fireEvent.click(await screen.findByTestId('stub-open-create'));
    await waitFor(() => expect(screen.getByTestId('wizard-community').textContent).toBe('undefined'));
  });
});
```
Create the two fixtures:

`src/lib/components/__tests__/fixtures/ChannelChatStub.svelte`:
```svelte
<script>
  let { openOverlay, channelCount } = $props();
</script>
<div data-testid="stub-channel-count">{channelCount}</div>
<button data-testid="stub-open-delete-channel" onclick={() => openOverlay('delete-channel')}>del</button>
<button data-testid="stub-open-dissolve" onclick={() => openOverlay('dissolve')}>dis</button>
<button data-testid="stub-open-create" onclick={() => openOverlay('create')}>create</button>
```
`src/lib/components/__tests__/fixtures/ChannelCreateWizardStub.svelte`:
```svelte
<script>
  let { community } = $props();
</script>
<div data-testid="wizard-community">{community === undefined ? 'undefined' : 'present'}</div>
```

- [ ] **Step 2: Run to verify fail.** `npx vitest run --environment jsdom src/lib/components/__tests__/PrivateChannelsView.management.test.svelte.js` → FAIL (no delete modal, dissolve has no input, create passes community=present when dissolved). If a mock detail (e.g. `vi.mock` factory `await import`) needs adjusting for this repo's vitest, fix the test harness — do not weaken assertions.

- [ ] **Step 3: Add delete + dissolve-confirm state and the delete handler.** In `PrivateChannelsView.svelte` `<script>`, after the `dissolve()` function (line 189), add:
```js
  let deletingChannel = $state(false);
  async function deleteActiveChannel() {
    if (deletingChannel || !activeChannel || channels.length <= 1) return;
    deletingChannel = true;
    try {
      const remaining = channels.filter((c) => c.channel_id !== activeChannel.channel_id);
      await concord.community.deleteChannel(activeChannel.channel_id);
      if (remaining[0] && concord.communityId)
        selectConcordChannel(concord.communityId, remaining[0].channel_id);
      showToast(m.concord_channel_deleted(), 'success');
      overlay = null;
    } catch (error) {
      console.error('concord: deleteChannel failed', error);
      showToast(m.concord_channel_delete_failed(), 'error');
    } finally {
      deletingChannel = false;
    }
  }

  // Typed confirmation for the permanent, whole-area dissolve.
  let dissolveConfirmText = $state('');
  const dissolveExpected = $derived(
    (communityProfile?.name || '').trim() || m.concord_dissolve_confirm_fallback()
  );
  const dissolveConfirmed = $derived(
    dissolveConfirmText.trim().toLowerCase() === dissolveExpected.toLowerCase()
  );
  // Clear the typed value whenever the dissolve modal isn't open.
  $effect(() => {
    if (overlay !== 'dissolve' && dissolveConfirmText) dissolveConfirmText = '';
  });
```

- [ ] **Step 4: Pass `channelCount` and make `create` force-found when dissolved.** In the `<ChannelChat ... />` usage (lines 347-354) add `channelCount={channels.length}`. In the `{#if overlay === 'create'}` block (line 362), change the wizard's community prop:
```svelte
      community={concord.dissolved ? undefined : concord.community}
```
(keep the rest of that block unchanged).

- [ ] **Step 5: Add the delete-channel modal + dissolve typed-confirm input.** In the overlay `{:else if}` chain, add a delete-channel branch before the dissolve branch, and replace the dissolve modal body. Locate the `{:else if overlay === 'dissolve' && concord.community}` block (lines 407-425) and replace it with:
```svelte
  {:else if overlay === 'delete-channel' && concord.community && activeChannel}
    <div class="modal-open modal" role="dialog">
      <div class="modal-box max-w-sm text-center">
        <h3 class="text-lg font-extrabold">{m.concord_delete_channel_title()}</h3>
        <p class="my-3 text-sm text-base-content/70">
          {m.concord_delete_channel_body({ name: activeChannel.name })}
        </p>
        <div class="modal-action justify-center">
          <button class="btn btn-ghost" onclick={() => (overlay = null)}>{m.concord_cancel()}</button>
          <button
            class="btn btn-error"
            data-testid="concord-delete-channel-confirm"
            disabled={deletingChannel}
            onclick={deleteActiveChannel}>{m.concord_delete_channel_action()}</button
          >
        </div>
      </div>
    </div>
  {:else if overlay === 'dissolve' && concord.community}
    <div class="modal-open modal" role="dialog">
      <div class="modal-box max-w-sm text-center">
        <h3 class="text-lg font-extrabold">{m.concord_dissolve_title()}</h3>
        <p class="my-3 text-sm text-base-content/70">{m.concord_dissolve_body()}</p>
        <label class="mb-1 block text-left text-xs text-base-content/60" for="concord-dissolve-confirm-input">
          {m.concord_dissolve_confirm_label({ name: dissolveExpected })}
        </label>
        <input
          id="concord-dissolve-confirm-input"
          class="input-bordered input input-sm mb-3 w-full"
          data-testid="concord-dissolve-confirm-input"
          placeholder={m.concord_dissolve_confirm_placeholder()}
          bind:value={dissolveConfirmText}
        />
        <div class="modal-action justify-center">
          <button class="btn btn-ghost" onclick={() => (overlay = null)}>{m.concord_cancel()}</button>
          <button
            class="btn btn-error"
            data-testid="concord-dissolve-confirm"
            disabled={dissolving || !dissolveConfirmed}
            onclick={dissolve}>{m.concord_dissolve_action()}</button
          >
        </div>
      </div>
    </div>
  {/if}
```

- [ ] **Step 6: Run to verify pass.** `npx vitest run --environment jsdom src/lib/components/__tests__/PrivateChannelsView.management.test.svelte.js` → all pass. Also re-run the sibling files to confirm no regression: `npx vitest run --environment jsdom src/lib/components/__tests__/PrivateChannelsView.test.js src/lib/components/__tests__/PrivateChannelsView.shared-selection.test.svelte.js`.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/components/community/channels/PrivateChannelsView.svelte src/lib/components/__tests__/PrivateChannelsView.management.test.svelte.js src/lib/components/__tests__/fixtures/ChannelChatStub.svelte src/lib/components/__tests__/fixtures/ChannelCreateWizardStub.svelte
git commit -m "feat(concord): per-channel delete modal, dissolve typed-confirm, dissolved force-found"
```

---

### Task 4: Verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck.** `pnpm check 2>&1 | grep -E "ChannelChat|PrivateChannelsView"` → no ERROR lines for these two files.
- [ ] **Step 2: Full Concord suite.** `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelChat.test.js src/lib/components/__tests__/PrivateChannelsView.test.js src/lib/components/__tests__/PrivateChannelsView.shared-selection.test.svelte.js src/lib/components/__tests__/PrivateChannelsView.management.test.svelte.js src/lib/components/__tests__/ChannelInviteSheet.test.js src/lib/components/__tests__/ChannelCreateWizard.test.js` → all pass.
- [ ] **Step 3: Manual browser smoke** (dev server, the freshly-founded live area): (a) channel `⋯` → "Kanal löschen" appears for a non-last channel, deletes it, re-selects a survivor; hidden for the last channel. (b) `⋯` → dissolve modal: confirm button disabled until the area name is typed. (c) After dissolving a throwaway area, the dissolved banner shows "Neuen Bereich gründen" and clicking it founds a fresh area. (Do the destructive (c) check only on a throwaway area, with the user's confirmation — do not dissolve their live area.)
- [ ] **Step 4: Final commit if fixes were needed** (skip if steps 1-3 clean).

---

## Self-Review

- **Spec coverage:** per-channel delete → Task 2 (menu) + Task 3 (modal/handler); dissolve recovery → Task 2 (banner button) + Task 3 (force-found create); safer dissolve → Task 3 (typed confirm); strings + tests → Task 1 + each task. ✓
- **Type/name consistency:** `deleteChannel(channelId)`, `deleteActiveChannel`, `dissolveConfirmed`, `dissolveExpected`, `channelCount`, overlay values `'delete-channel'`/`'create'`/`'dissolve'` used identically across tasks and match current source. Message keys defined once in Task 1. ✓
- **Placeholder scan:** Task 2 tests are concrete; Task 3 provides concrete component code plus two stub fixtures and concrete assertions. The only adaptation allowed is fixing vitest mock-factory mechanics for this repo (Step 2 note) — not weakening assertions. ✓
- **Scope:** no SDK/relay/link-flow/inbox changes; no channel rename; no undissolve. ✓
