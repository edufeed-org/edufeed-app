# Login Modal Cleanup — Design (Issue #49)

**Issue:** https://git.edufeed.org/edufeed/edufeed-app/issues/49
**Date:** 2026-07-24
**Status:** Approved (hierarchy, scope, and mobile handling confirmed with Steffen)

## Problem

The login modal (`src/lib/components/LoginModal.svelte`) is visually crowded:
two large full-width buttons (Google, Konto erstellen), a divider, then three
to four stacked full-width method buttons in a `join` group, plus a bulky
footer "Schließen" button. Issue #49 asks for a cleanup modeled on
jumble.social's login modal (primary action on top, "OR" divider, compact
icon cards for secondary methods, footer link), keeping edufeed's color
scheme.

## Decisions Made

1. **Hierarchy: newcomer-first.** "Konto erstellen" stays the big primary CTA
   (teal `btn-primary`), Google below it. Existing-Nostr methods are demoted
   to compact icon cards. (Jumble's structure, edufeed's priorities — our
   audience is education newcomers, not Nostr veterans.)
2. **Scope: only `LoginModal.svelte`.** Sub-modals (nsec, Bunker, npub,
   Google, Signup) are untouched. Purely presentational — zero behavior
   changes.
3. **Mobile: capability check for the extension card.** NIP-07 extensions
   generally don't exist on mobile browsers. The "Erweiterung" card renders
   only when `!isMobileUA || !!window.nostr`. This hides it for typical
   mobile users (grid collapses to 2 cards) while still showing it on
   Firefox Android / Kiwi / Safari-iOS-with-Nostash, which inject
   `window.nostr`. Reliable because the modal mounts long after page load
   (ModalManager renders it lazily), so injection has already happened.
   Desktop always shows all three cards — clicking without an extension
   keeps today's inline error with install guidance.

## Layout (top → bottom)

```
┌──────────────────────────────────┐
│ Konto hinzufügen              ✕ │   header + ghost close (CloseIcon)
│ [saved accounts, if any]         │   unchanged AccountProfile rows
│ ───────────── ODER ───────────── │   divider only when accounts exist
│ ┌──────────────────────────────┐ │
│ │      Konto erstellen         │ │   btn-primary btn-lg w-full
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │  G  Mit Google fortfahren    │ │   btn w-full (if googleLogin.enabled)
│ └──────────────────────────────┘ │
│ ── Du hast schon ein Nostr-Konto? ── │
│ [extension error alert, if any]  │
│ ┌────────┐ ┌────────┐ ┌────────┐ │
│ │   🧩   │ │   📱   │ │   🔑   │ │   icon-card grid
│ │Erweiter.│ │Signier-│ │Privater│ │   (grid-cols-3, or cols-2 when
│ │        │ │  App   │ │Schlüssel│ │    extension card hidden)
│ └────────┘ └────────┘ └────────┘ │
│  Nur stöbern: mit npub (nur lesen)│   ghost/link row (if npubLogin.enabled)
└──────────────────────────────────┘
```

Removed: the `modal-action` footer with the "Schließen" button (replaced by
header ✕; ESC/backdrop close still works — the existing dialog-close-sync
`$effect` is untouched).

### Icon cards

- Vertical layout: icon (w-6 h-6) above a short label (`text-xs` or
  `text-sm`), `bg-base-200`-style card with border + hover state, DaisyUI
  semantic tokens only (no hardcoded colors).
- Full method descriptions move to `title` tooltips so no information is
  lost.
- Grid: `grid gap-2` with a conditional column class — `grid-cols-3` when
  the extension card renders, `grid-cols-2` when it doesn't.

### Cards and their actions (behavior unchanged)

| Card / row          | testid                   | Action                              |
| ------------------- | ------------------------ | ----------------------------------- |
| 🧩 Erweiterung      | `login-method-extension` | direct login, MV3 retry, inline err |
| 📱 Signier-App      | `login-method-bunker`    | `onBunkerTransition()`              |
| 🔑 Privater Schlüssel | `login-method-nsec`    | `onNSECTransition()`                |
| npub ghost row      | `login-method-npub`      | `onNpubTransition()`                |
| Google button       | `login-method-google`    | `onGoogleTransition()`              |
| Konto erstellen     | `signup-primary-cta`     | `modalStore.openModal('signup')`    |

All `data-testid`s are preserved. The `section[data-testid="other-signin-methods"]`
wrapper stays.

## Mobile capability check

```javascript
// Computed once at component init — the modal mounts on demand, so
// window.nostr injection (if any) has already happened.
const isMobileUA = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
const showExtensionCard = !isMobileUA || !!globalThis.window?.nostr;
```

No reactivity needed; a plain `const` at init time. (If a user installs an
extension mid-session they reopen the modal anyway, which remounts the
component via ModalManager's `{#if}`.)

## New icons

Three new icons in `src/lib/components/icons/ui/`, following the existing
`Icon.svelte`/`currentColor` pattern, re-exported from the barrel `index.js`:

- `PuzzleIcon` (extension)
- `SmartphoneIcon` (signer app)
- `KeyIcon` (private key)

`GoogleIcon` and `CloseIcon` already exist.

## i18n

New Paraglide messages (de + en), short card labels:

- `auth_login_modal_extension_short` — "Erweiterung" / "Extension"
- `auth_login_modal_bunker_short` — "Signier-App" / "Signer app"
- `auth_login_modal_nsec_short` — "Privater Schlüssel" / "Private key"
- `auth_login_modal_npub_short` — "Nur stöbern: mit öffentlichem Schlüssel (npub)" / "Browse only: with public key (npub)"

Existing long strings (`auth_login_modal_extension` etc.) remain — they feed
the `title` tooltips and are still used by sub-modals/tests. No `@` before
placeholders in message values (svelte-check gotcha).

## Testing (TDD)

Update `src/lib/components/__tests__/LoginModal.test.js` **before** the
implementation:

Keep unchanged (must still pass):
- All four extension-flow tests (duplicate handling, MV3 retry, missing-ext
  error, first login) — they select by testid, which survives.
- Saved-accounts-above-CTA DOM-order test.
- Primary CTA presence test.

Adapt / add:
- Method buttons render as cards inside `section[data-testid="other-signin-methods"]`
  (count: 3 on desktop UA; the old `join` assertions go away).
- Footer "Schließen" button is gone; a header close button exists inside a
  `form[method="dialog"]`.
- **Mobile capability tests:** with a mobile UA and no `window.nostr`, the
  extension card is absent (2 cards); with mobile UA + `window.nostr`
  present, it renders; desktop UA renders it regardless. (Mock
  `navigator.userAgent` via `vi.stubGlobal` / property spy in jsdom.)

Visual verification (test-all-visual-states rule): screenshot default state,
state with saved accounts, extension-error state, and a mobile-width
viewport, before reporting done. E2E: `e2e/npub-login.test.js` and
`e2e/fixtures.js` use `login-method-*` testids — expected to keep passing;
run to confirm.

## Out of scope

- Sub-modals (nsec, Bunker, npub, Google, Signup) — visual or behavioral.
- Any change to login/signing behavior, modal store, or ModalManager.
- Dark theme work (color mode is fixed to light).
