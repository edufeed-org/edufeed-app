# Termi "Set Up Your Profile" Hint — Design

**Date:** 2026-07-16
**Status:** Approved design, pending implementation plan

## Goal

Users without a kind-0 profile (e.g. Google-login users who closed the signup wizard early,
or extension/bunker users who never published one) currently appear as a cryptic key
everywhere and get no nudge to fix it. Add a Termi assistant hint that detects the missing
profile and offers a CTA opening the existing profile editor.

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| Interaction model | Approach C: hint card + CTA opening `EditProfileModal` now; conversational in-chat profile setup explicitly parked until the real edufeed-chat-bot backend integration |
| Who gets the hint | ALL signing account types (nsec, extension, bunker/Google) with no kind-0; read-only npub accounts excluded via `canSign` |
| Nudge mechanism | The existing Termi launcher badge + greeting count only; no auto-open, no page banners (per project rule: banners live in Termi) |

## Architecture

A new `profile` hint in the existing assistant-hints system, mirroring the `nip05` hint
(the closest analog: profile-derived, settle-gated, per-pubkey dismissal).

### Condition — hint is `applicable` when ALL hold

1. An active account exists and `canSign(account)` is true
   (`$lib/helpers/signing-guard.js` — excludes `readonly` accounts, whose pubkey belongs
   to someone else and which cannot publish).
2. The kind-0 check has **settled**: the existing kind-0 subscription effect in
   `src/lib/stores/assistant-hints.svelte.js` (added for the nip05 hint: subscribes to
   `eventStore.replaceable(0, user.pubkey)` with a 5000 ms settle timeout) is **extended**
   with a `hasProfile` boolean — no second subscription. `settled && !hasProfile` means
   "genuinely missing", never "still loading".
3. Not dismissed for this pubkey.
4. The signup wizard is not open (`modalStore.activeModal !== 'signup'`) — prevents the
   badge flashing at a user who is mid-wizard and about to publish their kind 0.

### Status lifecycle

Existing `deriveHintStatus` helper, unchanged:
- `applicable` → `open` (feeds the launcher badge + greeting count automatically)
- `confirmed = hasProfile` — flips reactively when the kind 0 lands in the EventStore
  (regardless of whether it was published via our modal, the signup wizard, or another
  client) → `done` praise card if Termi was ever open, else the hint just disappears
- `running`: not used (the CTA opens a modal; confirmation is reactive)

### CTA

`runHint('profile')` → `modalStore.openModal('profile', { profile: {}, pubkey: user.pubkey })`.
`EditProfileModal` already handles the no-kind-0 case: `isOwn` is true (pubkey matches
`manager.active`), fields initialize empty, saving runs applesauce `UpdateProfile` which
creates the kind 0; its validation requires a non-empty name. Modal open/close behavior
matches the existing backup hint's CTA.

### Dismissal

New `src/lib/stores/profile-hint-flags.svelte.js` — verbatim sibling of
`nip05-hint-flags.svelte.js`: localStorage key `profile-hint-dismissed:<pubkey>`,
`isProfileHintDismissed(pubkey)` / `markProfileHintDismissed(pubkey)`, reactive `version`
counter. Session-level dismiss Set behavior is inherited from the store.

### Touch points (mirrors the nip05 hint exactly)

1. `HINT_IDS` + `HintId` typedef in `assistant-hints.svelte.js`: add `'profile'`.
2. The `statuses` `$derived.by`: extend the existing kind-0 effect with `hasProfile`;
   add `profileApplicable` + `deriveHintStatus` entry.
3. `runHint` branch (open the profile modal).
4. Dismiss branch + the new flags store.
5. `TermiChatWindow.svelte` `hintCopy` entry + widen the `hint.id` cast; new paraglide
   messages `termi_hint_profile_title`, `termi_hint_profile_body`,
   `termi_hint_profile_cta` in BOTH `messages/en.json` and `messages/de.json`
   (identical key order; no literal `@` before placeholders).

Copy direction (final wording at implementation time): title ~"Show who you are";
body ~"You don't have a profile yet — others only see a cryptic key instead of your
name."; CTA ~"Set up profile".

## Error handling

- Relays unreachable → the 5 s settle timeout concludes the check; if the user actually
  has a profile that simply didn't load, the hint may show — clicking the CTA opens the
  editor whose own load may still hydrate, and publishing a kind 0 is idempotent
  (replaceable event). Acceptable, matches nip05 hint behavior.
- Account switch mid-check → the existing effect teardown/re-run per active user applies;
  dismissal is per pubkey; the session dismiss Set already clears on user change.

## Testing

- **Unit** (`src/lib/__tests__/assistant-hints.test.js` + flags store test): applicability
  matrix — readonly account excluded, unsettled excluded, has-profile excluded, dismissed
  excluded, signup-modal-open excluded, plain signing account with settled-missing profile
  → open; confirmed flips to done only with `everOpen`; flags store round-trip.
- **Component**: only if the existing suite has TermiChatWindow coverage to extend;
  otherwise rely on unit level (hint copy rendering follows the existing `{#each}` path).

## Out of scope

- Conversational in-chat profile setup (revisit with the edufeed-chat-bot backend
  integration — the canned chat has no conversational state machine and the editor's
  validation/upload/publish logic must not be duplicated).
- Auto-opening the Termi window or any page banner.
- Prefilling profile fields from login-method data (Google token is email-only; see
  memory/spec notes from the login project).
