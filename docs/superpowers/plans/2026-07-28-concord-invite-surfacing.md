# Concord Invite Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface pending Concord private-area invitations on the dashboard — a Termi hint, a dashboard inbox CTA, and a Communities nav badge — all driven by one shared app-wide count.

**Architecture:** A new app-wide `pending-invites` service (mirrors `notifications.svelte.js`) exposes `getPendingInviteCount()` off the Concord `directInviteWatcher`. A global modal type opens the existing community-agnostic `InviteInboxModal`. Three surfaces consume the getter and open the modal.

**Tech Stack:** SvelteKit + Svelte 5 runes, RxJS, DaisyUI, Paraglide, Vitest, `applesauce-concord` via `src/lib/concord/` only.

## Global Constraints

- `applesauce-concord` imported only inside `src/lib/concord/`. The new service imports only RxJS + reads the `client` passed in — no package import needed.
- The count must be **prompt-free**: use `pending$.length + invites$.length` (no `readPending()`/decrypt). Decrypt stays only in `InviteInboxModal`.
- Mirror `notifications.svelte.js` exactly for lifecycle: module-level `$state`, manual RxJS subscription, a `generation` guard, `start*({client})`/`stop*()` wired next to the notifications service in `client.svelte.js`.
- Badge **Communities** (section id `communities`), not Gruppen.
- Copy via Paraglide de+en; run `pnpm paraglide:compile`.
- Runner: `npx vitest run <file>` (node) / `npx vitest run --environment jsdom <file>` (component). `pnpm test:component -- <file>` does NOT filter here.
- TDD.

---

### Task 1: i18n messages

**Files:** `messages/de.json`, `messages/en.json`

**Produces:** `concord_invite_hint_title`, `concord_invite_hint_body`, `concord_invite_hint_action`, `concord_invite_inbox_cta`, `concord_invite_inbox_action`.

- [ ] **Step 1: Add to `messages/de.json`** (near other `concord_*` keys):
```json
  "concord_invite_hint_title": "Einladung zu einem privaten Bereich",
  "concord_invite_hint_body": "Du wurdest in einen Ende-zu-Ende-verschlüsselten Bereich eingeladen. Sieh sie dir an und tritt bei.",
  "concord_invite_hint_action": "Einladung ansehen",
  "concord_invite_inbox_cta": "{count} Einladung(en) zu privaten Bereichen",
  "concord_invite_inbox_action": "Ansehen",
```
- [ ] **Step 2: Add to `messages/en.json`:**
```json
  "concord_invite_hint_title": "Invitation to a private area",
  "concord_invite_hint_body": "You've been invited to an end-to-end-encrypted area. Take a look and join.",
  "concord_invite_hint_action": "View invitation",
  "concord_invite_inbox_cta": "{count} invitation(s) to private areas",
  "concord_invite_inbox_action": "View",
```
- [ ] **Step 3:** `pnpm paraglide:compile` → succeeds; `ls src/lib/paraglide/messages/ | grep concord_invite_hint_title` → present.
- [ ] **Step 4: Commit.** `git add messages/de.json messages/en.json src/lib/paraglide && git commit -m "i18n(concord): pending-invite surfacing strings"`

---

### Task 2: `pending-invites` service + lifecycle wiring

**Files:** Create `src/lib/concord/pending-invites.svelte.js`; Create `src/lib/__tests__/concord-pending-invites.test.js`; Modify `src/lib/concord/client.svelte.js`

**Produces:** `getPendingInviteCount(): number`, `startConcordPendingInvites({client})`, `stopConcordPendingInvites()`.

- [ ] **Step 1: Write the failing unit test.** Create `src/lib/__tests__/concord-pending-invites.test.js`:
```js
/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import {
  startConcordPendingInvites,
  stopConcordPendingInvites,
  getPendingInviteCount
} from '$lib/concord/pending-invites.svelte.js';

function makeClient() {
  const pending$ = new BehaviorSubject([]);
  const invites$ = new BehaviorSubject([]);
  const directInviteWatcher$ = new BehaviorSubject({ pending$, invites$ });
  return { directInviteWatcher$, pending$, invites$ };
}

beforeEach(() => stopConcordPendingInvites());

describe('pending-invites service', () => {
  it('counts pending + decrypted invites and updates reactively', () => {
    const c = makeClient();
    startConcordPendingInvites({ client: c });
    expect(getPendingInviteCount()).toBe(0);
    c.pending$.next([{ id: 'w1' }, { id: 'w2' }]);
    expect(getPendingInviteCount()).toBe(2);
    c.invites$.next([{ id: 'i1' }]);
    expect(getPendingInviteCount()).toBe(3);
    c.pending$.next([]);
    expect(getPendingInviteCount()).toBe(1);
  });

  it('resets to 0 on stop and ignores later emissions', () => {
    const c = makeClient();
    startConcordPendingInvites({ client: c });
    c.pending$.next([{ id: 'w1' }]);
    expect(getPendingInviteCount()).toBe(1);
    stopConcordPendingInvites();
    expect(getPendingInviteCount()).toBe(0);
    c.pending$.next([{ id: 'w2' }, { id: 'w3' }]);
    expect(getPendingInviteCount()).toBe(0); // unsubscribed
  });

  it('handles a client without a watcher (never ticks, count stays 0)', () => {
    startConcordPendingInvites({ client: {} });
    expect(getPendingInviteCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail.** `npx vitest run src/lib/__tests__/concord-pending-invites.test.js` → FAIL (module missing).

- [ ] **Step 3: Create `src/lib/concord/pending-invites.svelte.js`:**
```js
// App-wide count of pending Concord invitations (spec: invite surfacing).
// Mirrors notifications.svelte.js: module-level $state, manual RxJS
// subscription OUTSIDE component context, a generation guard, started/stopped
// by client.svelte.js under the account lifecycle. Reads pending$ (locked
// wraps — no signer prompt) + invites$ (already decrypted) so the count is
// prompt-free; the only decrypt stays in InviteInboxModal.readPending().
// Imports only RxJS + the client passed in — no applesauce-concord import.
import { of, combineLatest } from 'rxjs';
import { switchMap } from 'rxjs/operators';

let pendingCount = $state(0);
let generation = 0;
/** @type {import('rxjs').Subscription | undefined} */
let sub;

/** @param {{ client: any }} args */
export function startConcordPendingInvites({ client }) {
  stopConcordPendingInvites();
  generation += 1;
  const myGeneration = generation;
  // directInviteWatcher$ is a BehaviorSubject the client fills after start();
  // switchMap re-binds to the live watcher's streams. Optional-chained: a
  // client without the watcher (non-nip44 signer, tests) simply never ticks.
  sub = client?.directInviteWatcher$
    ?.pipe(
      switchMap((/** @type {any} */ w) =>
        combineLatest([w?.pending$ ?? of([]), w?.invites$ ?? of([])])
      )
    )
    .subscribe((/** @type {[any[], any[]]} */ [pending, invites]) => {
      if (myGeneration !== generation) return;
      pendingCount = (pending?.length ?? 0) + (invites?.length ?? 0);
    });
}

export function stopConcordPendingInvites() {
  generation += 1;
  sub?.unsubscribe();
  sub = undefined;
  pendingCount = 0;
}

/** @returns {number} reactive pending-invite count */
export function getPendingInviteCount() {
  return pendingCount;
}
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/lib/__tests__/concord-pending-invites.test.js` → 3/3 pass.

- [ ] **Step 5: Wire lifecycle in `client.svelte.js`.** Find the notifications start block (~lines 284-294, `const notifications = await import('./notifications.svelte.js'); ... await notifications.startConcordNotifications({...})`). Immediately after the `startConcordNotifications({...})` call, add:
```js
    const pendingInvites = await import('./pending-invites.svelte.js');
    pendingInvites.startConcordPendingInvites({ client });
```
And in the teardown path (where `stopConcordNotifications()` is called — search `stopConcordNotifications` in this file), add alongside it:
```js
    (await import('./pending-invites.svelte.js')).stopConcordPendingInvites();
```
Match the surrounding dynamic-import + await style already used for notifications. (If teardown is a non-async context, mirror exactly how `stopConcordNotifications` is reached there — e.g. it may already be inside an async teardown; if not, import statically at top is acceptable since this file already imports concord siblings dynamically — prefer matching the notifications call site verbatim.)

- [ ] **Step 6: Sanity.** `npx vitest run src/lib/__tests__/concord-pending-invites.test.js` still 3/3; `pnpm check 2>&1 | grep -E "pending-invites|client.svelte" | grep -i error || echo clean`.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/concord/pending-invites.svelte.js src/lib/__tests__/concord-pending-invites.test.js src/lib/concord/client.svelte.js
git commit -m "feat(concord): app-wide pending-invite count service"
```

---

### Task 3: Global modal for the invite inbox

**Files:** Modify `src/lib/stores/modal.svelte.js`; Modify `src/lib/components/ModalManager.svelte`

- [ ] **Step 1: Add the modal type.** In `modal.svelte.js`, add `'concordInvites'` to the `ModalType` typedef union (the `@typedef {...} ModalType` line).

- [ ] **Step 2: Register in `ModalManager.svelte`.** Add the import near the other modal imports:
```js
  import InviteInboxModal from './community/channels/InviteInboxModal.svelte';
```
Add a render branch alongside the others (mirror the `recovery-download` branch's structure — a top-level `{#if modal.activeModal === '...'}`/`{:else if ...}` region near line 340, OR the internal switch near line 265, whichever the file uses to actually render components; match the existing pattern exactly):
```svelte
{:else if modal.activeModal === 'concordInvites'}
  <InviteInboxModal onClose={() => modal.closeModal()} />
```
Note: `InviteInboxModal` needs no community context — it reads the app-wide `getConcordClient().directInviteWatcher` and takes only `onClose`. It is SSR-safe (no static `applesauce-concord` import).

- [ ] **Step 3: Verify build.** `pnpm check 2>&1 | grep -E "ModalManager|modal.svelte" | grep -i error || echo clean`. (No dedicated test — exercised via Tasks 4/5.)

- [ ] **Step 4: Commit.**
```bash
git add src/lib/stores/modal.svelte.js src/lib/components/ModalManager.svelte
git commit -m "feat(concord): global concordInvites modal opens the invite inbox"
```

---

### Task 4: Termi hint `invites`

**Files:** Modify `src/lib/stores/assistant-hints.svelte.js`; Modify `src/lib/components/assistant/TermiChatWindow.svelte`; Modify `src/lib/components/__tests__/` (a hints test if one exists) OR `src/lib/__tests__/` for the helper.

- [ ] **Step 1: Write the failing test.** If a hints test exists (search `assistant-hints` under `__tests__`), extend it; else add `src/lib/__tests__/assistant-hints-invites.test.js` that imports the hook is hard (it's `$state`/`$effect`-heavy) — instead test the pure decision: assert that with `getPendingInviteCount() > 0` the hook yields an `invites` status of `'open'`, and `null` at 0. If the hook can't be unit-tested without a full component mount, mock `getPendingInviteCount` and assert `deriveHintStatus({ applicable: count > 0, confirmed: false, running: false, everOpen: false })` returns `'open'` for count>0 and `null` for 0 (this locks the mapping the hook uses). Keep the assertion real; do not assert nothing.

- [ ] **Step 2: Run to verify fail** (the `'invites'` id / status doesn't exist yet).

- [ ] **Step 3: Register the hint id.** In `assistant-hints.svelte.js`: add `'invites'` to the `HintId` typedef and the `HINT_IDS` array; import the getter: `import { getPendingInviteCount } from '$lib/concord/pending-invites.svelte.js';`

- [ ] **Step 4: Add the status.** In the `statuses` `$derived.by(...)` map, add:
```js
      invites: deriveHintStatus({
        applicable: getPendingInviteCount() > 0,
        confirmed: false,
        running: running.has('invites'),
        everOpen: everOpen.has('invites')
      }),
```
(No dismissal — the hint auto-clears when the count reaches 0 on accept/decline.)

- [ ] **Step 5: Wire `runHint`.** In the `runHint(id)` function, add a branch:
```js
    if (id === 'invites') {
      modalStore.openModal('concordInvites');
      return;
    }
```
(Match the early-return style of the existing branches.)

- [ ] **Step 6: Add hint copy.** In `TermiChatWindow.svelte`'s `hintCopy` `$derived` map, add an `invites` entry mirroring an existing entry's shape, using `m.concord_invite_hint_title()`, `m.concord_invite_hint_body()`, `m.concord_invite_hint_action()`.

- [ ] **Step 7: Run tests + typecheck.** The hints test passes; `pnpm check 2>&1 | grep -E "assistant-hints|TermiChatWindow" | grep -i error || echo clean`.

- [ ] **Step 8: Commit.**
```bash
git add src/lib/stores/assistant-hints.svelte.js src/lib/components/assistant/TermiChatWindow.svelte src/lib/__tests__/assistant-hints-invites.test.js
git commit -m "feat(concord): Termi hint for pending private-area invitations"
```

---

### Task 5: Dashboard inbox CTA + Communities nav badge

**Files:** Modify `src/lib/components/inbox/HomeInboxCard.svelte`; Modify `src/lib/components/dashboard/DashboardNavSidebar.svelte`; Modify their `__tests__` files if present.

- [ ] **Step 1: Write failing tests.** For `DashboardNavSidebar`: mock `getPendingInviteCount` (via `vi.mock('$lib/concord/pending-invites.svelte.js', () => ({ getPendingInviteCount: () => 2 }))`) and assert a badge with "2" renders on the Communities item; a second test with `() => 0` asserts no invite badge. For `HomeInboxCard`: mock the getter to 2 and `modalStore`, assert the CTA row renders (text via `concord_invite_inbox_cta`) and clicking its action calls `modalStore.openModal('concordInvites')`; at 0, no CTA. Reuse each file's existing test setup/mocks; adapt selectors to the real markup. Do not weaken the assertions (badge count present; CTA opens the modal).

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Nav badge.** In `DashboardNavSidebar.svelte`, import `getPendingInviteCount`, and add a branch to the badge block (after the `inbox`/`messages` branches, ~line 99):
```svelte
          {:else if section.id === 'communities' && getPendingInviteCount() > 0}
            <span
              class="absolute -top-1.5 -right-2 badge h-4 min-w-4 badge-sm text-[10px] badge-secondary"
              data-testid="communities-invite-badge"
            >
              {getPendingInviteCount() > 99 ? '99+' : getPendingInviteCount()}
            </span>
```

- [ ] **Step 4: Inbox CTA.** In `HomeInboxCard.svelte`, import `getPendingInviteCount` and `modalStore`. Between the filter-chips block and the item list (`{#if mergedItems.length === 0}`), insert:
```svelte
{#if getPendingInviteCount() > 0}
  <button
    class="flex w-full items-center gap-3 border-t border-base-300 bg-primary/5 px-4 py-3 text-left hover:bg-primary/10"
    data-testid="invite-inbox-cta"
    onclick={() => modalStore.openModal('concordInvites')}
  >
    <span aria-hidden="true">🔒</span>
    <span class="flex-1 text-sm font-medium"
      >{m.concord_invite_inbox_cta({ count: getPendingInviteCount() })}</span
    >
    <span class="text-sm font-semibold text-primary">{m.concord_invite_inbox_action()}</span>
  </button>
{/if}
```
(Confirm `m` and `modalStore` import paths against the file; `modalStore` is `$lib/stores/modal.svelte.js`.)

- [ ] **Step 5: Run tests + typecheck.** Both component tests pass; `pnpm check 2>&1 | grep -E "HomeInboxCard|DashboardNavSidebar" | grep -i error || echo clean`.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/components/inbox/HomeInboxCard.svelte src/lib/components/dashboard/DashboardNavSidebar.svelte src/lib/components/__tests__/
git commit -m "feat(concord): dashboard inbox CTA + Communities nav badge for pending invites"
```

---

### Task 6: Verification

- [ ] **Step 1: Typecheck.** `pnpm check 2>&1 | grep -iE "pending-invites|ModalManager|assistant-hints|HomeInboxCard|DashboardNavSidebar|client.svelte" | grep -i error || echo "clean"`.
- [ ] **Step 2: Suites.** `npx vitest run src/lib/__tests__/concord-pending-invites.test.js` and the component tests touched in Tasks 4-5 → all pass.
- [ ] **Step 3: Browser (best-effort).** The logged-in owner is the inviter, so likely has no pending invite. To smoke visually, temporarily stub `getPendingInviteCount` to return 2 in a dev build (or have a second account send the owner an invite), then confirm: the Communities nav badge shows, the dashboard CTA row shows and opens the invite modal, and the Termi hint appears. Revert any temporary stub. If no incoming invite is available, note that the surfaces are covered by the component tests and the count service by its unit test.
- [ ] **Step 4: Final commit if fixes needed** (skip if clean).

## Self-Review

- **Spec coverage:** shared service → Task 2; global modal → Task 3; Termi hint → Task 4; inbox CTA + nav badge → Task 5; i18n + tests → Task 1 + each. ✓
- **Type/name consistency:** `getPendingInviteCount()`, `startConcordPendingInvites({client})`, `stopConcordPendingInvites()`, modal type `'concordInvites'`, hint id `'invites'`, section id `'communities'` used identically across tasks. ✓
- **Placeholder scan:** service + modal + badge + CTA code concrete; the hint-test and UI-test steps say "reuse the file's existing setup / adapt selectors" (harness reuse) and forbid weakening assertions — not blanks. ✓
- **Scope:** no accept/decline/watcher/NIP-78 changes; count is prompt-free; decrypt stays in InviteInboxModal. ✓
