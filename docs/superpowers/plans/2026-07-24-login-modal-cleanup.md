# Login Modal Cleanup Implementation Plan (Issue #49)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declutter `LoginModal.svelte` into a jumble.social-style layout — primary "Konto erstellen" CTA on top, compact icon-card grid for existing-Nostr methods, header ✕ instead of footer Schließen, extension card hidden on mobile without `window.nostr`.

**Architecture:** Purely presentational rewrite of one component's template plus three new icons and four new i18n strings. Zero behavior change: all handlers, `data-testid`s, the extension MV3-retry logic, and the dialog-close-sync `$effect` stay exactly as they are. A capability check computed once at component init decides whether the extension card renders (the modal mounts on demand via ModalManager, so `window.nostr` injection has already happened).

**Tech Stack:** Svelte 5, TailwindCSS 4 + DaisyUI 5 (semantic tokens only), Paraglide i18n, Vitest + @testing-library/svelte (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-24-login-modal-cleanup-design.md`

## Global Constraints

- Work in the worktree `.claude/worktrees/issue-49-login-modal-cleanup` (branch `worktree-issue-49-login-modal-cleanup`, rebased on dev). Never touch the main checkout.
- Style with DaisyUI semantic classes only (`btn`, `bg-base-200`, `btn-primary`, …) — no hardcoded colors, no per-component `--c-*` blocks.
- Preserve every `data-testid` verbatim: `signup-primary-cta`, `login-method-google`, `login-method-extension`, `login-method-bunker`, `login-method-nsec`, `login-method-npub`, `other-signin-methods`, `extension-error`.
- Do not modify: `createSigner()`, the dialog-close-sync `$effect`, `ModalManager.svelte`, any sub-modal, `modal.svelte.js`.
- Commit messages: conventional commits (`feat:`/`test:`/`docs:`), each ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- i18n: German is the primary UI language; both `messages/de.json` and `messages/en.json` must get every new key. No `@` directly before a placeholder in message values.

---

### Task 1: Three new icons (Puzzle, Smartphone, Key)

**Files:**
- Create: `src/lib/components/icons/ui/PuzzleIcon.svelte`
- Create: `src/lib/components/icons/ui/SmartphoneIcon.svelte`
- Create: `src/lib/components/icons/ui/KeyIcon.svelte`
- Modify: `src/lib/components/icons/index.js` (append 3 exports)

**Interfaces:**
- Consumes: existing `src/lib/components/icons/Icon.svelte` wrapper (props: `class_`, `title`, `strokeWidth`).
- Produces: `PuzzleIcon`, `SmartphoneIcon`, `KeyIcon` importable from `$lib/components/icons`, each accepting `class_` (default `w-5 h-5`). Task 3 imports them by these exact names.

No dedicated unit test — icons are static markup; Task 3's component tests compile and render them, which is the project's existing level of icon coverage.

- [ ] **Step 1: Create `PuzzleIcon.svelte`**

Heroicons-outline paths (same family as the existing `CloseIcon`), via the shared `Icon` wrapper:

```svelte
<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Extension';
</script>

<Icon {class_} {title} strokeWidth={1.5}>
  <path
    d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z"
  />
</Icon>
```

- [ ] **Step 2: Create `SmartphoneIcon.svelte`**

```svelte
<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Signer app';
</script>

<Icon {class_} {title} strokeWidth={1.5}>
  <path
    d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
  />
</Icon>
```

- [ ] **Step 3: Create `KeyIcon.svelte`**

```svelte
<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Private key';
</script>

<Icon {class_} {title} strokeWidth={1.5}>
  <path
    d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
  />
</Icon>
```

- [ ] **Step 4: Append barrel exports**

At the end of `src/lib/components/icons/index.js` add:

```javascript
export { default as PuzzleIcon } from './ui/PuzzleIcon.svelte';
export { default as SmartphoneIcon } from './ui/SmartphoneIcon.svelte';
export { default as KeyIcon } from './ui/KeyIcon.svelte';
```

- [ ] **Step 5: Verify the barrel compiles**

Run: `pnpm exec vitest run src/lib/components/__tests__/LoginModal.test.js`
Expected: PASS (existing tests untouched; this just proves the icon files parse — Vite compiles the barrel transitively).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/icons
git commit -m "feat(icons): add Puzzle, Smartphone and Key icons for login method cards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: New i18n short labels (de + en)

**Files:**
- Modify: `messages/de.json` (after line 161, the `auth_login_modal_npub` entry)
- Modify: `messages/en.json` (after line 161, the `auth_login_modal_npub` entry)

**Interfaces:**
- Produces message functions Task 3 calls: `m.auth_login_modal_extension_short()`, `m.auth_login_modal_bunker_short()`, `m.auth_login_modal_nsec_short()`, `m.auth_login_modal_npub_short()`.

- [ ] **Step 1: Add keys to `messages/de.json`**

Insert directly after `"auth_login_modal_npub": …` (line 161):

```json
  "auth_login_modal_extension_short": "Erweiterung",
  "auth_login_modal_bunker_short": "Signier-App",
  "auth_login_modal_nsec_short": "Privater Schlüssel",
  "auth_login_modal_npub_short": "Nur stöbern: mit öffentlichem Schlüssel (npub)",
```

- [ ] **Step 2: Add keys to `messages/en.json`**

Insert directly after `"auth_login_modal_npub": …` (line 161):

```json
  "auth_login_modal_extension_short": "Extension",
  "auth_login_modal_bunker_short": "Signer app",
  "auth_login_modal_nsec_short": "Private key",
  "auth_login_modal_npub_short": "Browse only: with public key (npub)",
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/de.json')); JSON.parse(require('fs').readFileSync('messages/en.json')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add messages/de.json messages/en.json
git commit -m "feat(i18n): short login-method labels for icon cards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: LoginModal redesign (TDD)

**Files:**
- Modify: `src/lib/components/__tests__/LoginModal.test.js` (messages mock ~line 82-96; replace the "restructured normie-friendly layout" describe block ~line 208-275; add a new mobile-capability describe block)
- Modify: `src/lib/components/LoginModal.svelte` (imports ~line 15, add capability consts after line 26, replace template lines 131-223)

**Interfaces:**
- Consumes: `PuzzleIcon` / `SmartphoneIcon` / `KeyIcon` / `CloseIcon` / `GoogleIcon` from `$lib/components/icons` (Task 1); the four `*_short` messages (Task 2).
- Produces: the final component. New testid `login-modal-close` for the header ✕. Everything else keeps its existing name.

- [ ] **Step 1: Extend the messages mock in the test file**

In the `vi.mock('$lib/paraglide/messages', …)` factory (after `auth_login_modal_existing_account`), add:

```javascript
  auth_login_modal_npub: () => 'Browse with a public key (npub…) — read-only',
  auth_login_modal_extension_short: () => 'Extension',
  auth_login_modal_bunker_short: () => 'Signer app',
  auth_login_modal_nsec_short: () => 'Private key',
  auth_login_modal_npub_short: () => 'Browse only: with public key (npub)',
```

- [ ] **Step 2: Replace the layout describe block**

Replace the entire `describe('LoginModal — restructured normie-friendly layout', …)` block with (the CTA-presence, saved-accounts-order, and extension-clickable tests survive verbatim inside it):

```javascript
describe('LoginModal — cleaned-up layout (issue #49)', () => {
  it('shows the primary "Create your account" CTA prominently', async () => {
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-3' } });

    const cta = container.querySelector('[data-testid="signup-primary-cta"]');
    expect(cta, 'Primary signup CTA should be present').not.toBeNull();
  });

  it('renders the three method cards in a 3-column grid inside the methods section', async () => {
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-4' } });

    const section = container.querySelector('section[data-testid="other-signin-methods"]');
    expect(section, 'methods section should render').not.toBeNull();

    const grid = section?.querySelector('.grid');
    expect(grid, 'method cards should sit in a grid').not.toBeNull();
    expect(grid?.classList.contains('grid-cols-3')).toBe(true);
    expect(grid?.querySelectorAll('button').length).toBe(3);

    // The old stacked join-group is gone.
    expect(container.querySelector('.join')).toBeNull();
  });

  it('replaces the footer Schließen button with a header close button', async () => {
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-hdr' } });

    expect(container.querySelector('.modal-action')).toBeNull();

    const close = container.querySelector('[data-testid="login-modal-close"]');
    expect(close, 'header close button should render').not.toBeNull();
    // Inside a method="dialog" form so the native dialog close fires
    // (which the store-sync $effect listens for).
    expect(close?.closest('form')?.getAttribute('method')).toBe('dialog');
  });

  it('renders saved accounts above the primary CTA when present', async () => {
    const accounts = [
      { id: 'acc-1', pubkey: 'p1' },
      { id: 'acc-2', pubkey: 'p2' }
    ];
    const mod = await import('$lib/stores/accounts.svelte.js');
    const original = mod.useAccounts;
    // @ts-ignore
    mod.useAccounts = () => () => accounts;

    try {
      const { container } = render(LoginModal, { props: { modalId: 'login-modal-5' } });

      const savedRows = container.querySelectorAll('[data-testid="saved-account-mock"]');
      expect(savedRows.length).toBe(2);

      const cta = container.querySelector('[data-testid="signup-primary-cta"]');
      expect(cta).not.toBeNull();

      const first = savedRows[0];
      const cmp = first.compareDocumentPosition(/** @type {Node} */ (cta));
      expect(cmp & 4).toBeTruthy();
    } finally {
      // @ts-ignore
      mod.useAccounts = original;
    }
  });

  it('extension card is clickable without expanding anything', async () => {
    mockManager.getAccountForPubkey.mockReturnValue(undefined);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-6' } });

    const extensionButton = container.querySelector('[data-testid="login-method-extension"]');
    await fireEvent.click(/** @type {HTMLElement} */ (extensionButton));
    await new Promise((r) => setTimeout(r, 50));

    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Add the mobile-capability describe block**

Append at the end of the file (also add `afterEach` to the existing vitest import):

```javascript
describe('LoginModal — mobile extension capability check', () => {
  /** @param {string} ua */
  function stubUserAgent(ua) {
    // jsdom defines userAgent as a prototype getter; an own configurable
    // property shadows it and can be cleanly deleted afterwards.
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  }

  afterEach(() => {
    // @ts-ignore — remove the shadow so the jsdom default returns
    delete window.navigator.userAgent;
    // @ts-ignore
    delete window.nostr;
  });

  it('hides the extension card on a mobile UA without window.nostr', () => {
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-m1' } });

    expect(container.querySelector('[data-testid="login-method-extension"]')).toBeNull();
    const grid = container.querySelector('section[data-testid="other-signin-methods"] .grid');
    expect(grid?.classList.contains('grid-cols-2')).toBe(true);
    expect(grid?.querySelectorAll('button').length).toBe(2);
  });

  it('shows the extension card on a mobile UA when window.nostr is injected', () => {
    stubUserAgent('Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0');
    // @ts-ignore
    window.nostr = {};

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-m2' } });

    expect(container.querySelector('[data-testid="login-method-extension"]')).not.toBeNull();
  });

  it('shows the extension card on a desktop UA without window.nostr', () => {
    // jsdom's default UA contains no mobile marker.
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-m3' } });

    expect(container.querySelector('[data-testid="login-method-extension"]')).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run the test file — new layout tests must FAIL, extension-flow tests must still PASS**

Run: `pnpm exec vitest run src/lib/components/__tests__/LoginModal.test.js`
Expected: FAIL — grid test (no `.grid`, `.join` still present), header-close test (no `login-modal-close`, `.modal-action` present), mobile-hide test (extension card always rendered). The four extension-flow tests and the saved-accounts test still pass.

- [ ] **Step 5: Implement the redesign in `LoginModal.svelte`**

Change the icons import (line 15) and add the capability check after the `extensionError` declaration (line 26):

```javascript
  import { CloseIcon, GoogleIcon, KeyIcon, PuzzleIcon, SmartphoneIcon } from '$lib/components/icons';

  // NIP-07 extensions barely exist on mobile browsers, so the card would be
  // a dead button for most phone users. The modal mounts on demand (see
  // ModalManager's {#if}), long after extensions inject window.nostr — so a
  // one-shot check at init is reliable. Desktop always shows the card:
  // clicking without an extension surfaces the inline install hint instead.
  const isMobileUA = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  const showExtensionCard = !isMobileUA || !!(/** @type {any} */ (window).nostr);
```

Replace the entire template (`<dialog …>` through `</dialog>`, lines 131-223) with:

```svelte
<dialog id={modalId} class="modal">
  <div class="modal-box">
    <form method="dialog">
      <button
        data-testid="login-modal-close"
        class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm"
        aria-label={m.common_close()}
      >
        <CloseIcon class_="w-4 h-4" />
      </button>
    </form>

    <h1 class="text-lg font-bold">{m.auth_login_modal_add_account()}</h1>

    <div class="mt-4 space-y-4">
      {#if getAccounts().length > 0}
        <div>
          <h2 class="mb-2 text-sm font-semibold opacity-70">
            {m.auth_login_modal_available_accounts()}
          </h2>
          <ul class="space-y-2">
            {#each getAccounts() as account (account.id)}
              <AccountProfile {account} />
            {/each}
          </ul>
        </div>
        <div class="divider">{m.auth_login_modal_or()}</div>
      {/if}

      <button
        data-testid="signup-primary-cta"
        class="btn w-full btn-lg btn-primary"
        onclick={() => modalStore.openModal('signup')}
      >
        {m.auth_login_modal_create_account_cta()}
      </button>

      {#if runtimeConfig.googleLogin?.enabled}
        <button
          data-testid="login-method-google"
          class="btn w-full"
          onclick={() => onGoogleTransition?.()}
        >
          <GoogleIcon />
          {m.auth_login_modal_google()}
        </button>
      {/if}

      <div class="divider text-xs opacity-70">{m.auth_login_modal_existing_account()}</div>

      <section data-testid="other-signin-methods" class="space-y-2">
        {#if extensionError}
          <div data-testid="extension-error" class="mb-2 alert alert-error" role="alert">
            <span class="text-sm">{extensionError}</span>
          </div>
        {/if}
        <div class="grid gap-2 {showExtensionCard ? 'grid-cols-3' : 'grid-cols-2'}">
          {#if showExtensionCard}
            <button
              data-testid="login-method-extension"
              title={m.auth_login_modal_extension()}
              onclick={() => createSigner('Extension')}
              class="btn h-auto flex-col gap-2 py-4 font-normal"
            >
              <PuzzleIcon class_="h-6 w-6" />
              <span class="text-xs leading-tight">{m.auth_login_modal_extension_short()}</span>
            </button>
          {/if}
          <button
            data-testid="login-method-bunker"
            title={m.auth_login_modal_bunker()}
            onclick={() => createSigner('Bunker')}
            class="btn h-auto flex-col gap-2 py-4 font-normal"
          >
            <SmartphoneIcon class_="h-6 w-6" />
            <span class="text-xs leading-tight">{m.auth_login_modal_bunker_short()}</span>
          </button>
          <button
            data-testid="login-method-nsec"
            title={m.auth_login_modal_nsec()}
            onclick={() => createSigner('NSEC')}
            class="btn h-auto flex-col gap-2 py-4 font-normal"
          >
            <KeyIcon class_="h-6 w-6" />
            <span class="text-xs leading-tight">{m.auth_login_modal_nsec_short()}</span>
          </button>
        </div>
        {#if runtimeConfig.npubLogin?.enabled}
          <button
            data-testid="login-method-npub"
            title={m.auth_login_modal_npub()}
            onclick={() => createSigner('Npub')}
            class="btn w-full font-normal opacity-70 btn-ghost btn-sm"
          >
            {m.auth_login_modal_npub_short()}
          </button>
        {/if}
      </section>
    </div>
  </div>
</dialog>
```

Notes for the implementer:
- The `<script>` block keeps everything else exactly as-is: `createSigner`, the close-sync `$effect`, all imports (only the icons import line changes).
- The old `modal-action` footer and the `join` group are deleted.
- `navigator` is safe here: this component only mounts client-side (ModalManager renders it on `activeModal === 'login'`, which never happens during SSR).
- The comment about returning users above the methods section can be dropped — the divider + always-visible cards keep that guarantee.

- [ ] **Step 6: Run the test file — everything passes**

Run: `pnpm exec vitest run src/lib/components/__tests__/LoginModal.test.js`
Expected: PASS, all tests (4 extension-flow + 5 layout + 3 mobile).

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/LoginModal.svelte src/lib/components/__tests__/LoginModal.test.js
git commit -m "feat(login): declutter login modal into icon-card layout (#49)

Jumble-style structure with edufeed's newcomer-first hierarchy: primary
create-account CTA, Google below, existing-Nostr methods as compact icon
cards, npub demoted to a read-only ghost row, header close button instead
of the footer one. Extension card hides on mobile UAs without
window.nostr since NIP-07 extensions don't exist there.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Verification (checks, targeted e2e, visual states)

**Files:** none created — verification only.

- [ ] **Step 1: Type check + lint**

Run: `pnpm run check && pnpm run lint`
Expected: both clean. (`check` compiles paraglide, picking up the new message keys.)

- [ ] **Step 2: Full unit/component test suite**

Run: `pnpm test`
Expected: PASS. Known flaky-in-parallel files (inbox/DM) may time out — re-run those in isolation before blaming this change. Note: `pnpm test` triggers a paraglide HMR storm in any running dev server; run tests before starting the visual-check dev server.

- [ ] **Step 3: Targeted e2e (nix shell)**

Run: `pnpm run test:e2e -- npub-login`
Expected: PASS — it exercises `login-method-npub` visibility gating and the nsec fixture login (`login-method-nsec` click path). Do not run the full e2e suite; calendar specs have known-stale selectors (issue #39).

- [ ] **Step 4: Visual verification (test-all-visual-states rule)**

1. Start the dev server: `pnpm run dev` (check which server actually answers the port — stale worktree servers squat 5199+).
2. With Playwright MCP (screenshots to the scratchpad dir, absolute paths):
   - Desktop default state: open login modal (navbar "Anmelden"), screenshot.
   - Extension-error state: click the Erweiterung card in a browser without an extension, screenshot the inline alert.
   - Saved-accounts state: log in with a throwaway nsec, log out or open "Konto hinzufügen" again so the saved account row shows, screenshot.
   - Mobile layout: resize viewport to 375×700, screenshot (grid stays 3-col — viewport resize doesn't change UA; the 2-col hide is covered by unit tests).
   - Hover state of one card.
3. Compare against the spec's ASCII layout: header ✕ present, no footer button, teal CTA on top, card grid aligned.

- [ ] **Step 5: Update e2e coverage doc if needed**

`e2e/COVERAGE.md` — only if the npub-login run revealed anything changed; no new e2e tests are added by this plan.

- [ ] **Step 6: Final commit (if verification produced fixes)**

```bash
git add -A && git commit -m "fix(login): address verification findings (#49)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Only if fixes were needed; otherwise nothing to commit.
