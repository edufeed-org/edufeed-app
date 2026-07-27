# Termi Profile-Setup Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Termi assistant hint that tells users without a kind-0 profile to set one up, with a CTA opening the existing profile editor.

**Architecture:** A new `profile` hint in the existing assistant-hints system, mirroring the `nip05` hint: the existing kind-0 subscription effect gains a `hasProfile` flag (no second subscription), a pure `isProfileHintApplicable` predicate in the tested helpers file drives applicability, a sibling flags store handles per-pubkey dismissal, and `runHint('profile')` opens `EditProfileModal` (which creates the kind 0 when none exists).

**Tech Stack:** Svelte 5 runes, applesauce EventStore, paraglide i18n, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-termi-profile-hint-design.md`

## Global Constraints

- Hint applies to ALL signing account types; read-only accounts excluded via `canSign(account)` from `$lib/helpers/signing-guard.js` (`account.type !== 'readonly'`).
- "Missing profile" may only be concluded after settle: kind-0 event arrived OR the existing 5000 ms timeout passed.
- Hint suppressed while the signup wizard is open: `modalStore.activeModal === 'signup'`.
- Dismissal key: `profile-hint-dismissed:<pubkey>` (localStorage, per pubkey, reactive version counter — verbatim sibling of `nip05-hint-flags.svelte.js`).
- CTA: `modalStore.openModal('profile', { profile: {}, pubkey: user.pubkey })`.
- i18n keys `termi_hint_profile_title` / `_body` / `_cta` in BOTH `messages/en.json` and `messages/de.json`, identical key order (pre-commit hook checks parity); never a literal `@` directly before a `{placeholder}`.
- No page banners, no auto-open of Termi (badge + greeting count come free from `getOpenCount()`).
- Work in a git worktree; rebase onto `dev`; copy `.env` from the main checkout. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Known pre-existing failures on dev (NOT yours to fix): suite-collection errors in `waves.test.js`, `image-license.test.js`, `helpers/inbox.test.js`, `MembershipApprovalsPanel.test.js` (stale mocks from a relay-helper API change).

---

### Task 1: Pure applicability predicate + dismiss-flags store

**Files:**
- Modify: `src/lib/helpers/assistant-hints.js` (append `isProfileHintApplicable`)
- Create: `src/lib/stores/profile-hint-flags.svelte.js`
- Test: `src/lib/__tests__/assistant-hints.test.js` (append a describe block)

**Interfaces:**
- Produces: `isProfileHintApplicable({ user, settled, hasProfile, dismissed, signupOpen }) → boolean` where `user` is `{ type?: string } | null | undefined`; and `isProfileHintDismissed(pubkey)` / `markProfileHintDismissed(pubkey)` from the flags store. Task 2 consumes all three.
- Consumes: `canSign` from `$lib/helpers/signing-guard.js`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/assistant-hints.test.js` (the file's imports are at the top — extend the helpers import to include `isProfileHintApplicable`):

```js
describe('isProfileHintApplicable', () => {
  const base = {
    user: { type: 'nsec', pubkey: 'a'.repeat(64) },
    settled: true,
    hasProfile: false,
    dismissed: false,
    signupOpen: false
  };

  it('is applicable for a signing account with a settled-missing profile', () => {
    expect(isProfileHintApplicable(base)).toBe(true);
  });

  it('excludes readonly accounts (not their key, cannot publish)', () => {
    expect(isProfileHintApplicable({ ...base, user: { type: 'readonly' } })).toBe(false);
  });

  it('excludes missing user', () => {
    expect(isProfileHintApplicable({ ...base, user: null })).toBe(false);
  });

  it('waits for the profile check to settle', () => {
    expect(isProfileHintApplicable({ ...base, settled: false })).toBe(false);
  });

  it('excludes users who already have a profile', () => {
    expect(isProfileHintApplicable({ ...base, hasProfile: true })).toBe(false);
  });

  it('respects the per-pubkey dismissal', () => {
    expect(isProfileHintApplicable({ ...base, dismissed: true })).toBe(false);
  });

  it('is suppressed while the signup wizard is open', () => {
    expect(isProfileHintApplicable({ ...base, signupOpen: true })).toBe(false);
  });

  it('applies to bunker (nostr-connect) accounts too', () => {
    expect(isProfileHintApplicable({ ...base, user: { type: 'nostr-connect' } })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/assistant-hints.test.js`
Expected: FAIL — `isProfileHintApplicable` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/helpers/assistant-hints.js`:

```js
import { canSign } from '$lib/helpers/signing-guard.js';

/**
 * Whether the "set up your profile" hint should show. Pure so the matrix is
 * unit-testable; the reactive store feeds it live values.
 *
 * @param {{
 *   user: { type?: string } | null | undefined,
 *   settled: boolean,
 *   hasProfile: boolean,
 *   dismissed: boolean,
 *   signupOpen: boolean
 * }} input
 * @returns {boolean}
 */
export function isProfileHintApplicable({ user, settled, hasProfile, dismissed, signupOpen }) {
  return canSign(user) && settled && !hasProfile && !dismissed && !signupOpen;
}
```

(The `import` goes to the top of the file with any existing imports. `canSign` is pure — no reactive state — so the helpers file stays pure.)

Create `src/lib/stores/profile-hint-flags.svelte.js`:

```js
// Per-pubkey dismiss flag for the Termi assistant's profile hint. Mirrors
// nip05-hint-flags: the flag lives in localStorage so a dismiss survives
// reloads, but a reactive version counter ensures markProfileHintDismissed()
// re-runs $derived consumers in the same tab (so the hint hides immediately,
// no reload needed).

const DISMISS_PREFIX = 'profile-hint-dismissed:';

let version = $state(0);

/** @param {string} pubkey */
export function isProfileHintDismissed(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DISMISS_PREFIX + pubkey);
}

/** @param {string} pubkey */
export function markProfileHintDismissed(pubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DISMISS_PREFIX + pubkey, '1');
  }
  version++;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/assistant-hints.test.js`
Expected: PASS (existing tests + 8 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/assistant-hints.js src/lib/stores/profile-hint-flags.svelte.js src/lib/__tests__/assistant-hints.test.js
git commit -m "feat(assistant): profile-hint applicability predicate + dismiss flags"
```

---

### Task 2: Wire the `profile` hint into the store, chat window, and i18n

**Files:**
- Modify: `src/lib/stores/assistant-hints.svelte.js` (typedef line 50, `HINT_IDS` line 53, kind-0 effect lines 106–125, no-user early return line 147, `statuses` block, `runHint`, `dismissHint`)
- Modify: `src/lib/components/assistant/TermiChatWindow.svelte` (`hintCopy` ~line 48, `hint.id` cast line 207)
- Modify: `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: `isProfileHintApplicable`, `isProfileHintDismissed`, `markProfileHintDismissed` (Task 1); `canSign` comes in through the predicate — do not re-check it in the store; `modalStore` (already imported in the store).
- Produces: hint id `'profile'` rendered as `data-testid="termi-hint-profile"` with action `termi-hint-profile-action` (free from the existing `{#each}`).

- [ ] **Step 1: Add i18n messages**

In `messages/en.json`, directly after `"termi_hint_nip05_cta"`:

```json
"termi_hint_profile_title": "Show who you are",
"termi_hint_profile_body": "You don't have a profile yet — others only see a cryptic key instead of your name. Add a name and picture so people recognize you.",
"termi_hint_profile_cta": "Set up profile",
```

In `messages/de.json`, at the same relative position (key order must match en.json):

```json
"termi_hint_profile_title": "Zeig, wer du bist",
"termi_hint_profile_body": "Du hast noch kein Profil — andere sehen nur einen kryptischen Schlüssel statt deines Namens. Füge Namen und Bild hinzu, damit man dich erkennt.",
"termi_hint_profile_cta": "Profil einrichten",
```

- [ ] **Step 2: Extend the store**

In `src/lib/stores/assistant-hints.svelte.js`:

1. Typedef + id list:

```js
/** @typedef {'backup' | 'relays' | 'dm' | 'nip05' | 'profile'} HintId */
```

```js
export const HINT_IDS = /** @type {HintId[]} */ (['backup', 'relays', 'dm', 'nip05', 'profile']);
```

2. Imports (top of file, next to the nip05 flags import):

```js
import {
  isProfileHintDismissed,
  markProfileHintDismissed
} from '$lib/stores/profile-hint-flags.svelte.js';
import { isProfileHintApplicable } from '$lib/helpers/assistant-hints.js';
```

(`isProfileHintApplicable` can be merged into the existing `deriveHintStatus, trackEverOpen` import from the same module.)

3. Extend the existing kind-0 effect (the nip05 one) with a `hasProfile` flag — declare next to `hasNip05`:

```js
  let profileSettled = $state(false);
  let hasNip05 = $state(false);
  let hasProfile = $state(false);

  $effect(() => {
    const user = getActiveUser();
    profileSettled = false;
    hasNip05 = false;
    hasProfile = false;
    if (!user) return;

    const sub = eventStore.replaceable(0, user.pubkey).subscribe((event) => {
      if (!event) return;
      hasProfile = true;
      hasNip05 = getProfileNip05s(event).length > 0;
      profileSettled = true;
    });
    const timeout = setTimeout(() => {
      profileSettled = true;
    }, 5000);

    return () => {
      sub?.unsubscribe();
      clearTimeout(timeout);
    };
  });
```

4. In `statuses` — extend the no-user early return:

```js
    if (!user) return { backup: null, relays: null, dm: null, nip05: null, profile: null };
```

and add before the `return`:

```js
    const profileApplicable = isProfileHintApplicable({
      user,
      settled: profileSettled,
      hasProfile,
      dismissed: isProfileHintDismissed(user.pubkey),
      signupOpen: modalStore.activeModal === 'signup'
    });
```

and add to the returned object:

```js
      profile: deriveHintStatus({
        applicable: profileApplicable,
        confirmed: hasProfile,
        running: false, // the action opens a modal; the kind 0 confirms reactively
        everOpen: everOpen.has('profile')
      })
```

5. In `runHint`, after the `nip05` branch:

```js
    if (id === 'profile') {
      const user = getActiveUser();
      if (!user) return;
      // EditProfileModal creates the kind 0 when none exists (UpdateProfile).
      modalStore.openModal('profile', { profile: {}, pubkey: user.pubkey });
      return;
    }
```

6. In `dismissHint`, after the `nip05` branch:

```js
      else if (id === 'profile') markProfileHintDismissed(user.pubkey);
```

- [ ] **Step 3: Extend the chat window**

In `src/lib/components/assistant/TermiChatWindow.svelte`:

1. `hintCopy` — add after the `nip05` entry:

```js
    profile: {
      title: m.termi_hint_profile_title(),
      body: m.termi_hint_profile_body(),
      action: m.termi_hint_profile_cta(),
      secondary: null,
      doing: null
    }
```

2. Widen the cast at line 207:

```svelte
      {@const copy = hintCopy[/** @type {'backup' | 'relays' | 'dm' | 'nip05' | 'profile'} */ (hint.id)]}
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/lib/__tests__/assistant-hints.test.js` — PASS.
Run: `pnpm run check` — 0 NEW errors (paraglide compiles the new keys; pre-existing warnings are fine).

Manual spot-check (dev server): log in with a fresh key (or an npub → hint must NOT appear for readonly), Termi badge shows within ~5 s for a profileless signing account, CTA opens the profile editor, saving a name makes the hint flip to the "done" card, dismiss (x) hides it and it stays hidden after reload for that pubkey.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/assistant-hints.svelte.js src/lib/components/assistant/TermiChatWindow.svelte messages/en.json messages/de.json
git commit -m "feat(assistant): Termi hint to set up a missing profile"
```

---

## Self-review notes

- Spec coverage: condition set (canSign/settle/dismiss/signup-gate) → Task 1 predicate + Task 2 wiring; lifecycle/CTA/dismissal/i18n/badge → Task 2; testing matrix → Task 1; out-of-scope items need no code.
- The `hasProfile` flag intentionally only flips on a real event; the settle timeout leaves it false, which is exactly the "genuinely missing" signal.
- `modalStore.activeModal` is reactive `$state` — reading it inside `$derived.by` re-evaluates statuses when the signup modal opens/closes.
