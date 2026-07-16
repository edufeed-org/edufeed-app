# Google Login (Pomegranate) + Read-Only npub Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two env-gated login methods: read-only npub login (Phase 1, Tasks 1–5) and Google login via the Pomegranate FROST threshold signer (Phase 2, Tasks 6–13).

**Architecture:** npub login uses applesauce's already-registered `ReadonlyAccount`; write actions stay visible but prompt "read-only — log in with a signing method". Google login ports Jumble's Pomegranate client (popup OAuth on a central server, client-side key generation + FROST sharding to operator servers, then an ordinary NIP-46 bunker account through our existing `NostrConnectSigner` path). New Google users are handed to the existing signup wizard in a new `externalSignup` mode.

**Tech Stack:** SvelteKit + Svelte 5 runes, applesauce v6 (accounts/signers), nostr-tools, `@fiatjaf/promenade-trusted-dealer` (JSR), `@noble/hashes`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-16-google-and-npub-login-design.md`

## Global Constraints

- Both features default **off**: `NPUB_LOGIN_ENABLED=false`, `GOOGLE_LOGIN_ENABLED=false` (parseBool default false).
- Default central server: `https://auth.njump.me`. Default operators: `https://po.jumble.social`, `https://po.coracle.social`, `https://po.njump.me`, `https://po.f7z.io`, `https://po.nostrver.se`.
- FROST threshold is computed, never configured: `Math.ceil(operatorCount * 7 / 12)`, minimum 2 operators.
- Every user-facing string goes into BOTH `messages/en.json` and `messages/de.json` (paraglide). Never put a literal `@` directly before a `{placeholder}` in a message value (breaks svelte-check / pre-push).
- Never use nostr-tools `SimplePool`. Bunker connections go through `connectWithBunkerUrl` / `registerBunkerAccount` in `src/lib/helpers/bunker-connection.js`.
- Custom Pomegranate protocol kinds: account registration = **20445**, operator registration = **20444** (must match the deployed promenade servers).
- Work in a git worktree (see `superpowers:using-git-worktrees`); rebase the fresh worktree onto `dev` before starting, and copy `.env` from the main checkout. Run `pnpm test` / `pnpm run check` inside the nix shell.
- Read-only accounts have `account.type === 'readonly'`. Pomegranate accounts are `nostr-connect` accounts with `account.metadata.pomegranateCentral` set.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

# Phase 1 — Read-only npub login

### Task 1: Config plumbing for both login flags

**Files:**
- Modify: `src/routes/api/config/+server.js` (insert after the `membership:` block, ~line 373)
- Modify: `src/lib/stores/config.svelte.js` (three spots: `defaultConfig`, merge block in the init function, getters)
- Test: `src/lib/__tests__/api-config-login-methods.test.js`

**Interfaces:**
- Produces: `runtimeConfig.npubLogin` → `{ enabled: boolean }`; `runtimeConfig.googleLogin` → `{ enabled: boolean, centralUrl: string, operatorUrls: string[] }`. All later UI tasks gate on these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/api-config-login-methods.test.js` (same pattern as `api-config-metaclean.test.js`):

```js
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('GET /api/config — npubLogin + googleLogin', () => {
  beforeEach(() => vi.resetModules());

  it('both features are disabled by default with public-infra defaults', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.npubLogin).toEqual({ enabled: false });
    expect(body.googleLogin).toEqual({
      enabled: false,
      centralUrl: 'https://auth.njump.me',
      operatorUrls: [
        'https://po.jumble.social',
        'https://po.coracle.social',
        'https://po.njump.me',
        'https://po.f7z.io',
        'https://po.nostrver.se'
      ]
    });
  });

  it('env vars enable the features and override server URLs', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: {
        NPUB_LOGIN_ENABLED: 'true',
        GOOGLE_LOGIN_ENABLED: 'true',
        POMEGRANATE_CENTRAL_URL: 'https://auth.example.org',
        POMEGRANATE_OPERATOR_URLS: 'https://op1.example.org, https://op2.example.org'
      }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.npubLogin.enabled).toBe(true);
    expect(body.googleLogin.enabled).toBe(true);
    expect(body.googleLogin.centralUrl).toBe('https://auth.example.org');
    expect(body.googleLogin.operatorUrls).toEqual([
      'https://op1.example.org',
      'https://op2.example.org'
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/api-config-login-methods.test.js`
Expected: FAIL — `body.npubLogin` is `undefined`.

- [ ] **Step 3: Add the config blocks**

In `src/routes/api/config/+server.js`, directly after the `membership: { ... },` block:

```js
    // Read-only npub login ("browse as") — see docs/superpowers/specs/2026-07-16-google-and-npub-login-design.md
    npubLogin: {
      enabled: parseBool(env.NPUB_LOGIN_ENABLED, false)
    },

    // Google login via the Pomegranate FROST threshold signer (promenade).
    // Defaults point at the public community infrastructure; deployments can
    // self-host promenade and swap these without client changes.
    googleLogin: {
      enabled: parseBool(env.GOOGLE_LOGIN_ENABLED, false),
      centralUrl: env.POMEGRANATE_CENTRAL_URL || 'https://auth.njump.me',
      operatorUrls: parseArray(env.POMEGRANATE_OPERATOR_URLS, [
        'https://po.jumble.social',
        'https://po.coracle.social',
        'https://po.njump.me',
        'https://po.f7z.io',
        'https://po.nostrver.se'
      ])
    },
```

In `src/lib/stores/config.svelte.js` — three edits, each following the `membership` pattern exactly:

1. In `defaultConfig` (after the `membership:` entry, ~line 176):

```js
  // Read-only npub login
  npubLogin: {
    enabled: false
  },
  // Google login via Pomegranate (promenade FROST threshold signer)
  googleLogin: {
    enabled: false,
    centralUrl: 'https://auth.njump.me',
    /** @type {string[]} */
    operatorUrls: [
      'https://po.jumble.social',
      'https://po.coracle.social',
      'https://po.njump.me',
      'https://po.f7z.io',
      'https://po.nostrver.se'
    ]
  },
```

2. In the merge block (after the `membership: { ... },` merge, ~line 330 — the incoming object uses the same variable name as the surrounding merges):

```js
    npubLogin: {
      ...defaultConfig.npubLogin,
      ...runtimeConfig.npubLogin
    },
    googleLogin: {
      ...defaultConfig.googleLogin,
      ...runtimeConfig.googleLogin
    },
```

3. In the getters (after `get membership()`, ~line 434):

```js
  get npubLogin() {
    return config.npubLogin;
  },
  get googleLogin() {
    return config.googleLogin;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/api-config-login-methods.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Document the env vars**

Add to `.env.example` (if the repo has one — check with `ls .env.example`; skip silently if absent):

```bash
# Read-only npub login (browse as any pubkey, no signing)
NPUB_LOGIN_ENABLED=false
# Google login via Pomegranate/promenade FROST threshold signer
GOOGLE_LOGIN_ENABLED=false
# POMEGRANATE_CENTRAL_URL=https://auth.njump.me
# POMEGRANATE_OPERATOR_URLS=https://po.jumble.social,https://po.coracle.social,https://po.njump.me,https://po.f7z.io,https://po.nostrver.se
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/config/+server.js src/lib/stores/config.svelte.js src/lib/__tests__/api-config-login-methods.test.js .env.example
git commit -m "feat(config): env flags for npub + Google (Pomegranate) login"
```

---

### Task 2: `canSign` guard helper + readonly signer hardening + DM-init skip

**Files:**
- Create: `src/lib/helpers/signing-guard.js`
- Modify: `src/lib/stores/accounts.svelte.js` (extend `hardenExtensionAccounts`, add `wrapReadonlySigner`, guard Step 10 DM init ~line 358)
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/__tests__/signing-guard.test.js`

**Interfaces:**
- Produces: `canSign(account) → boolean` (false for null/readonly); `requireSigningOrToast(account) → boolean` (shows warning toast when a readonly account is passed; no toast for null — anonymous flows keep their existing login prompts). `wrapReadonlySigner(signer)` exported from accounts store for tests.
- Consumes: `showToast` from `$lib/helpers/toast.js`, `TIMEOUT_WRAPPED` symbol pattern already in `accounts.svelte.js`.

- [ ] **Step 1: Add i18n messages**

In `messages/en.json` (alphabetical vicinity of other `readonly`/`auth` keys is fine; the file is flat):

```json
"readonly_sign_prompt": "You are browsing read-only — log in with a signing method to do this.",
"auth_readonly_account_type": "read-only",
```

In `messages/de.json`:

```json
"readonly_sign_prompt": "Du bist im Nur-Lese-Modus — melde dich mit einer Signaturmethode an, um das zu tun.",
"auth_readonly_account_type": "nur lesen",
```

Run `pnpm run dev` briefly or `pnpm run check` later to let paraglide compile the new messages (the compiled functions are generated from these JSONs).

- [ ] **Step 2: Write the failing tests**

Create `src/lib/__tests__/signing-guard.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const showToast = vi.fn();
vi.mock('$lib/helpers/toast.js', () => ({ showToast: (...args) => showToast(...args) }));
vi.mock('$lib/paraglide/messages', () => ({
  readonly_sign_prompt: () => 'read-only prompt'
}));

describe('signing-guard', () => {
  beforeEach(() => showToast.mockClear());

  it('canSign is true for signing account types', async () => {
    const { canSign } = await import('../helpers/signing-guard.js');
    expect(canSign({ type: 'extension' })).toBe(true);
    expect(canSign({ type: 'nostr-connect' })).toBe(true);
    expect(canSign({ type: 'nsec' })).toBe(true);
  });

  it('canSign is false for readonly and missing accounts', async () => {
    const { canSign } = await import('../helpers/signing-guard.js');
    expect(canSign({ type: 'readonly' })).toBe(false);
    expect(canSign(null)).toBe(false);
    expect(canSign(undefined)).toBe(false);
  });

  it('requireSigningOrToast toasts only for readonly accounts', async () => {
    const { requireSigningOrToast } = await import('../helpers/signing-guard.js');
    expect(requireSigningOrToast({ type: 'readonly' })).toBe(false);
    expect(showToast).toHaveBeenCalledWith('read-only prompt', 'warning');
    showToast.mockClear();
    expect(requireSigningOrToast(null)).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    expect(requireSigningOrToast({ type: 'extension' })).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });
});
```

Also append to the same file (tests the accounts-store hardening; `accounts.queue.test.js` shows accounts.svelte.js is importable in node tests):

```js
describe('wrapReadonlySigner via hardenExtensionAccounts', () => {
  it('readonly signer signEvent toasts and rejects', async () => {
    const { hardenExtensionAccounts } = await import('../stores/accounts.svelte.js');
    const throwingSigner = {
      getPublicKey: () => 'ab'.repeat(32),
      signEvent: () => {
        throw new Error('Cant sign events with readonly signer');
      }
    };
    const account = { type: 'readonly', signer: throwingSigner };
    hardenExtensionAccounts([account]);
    expect(account.signer).not.toBe(throwingSigner);
    await expect(account.signer.signEvent({ kind: 1 })).rejects.toThrow(/read-only/);
    expect(showToast).toHaveBeenCalledWith('read-only prompt', 'warning');
    // Idempotent — re-running must not double-wrap.
    const wrapped = account.signer;
    hardenExtensionAccounts([account]);
    expect(account.signer).toBe(wrapped);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/signing-guard.test.js`
Expected: FAIL — `signing-guard.js` does not exist.

- [ ] **Step 4: Implement**

Create `src/lib/helpers/signing-guard.js`:

```js
/**
 * Write-action gating for read-only (npub) accounts.
 *
 * UX decision (spec 2026-07-16): write CTAs stay VISIBLE for readonly
 * accounts; activating one shows an upgrade prompt instead of doing nothing.
 * Anonymous users (no account) are NOT toasted here — those flows keep their
 * existing "please log in" behavior.
 */
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';

/**
 * Whether this account can produce signatures.
 * @param {{ type?: string } | null | undefined} account
 * @returns {boolean}
 */
export function canSign(account) {
  return !!account && account.type !== 'readonly';
}

/**
 * Guard for write-action entry points. Shows the read-only upgrade toast when
 * the account is readonly. Returns true when the action may proceed.
 * @param {{ type?: string } | null | undefined} account
 * @returns {boolean}
 */
export function requireSigningOrToast(account) {
  if (canSign(account)) return true;
  if (account) showToast(m.readonly_sign_prompt(), 'warning');
  return false;
}
```

In `src/lib/stores/accounts.svelte.js`:

1. Add imports at the top (below the existing imports):

```js
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';
```

2. Add `wrapReadonlySigner` next to `wrapBunkerSigner` (after its closing brace):

```js
/**
 * Wrap a ReadonlySigner so a missed UI gate surfaces the upgrade toast instead
 * of a silent console error. ReadonlySigner.signEvent always throws; this adds
 * the user-facing prompt in front of that throw as a safety net for any write
 * CTA the explicit requireSigningOrToast() guards don't cover.
 *
 * @template {object} T
 * @param {T} signer
 * @returns {T}
 */
export function wrapReadonlySigner(signer) {
  return new Proxy(signer, {
    get(target, prop) {
      if (prop === TIMEOUT_WRAPPED) return true;
      if (prop === 'signEvent') {
        return () => {
          showToast(m.readonly_sign_prompt(), 'warning');
          return Promise.reject(new Error('This account is read-only and cannot sign events'));
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}
```

3. In `hardenExtensionAccounts`, add a third branch after the `nostr-connect` branch:

```js
    } else if (account.type === 'readonly') {
      if (account.signer && !account.signer[TIMEOUT_WRAPPED]) {
        account.signer = wrapReadonlySigner(account.signer);
      }
    }
```

4. In Step 10 (DM init, ~line 358), change the condition — gift-wrap decryption needs nip44, which a readonly account cannot do:

```js
    if (account && account.signer && account.type !== 'readonly') {
      initializeDMs(account.pubkey, account.signer);
    } else {
      cleanup();
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/signing-guard.test.js src/lib/__tests__/accounts.queue.test.js`
Expected: PASS (new tests + no regression in the existing queue tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/helpers/signing-guard.js src/lib/stores/accounts.svelte.js src/lib/__tests__/signing-guard.test.js messages/en.json messages/de.json
git commit -m "feat(auth): canSign guard + readonly signer hardening + DM-init skip"
```

---

### Task 3: LoginWithNpub component + modal wiring

**Files:**
- Create: `src/lib/components/LoginWithNpub.svelte`
- Modify: `src/lib/stores/modal.svelte.js` (ModalType typedef, line 2)
- Modify: `src/lib/components/ModalManager.svelte` (import, modal id, open/close branches, render branch, transition handlers)
- Modify: `src/lib/components/LoginModal.svelte` (new method button + transition prop)
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/LoginWithNpub.test.js`

**Interfaces:**
- Consumes: `runtimeConfig.npubLogin.enabled` (Task 1), `ReadonlyAccount` from `applesauce-accounts/accounts` (`ReadonlyAccount.fromPubkey(npubOrHex)`).
- Produces: modal type `'npubLogin'`; `LoginWithNpub` props `{ modalId, onAccountCreated }`; LoginModal prop `onNpubTransition`; testids `login-method-npub`, `npub-input`, `npub-login-submit`.

- [ ] **Step 1: Add i18n messages**

`messages/en.json`:

```json
"auth_login_modal_npub": "Browse with a public key (npub…) — read-only",
"auth_login_npub_title": "Browse read-only",
"auth_login_npub_description": "Enter a public key (npub or hex). You can browse as this account, but not post, react, or read direct messages.",
"auth_login_npub_label": "Public key",
"auth_login_npub_placeholder": "npub1…",
"auth_login_npub_error_invalid": "This is not a valid npub or hex public key",
"auth_login_npub_already_added": "This account was already added — switched to it.",
"auth_login_npub_button": "Browse read-only",
```

`messages/de.json`:

```json
"auth_login_modal_npub": "Mit öffentlichem Schlüssel stöbern (npub…) — nur lesen",
"auth_login_npub_title": "Nur-Lese-Modus",
"auth_login_npub_description": "Öffentlichen Schlüssel (npub oder hex) eingeben. Du kannst mit diesem Konto stöbern, aber nicht posten, reagieren oder Direktnachrichten lesen.",
"auth_login_npub_label": "Öffentlicher Schlüssel",
"auth_login_npub_placeholder": "npub1…",
"auth_login_npub_error_invalid": "Kein gültiger npub oder hex-Schlüssel",
"auth_login_npub_already_added": "Dieses Konto war bereits vorhanden — es ist jetzt aktiv.",
"auth_login_npub_button": "Nur lesend anmelden",
```

- [ ] **Step 2: Write the failing component test**

Create `src/lib/components/__tests__/LoginWithNpub.test.js`:

```js
// @ts-nocheck
/**
 * LoginWithNpub — read-only npub login form.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import LoginWithNpub from '../LoginWithNpub.svelte';

const PUBKEY = 'ee11a5dff40c19a555f41fe42b48f00e618c91225622ae37b6c2bb67b76c4e49';
const NPUB = nip19.npubEncode(PUBKEY);

const mockManager = vi.hoisted(() => ({
  getAccountForPubkey: vi.fn(() => null),
  addAccount: vi.fn(),
  setActive: vi.fn()
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));

const mockModalStore = vi.hoisted(() => ({
  activeModal: 'npubLogin',
  openModal: vi.fn(),
  closeModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

vi.mock('$lib/paraglide/messages', () => ({
  auth_login_npub_title: () => 'Browse read-only',
  auth_login_npub_description: () => 'desc',
  auth_login_npub_label: () => 'Public key',
  auth_login_npub_placeholder: () => 'npub1…',
  auth_login_npub_error_invalid: () => 'invalid key',
  auth_login_npub_already_added: () => 'already added',
  auth_login_npub_button: () => 'Browse read-only',
  common_close: () => 'Close'
}));

describe('LoginWithNpub', () => {
  beforeEach(() => {
    mockManager.getAccountForPubkey.mockReset().mockReturnValue(null);
    mockManager.addAccount.mockReset();
    mockManager.setActive.mockReset();
  });

  it('rejects an invalid key with an inline error', async () => {
    const { getByTestId, getByText } = render(LoginWithNpub, { modalId: 't1' });
    await fireEvent.input(getByTestId('npub-input'), { target: { value: 'not-a-key' } });
    await fireEvent.submit(getByTestId('npub-login-form'));
    expect(getByText('invalid key')).toBeTruthy();
    expect(mockManager.addAccount).not.toHaveBeenCalled();
  });

  it('adds and activates a ReadonlyAccount for a valid npub', async () => {
    const { getByTestId } = render(LoginWithNpub, { modalId: 't2' });
    await fireEvent.input(getByTestId('npub-input'), { target: { value: NPUB } });
    await fireEvent.submit(getByTestId('npub-login-form'));
    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    const account = mockManager.addAccount.mock.calls[0][0];
    expect(account.type).toBe('readonly');
    expect(account.pubkey).toBe(PUBKEY);
    expect(mockManager.setActive).toHaveBeenCalledWith(account);
  });

  it('accepts a 64-char hex pubkey', async () => {
    const { getByTestId } = render(LoginWithNpub, { modalId: 't3' });
    await fireEvent.input(getByTestId('npub-input'), { target: { value: PUBKEY } });
    await fireEvent.submit(getByTestId('npub-login-form'));
    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
  });

  it('activates the existing account instead of duplicating', async () => {
    const existing = { id: 'x', pubkey: PUBKEY, type: 'readonly' };
    mockManager.getAccountForPubkey.mockReturnValue(existing);
    const { getByTestId, getByText } = render(LoginWithNpub, { modalId: 't4' });
    await fireEvent.input(getByTestId('npub-input'), { target: { value: NPUB } });
    await fireEvent.submit(getByTestId('npub-login-form'));
    expect(mockManager.addAccount).not.toHaveBeenCalled();
    expect(mockManager.setActive).toHaveBeenCalledWith(existing);
    expect(getByText('already added')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/LoginWithNpub.test.js`
Expected: FAIL — component does not exist.

- [ ] **Step 4: Create the component**

Create `src/lib/components/LoginWithNpub.svelte` (mirrors `LoginWithPrivateKey.svelte` structure):

```svelte
<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { ReadonlyAccount } from 'applesauce-accounts/accounts';
  import { nip19 } from 'nostr-tools';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import * as m from '$lib/paraglide/messages';

  let { modalId, onAccountCreated } = $props();

  let input = $state('');
  let errorMessage = $state('');
  let infoMessage = $state('');

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let closeTimer;

  // Sync modal close with store state (same pattern as LoginWithPrivateKey).
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;
    const handleDialogClose = () => {
      if (modalStore.activeModal === 'npubLogin') {
        modalStore.closeModal();
      }
    };
    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = undefined;
      }
    };
  });

  /**
   * Normalize npub or 64-char hex input to a hex pubkey, or null when invalid.
   * @param {string} value
   * @returns {string | null}
   */
  function normalizeToHex(value) {
    const trimmed = value.trim();
    if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
    if (!trimmed.startsWith('npub1')) return null;
    try {
      const decoded = nip19.decode(trimmed);
      return decoded.type === 'npub' ? /** @type {string} */ (decoded.data) : null;
    } catch {
      return null;
    }
  }

  /** @param {SubmitEvent} event */
  function handleSubmit(event) {
    event.preventDefault();
    errorMessage = '';
    infoMessage = '';

    const pubkey = normalizeToHex(input);
    if (!pubkey) {
      errorMessage = m.auth_login_npub_error_invalid();
      return;
    }

    // Add-or-activate: setActive looks accounts up by id, so an existing
    // pubkey must reuse the EXISTING account reference (see LoginWithPrivateKey).
    const existing = manager.getAccountForPubkey(pubkey);
    if (existing) {
      manager.setActive(existing);
      infoMessage = m.auth_login_npub_already_added();
    } else {
      const account = ReadonlyAccount.fromPubkey(pubkey);
      manager.addAccount(account);
      manager.setActive(account);
    }

    if (onAccountCreated) onAccountCreated();

    const modal = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (modal) {
      if (existing) {
        closeTimer = setTimeout(() => modal.close?.(), 1200);
      } else {
        modal.close?.();
      }
    }
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box">
    <h1 class="text-lg font-bold">{m.auth_login_npub_title()}</h1>
    <p class="py-4">{m.auth_login_npub_description()}</p>

    <form class="space-y-4" data-testid="npub-login-form" onsubmit={handleSubmit}>
      <div class="form-control">
        <label class="label" for="npub-input">
          <span class="label-text">{m.auth_login_npub_label()}</span>
        </label>
        <input
          id="npub-input"
          data-testid="npub-input"
          bind:value={input}
          type="text"
          autocomplete="off"
          placeholder={m.auth_login_npub_placeholder()}
          class="input-bordered input w-full"
          class:input-error={errorMessage}
        />
      </div>

      {#if infoMessage}
        <div class="alert alert-info"><span>{infoMessage}</span></div>
      {/if}
      {#if errorMessage}
        <div class="alert alert-error"><span>{errorMessage}</span></div>
      {/if}

      <button type="submit" data-testid="npub-login-submit" class="btn w-full btn-primary">
        {m.auth_login_npub_button()}
      </button>
    </form>

    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{m.common_close()}</button>
      </form>
    </div>
  </div>
</dialog>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/components/__tests__/LoginWithNpub.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire the modal type, manager, and login button**

1. `src/lib/stores/modal.svelte.js` line 2 — extend the `ModalType` union with `'npubLogin'` (and `'googleLogin'` now, saving a Phase-2 edit):

```js
 * @typedef {'none' | 'login' | 'privateKey' | 'bunker' | 'npubLogin' | 'googleLogin' | 'settings' | 'profile' | 'eventDetails' | 'createCalendar' | 'calendarEvent' | 'signup' | 'createCommunity' | 'editCommunity' | 'deleteCommunity' | 'webcalQRCode' | 'communityMigration' | 'addBookmark' | 'shareByNaddr' | 'reportMetadata' | 'createRoom' | 'joinRoom' | 'createPoll' | 'createNote' | 'recovery-download' | 'resourceVariantPicker' | 'inviteToEvent'} ModalType
```

2. `src/lib/components/ModalManager.svelte`:

```js
import LoginWithNpub from './LoginWithNpub.svelte';
// with the other modal ids:
const npubLoginModalId = 'global-npub-login-modal';
```

In the `$effect`'s `currentModal === 'none'` branch, add (next to the bunker close):

```js
      const npubLoginModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(npubLoginModalId)
      );
      if (npubLoginModal && npubLoginModal.open) {
        npubLoginModal.close();
      }
```

Add an open branch (after the `'bunker'` branch):

```js
    } else if (currentModal === 'npubLogin') {
      const npubLoginModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(npubLoginModalId)
      );
      if (npubLoginModal && !npubLoginModal.open) {
        npubLoginModal.showModal();
      }
```

Add transition handlers (next to `handleBunkerTransition`):

```js
  function handleNpubTransition() {
    modal.transitionModal('login', 'npubLogin');
  }

  function handleNpubAccountCreated() {
    modal.transitionModal('npubLogin', 'login');
  }
```

Add the render branch (after the `'bunker'` render branch):

```svelte
{:else if modal.activeModal === 'npubLogin'}
  <LoginWithNpub modalId={npubLoginModalId} onAccountCreated={handleNpubAccountCreated} />
```

And pass the new prop to LoginModal:

```svelte
  <LoginModal
    modalId={loginModalId}
    onNSECTransition={handleNSECTransition}
    onBunkerTransition={handleBunkerTransition}
    onNpubTransition={handleNpubTransition}
  />
```

3. `src/lib/components/LoginModal.svelte`:

```js
let { modalId, onNSECTransition, onBunkerTransition, onNpubTransition } = $props();
import { runtimeConfig } from '$lib/stores/config.svelte.js';
```

In `createSigner`, add a case before `default`:

```js
      case 'Npub':
        if (onNpubTransition) {
          onNpubTransition();
        }
        return null;
```

In the method-buttons `join` div, after the extension button:

```svelte
          {#if runtimeConfig.npubLogin?.enabled}
            <button
              data-testid="login-method-npub"
              onclick={() => createSigner('Npub')}
              class="btn join-item"
            >
              {m.auth_login_modal_npub()}
            </button>
          {/if}
```

- [ ] **Step 7: Verify by hand + typecheck**

Run: `pnpm run check` — expected: no new errors.
Run the dev server with `NPUB_LOGIN_ENABLED=true` in `.env`, open the login modal, log in with any npub (e.g. from a profile page on njump.me), confirm the app browses as that account. Check both the enabled and disabled (`false` → button absent) states.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/LoginWithNpub.svelte src/lib/components/ModalManager.svelte src/lib/components/LoginModal.svelte src/lib/stores/modal.svelte.js src/lib/components/__tests__/LoginWithNpub.test.js messages/en.json messages/de.json
git commit -m "feat(auth): read-only npub login behind NPUB_LOGIN_ENABLED"
```

---

### Task 4: Readonly badges, notices, and write-CTA guards

**Files:**
- Create: `src/lib/components/shared/ReadonlyNotice.svelte`
- Modify: `src/lib/components/AccountProfile.svelte` (badge next to the nostr-connect badge)
- Modify: `src/lib/components/shared/AccountMenuSection.svelte` (badge in identity header)
- Modify: `src/lib/components/shared/GlobalFAB.svelte` (guard in `runAction`)
- Modify: `src/lib/stores/educational-actions.svelte.js` (extend both "No account selected" gates)
- Modify: `src/routes/inbox/+page.svelte` (mount ReadonlyNotice at top of the page content)
- Test: `src/lib/components/__tests__/ReadonlyNotice.test.js`

**Interfaces:**
- Consumes: `canSign` / `requireSigningOrToast` (Task 2), `m.auth_readonly_account_type()` / `m.readonly_sign_prompt()` (Task 2), `manager.active$`.
- Produces: `ReadonlyNotice` component (no props, self-subscribes; renders testid `readonly-notice` only for readonly active accounts) — the Phase-1 E2E test (Task 5) asserts on this testid.

- [ ] **Step 1: Write the failing ReadonlyNotice test**

Create `src/lib/components/__tests__/ReadonlyNotice.test.js`:

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';

const active$ = new BehaviorSubject(null);
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active$ } }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: { active$ } }));
vi.mock('$lib/paraglide/messages', () => ({
  readonly_sign_prompt: () => 'read-only prompt'
}));

import ReadonlyNotice from '../shared/ReadonlyNotice.svelte';

describe('ReadonlyNotice', () => {
  it('renders nothing for signing accounts', () => {
    active$.next({ type: 'extension', pubkey: 'a'.repeat(64) });
    const { queryByTestId } = render(ReadonlyNotice);
    expect(queryByTestId('readonly-notice')).toBeNull();
  });

  it('renders the notice for a readonly account', async () => {
    active$.next({ type: 'readonly', pubkey: 'a'.repeat(64) });
    const { findByTestId } = render(ReadonlyNotice);
    expect(await findByTestId('readonly-notice')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/ReadonlyNotice.test.js`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement all pieces**

Create `src/lib/components/shared/ReadonlyNotice.svelte`:

```svelte
<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';

  let activeAccount = $state(/** @type {any} */ (null));

  $effect(() => {
    const sub = manager.active$.subscribe((account) => {
      activeAccount = account;
    });
    return () => sub.unsubscribe();
  });
</script>

{#if activeAccount?.type === 'readonly'}
  <div class="alert mb-4 alert-warning" data-testid="readonly-notice" role="status">
    <span class="text-sm">{m.readonly_sign_prompt()}</span>
  </div>
{/if}
```

`src/lib/components/AccountProfile.svelte` — after the existing `nostr-connect` badge block:

```svelte
    {#if account.type === 'readonly'}
      <span class="ml-1 badge badge-outline badge-sm badge-warning"
        >{m.auth_readonly_account_type()}</span
      >
    {/if}
```

`src/lib/components/shared/AccountMenuSection.svelte` — inside the identity-header `<a>`, after the display-name `<span>`:

```svelte
      {#if activeAccount.type === 'readonly'}
        <span class="badge badge-outline badge-sm badge-warning" data-testid="readonly-badge"
          >{m.auth_readonly_account_type()}</span
        >
      {/if}
```

`src/lib/components/shared/GlobalFAB.svelte` — add imports and guard `runAction`:

```js
import { manager } from '$lib/stores/accounts.svelte';
import { requireSigningOrToast } from '$lib/helpers/signing-guard.js';
```

```js
  /** @param {import('$lib/config/create-actions.js').CreateAction} action */
  function runAction(action) {
    // Readonly accounts get the upgrade prompt; anonymous users keep the
    // existing per-action behavior (login prompts inside the flows).
    if (manager.active && !requireSigningOrToast(manager.active)) {
      close();
      return;
    }
    action.run({
      // …existing body unchanged…
    });
    close();
  }
```

`src/lib/stores/educational-actions.svelte.js` — both existing gates (`~lines 197-199` and `~292-294`) become:

```js
    const currentAccount = manager.active;
    if (!currentAccount) {
      throw new Error('No account selected. Please log in to create resources.');
    }
    if (!canSign(currentAccount)) {
      throw new Error('This account is read-only. Log in with a signing method to create resources.');
    }
```

with `import { canSign } from '$lib/helpers/signing-guard.js';` added to the imports.

`src/routes/inbox/+page.svelte` — import `ReadonlyNotice` and render it at the top of the page's main content container (first child inside the outermost content wrapper):

```svelte
import ReadonlyNotice from '$lib/components/shared/ReadonlyNotice.svelte';
```

```svelte
<ReadonlyNotice />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/components/__tests__/ReadonlyNotice.test.js src/lib/components/__tests__/AccountMenuSection.test.js`
Expected: PASS, no regressions.

- [ ] **Step 5: Typecheck + visual spot-check**

Run: `pnpm run check` — no new errors.
Dev server: log in with an npub → FAB action shows the toast, inbox shows the notice, account menu + login modal account list show the "read-only" badge. Also verify a normal (nsec/extension) account shows NO badge/notice.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/shared/ReadonlyNotice.svelte src/lib/components/AccountProfile.svelte src/lib/components/shared/AccountMenuSection.svelte src/lib/components/shared/GlobalFAB.svelte src/lib/stores/educational-actions.svelte.js src/routes/inbox/+page.svelte src/lib/components/__tests__/ReadonlyNotice.test.js
git commit -m "feat(auth): readonly badges, inbox notice, write-CTA guards"
```

---

### Task 5: Phase-1 E2E test + coverage doc

**Files:**
- Create: `e2e/npub-login.test.js`
- Modify: `e2e/COVERAGE.md`

**Interfaces:**
- Consumes: testids `login-method-npub`, `npub-input`, `npub-login-form` (Task 3), `readonly-notice` (Task 4). Enables the flag per-test by intercepting `/api/config` (the dev server's `.env` doesn't need the flag).

- [ ] **Step 1: Write the E2E test**

Create `e2e/npub-login.test.js`:

```js
/**
 * E2E: read-only npub login (NPUB_LOGIN_ENABLED).
 * The feature flag is injected by intercepting /api/config, so the test is
 * independent of the dev server's .env.
 */
import { test, expect } from '@playwright/test';
import { nip19 } from 'nostr-tools';

const PUBKEY = 'ee11a5dff40c19a555f41fe42b48f00e618c91225622ae37b6c2bb67b76c4e49';
const NPUB = nip19.npubEncode(PUBKEY);

/** Enable npubLogin in the runtime config for this page. */
async function enableNpubLogin(page) {
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.npubLogin = { enabled: true };
    await route.fulfill({ response, json });
  });
}

test.describe('npub read-only login', () => {
  test('npub method hidden when flag disabled', async ({ page }) => {
    await page.goto('/');
    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="login-method-npub"]')).toHaveCount(0);
  });

  test('login with npub, see readonly notice in inbox', async ({ page }) => {
    await enableNpubLogin(page);
    await page.goto('/');
    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="login-method-npub"]').click();
    await expect(page.locator('#global-npub-login-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="npub-input"]').fill(NPUB);
    await page.locator('[data-testid="npub-login-submit"]').click();

    // Modal chain closes after successful add + transition back.
    await expect(page.locator('#global-npub-login-modal')).not.toBeVisible({ timeout: 5000 });

    await page.goto('/inbox');
    await expect(page.locator('[data-testid="readonly-notice"]')).toBeVisible({ timeout: 10000 });
  });

  test('invalid input shows inline error', async ({ page }) => {
    await enableNpubLogin(page);
    await page.goto('/');
    await page.locator('button:has-text("Login")').first().click();
    await page.locator('[data-testid="login-method-npub"]').click();
    await page.locator('[data-testid="npub-input"]').fill('npub1notvalid');
    await page.locator('[data-testid="npub-login-submit"]').click();
    await expect(page.locator('#global-npub-login-modal .alert-error')).toBeVisible();
  });
});
```

Note: after `onAccountCreated` the modal transitions back to `'login'`, so the login modal may re-open — if the second assertion is flaky, assert on `#global-login-modal` visibility instead and close it with Escape before navigating.

- [ ] **Step 2: Run the test**

Run (inside the nix shell): `pnpm run test:e2e -- npub-login.test.js`
Expected: 3 passed.

- [ ] **Step 3: Update coverage doc**

Add to `e2e/COVERAGE.md` under the account-management section:

```markdown
- `npub-login.test.js` — read-only npub login: flag-off hides the method; flag-on login via npub → readonly notice on /inbox; invalid input error. (Flag injected via /api/config route interception.)
```

- [ ] **Step 4: Commit**

```bash
git add e2e/npub-login.test.js e2e/COVERAGE.md
git commit -m "test(e2e): npub read-only login flow"
```

**Phase 1 checkpoint:** run `pnpm test` and `pnpm run check`; all green. This is a shippable increment.

---

# Phase 2 — Google login (Pomegranate)

### Task 6: Dependencies (JSR registry + packages)

**Files:**
- Modify: `.npmrc`, `package.json` (via pnpm)

**Interfaces:**
- Produces: importable `@fiatjaf/promenade-trusted-dealer` (functions: `trustedKeyDeal`, `hexShard`, `hexPubShard`, `decodeShard`, `aggregateSecretKeyShards`) and `@noble/hashes` (`sha256`, `bytesToHex`, `hexToBytes`).

- [ ] **Step 1: Add the JSR registry line**

Append to `.npmrc`:

```
@jsr:registry=https://npm.jsr.io
```

- [ ] **Step 2: Install packages**

```bash
pnpm add @fiatjaf/promenade-trusted-dealer@npm:@jsr/fiatjaf__promenade-trusted-dealer@^0.4.3 @noble/hashes
```

- [ ] **Step 3: Verify the import resolves**

```bash
node -e "import('@fiatjaf/promenade-trusted-dealer').then(m => console.log(Object.keys(m)))"
```

Expected output includes: `trustedKeyDeal`, `hexShard`, `hexPubShard`, `decodeShard`, `aggregateSecretKeyShards`.

- [ ] **Step 4: Commit**

```bash
git add .npmrc package.json pnpm-lock.yaml
git commit -m "chore(deps): promenade trusted-dealer (JSR) + @noble/hashes"
```

Note: if working in a worktree, run `pnpm install` in the MAIN checkout too before pushing — the pre-push hook runs there.

---

### Task 7: Pomegranate service — pure helpers

**Files:**
- Create: `src/lib/services/pomegranate.js`
- Test: `src/lib/__tests__/pomegranate-helpers.test.js`

**Interfaces:**
- Produces (all exported from `src/lib/services/pomegranate.js`):
  - `massageURL(input: string) → string` — normalizes to origin (`https://x.y/` → `https://x.y`, bare host gets `https://`)
  - `defaultThreshold(operatorCount: number) → number` — `Math.ceil(n * 7 / 12)`
  - `decodeGoogleToken(raw: string) → { raw, email, createdAt }` — throws on malformed/expired (24 h)
  - `buildBunkerUrl(central: string, profile: { handler_pubkey: string }) → string`
  - `operatorToken(session: string, operatorUrl: string) → string` — hex sha256 of `` `${session}:${operatorUrl}` ``
  - Error classes: `PomegranatePopupBlockedError`, `PomegranatePopupClosedError`, `PomegranatePubkeyMismatchError`
- Reference implementation: Jumble's `src/services/pomegranate.service.ts` (researched; the protocol constants and shapes below are copied from it).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/pomegranate-helpers.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  massageURL,
  defaultThreshold,
  decodeGoogleToken,
  buildBunkerUrl,
  operatorToken
} from '../services/pomegranate.js';

/** Build a base64 token like the central server posts back. */
function makeRawToken({ createdAtSec, email }) {
  return btoa(
    JSON.stringify({ created_at: createdAtSec, tags: email ? [['email', email]] : [] })
  );
}

describe('pomegranate pure helpers', () => {
  it('massageURL normalizes to origin', () => {
    expect(massageURL('https://auth.njump.me/')).toBe('https://auth.njump.me');
    expect(massageURL('auth.njump.me')).toBe('https://auth.njump.me');
    expect(massageURL(' https://po.f7z.io/some/path ')).toBe('https://po.f7z.io');
    expect(massageURL('localhost:8080')).toBe('http://localhost:8080');
  });

  it('defaultThreshold is ceil(7n/12)', () => {
    expect(defaultThreshold(5)).toBe(3);
    expect(defaultThreshold(2)).toBe(2);
    expect(defaultThreshold(3)).toBe(2);
    expect(defaultThreshold(12)).toBe(7);
  });

  it('decodeGoogleToken extracts email and createdAt', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const raw = makeRawToken({ createdAtSec: nowSec, email: 'a@b.c' });
    const token = decodeGoogleToken(raw);
    expect(token.email).toBe('a@b.c');
    expect(token.raw).toBe(raw);
    expect(token.createdAt).toBe(nowSec * 1000);
  });

  it('decodeGoogleToken rejects expired (>24h) tokens', () => {
    const oldSec = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
    expect(() => decodeGoogleToken(makeRawToken({ createdAtSec: oldSec, email: 'a@b.c' }))).toThrow(
      /expired/
    );
  });

  it('decodeGoogleToken rejects garbage', () => {
    expect(() => decodeGoogleToken('not-base64-json')).toThrow(/Invalid/);
  });

  it('buildBunkerUrl swaps scheme to ws and encodes the relay', () => {
    expect(buildBunkerUrl('https://auth.njump.me', { handler_pubkey: 'ab'.repeat(32) })).toBe(
      `bunker://${'ab'.repeat(32)}?relay=${encodeURIComponent('wss://auth.njump.me')}`
    );
  });

  it('operatorToken is a 64-char hex digest and varies by input', () => {
    const t1 = operatorToken('session-a', 'https://op1');
    const t2 = operatorToken('session-a', 'https://op2');
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/pomegranate-helpers.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/services/pomegranate.js` with this content (the network half is added in Task 8):

```js
/**
 * Pomegranate — client for the promenade FROST threshold-signer protocol
 * ("Login with Google"). Ported from Jumble's pomegranate.service.ts.
 *
 * Flow: a random Nostr key is generated in the browser, split into FROST
 * shards (trusted dealer) and distributed to independent operator servers.
 * Google OAuth (run by the central server in a popup) only proves identity
 * for registration, login lookup, and shard recovery. After setup the account
 * is an ordinary NIP-46 bunker account; the central server coordinates
 * threshold partial signatures.
 *
 * Spec: docs/superpowers/specs/2026-07-16-google-and-npub-login-design.md
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

/** A Google auth token is valid for 24h on the central server. */
const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const utf8 = new TextEncoder();

/** Nostr event kinds for the pomegranate registration protocol. */
export const KIND_ACCOUNT_REGISTRATION = 20445;
export const KIND_OPERATOR_REGISTRATION = 20444;

/**
 * @typedef {{ url: string, pubshard: string }} PomegranateOperator
 * @typedef {{ email: string, pubkey: string, operators: PomegranateOperator[], threshold: number }} PomegranateAccount
 * @typedef {{ handler_pubkey: string, name: string, email: string }} PomegranateProfile
 * @typedef {{ raw: string, email: string, createdAt: number }} GoogleToken
 */

/** The browser blocked `window.open` — usually a popup-blocker setting. */
export class PomegranatePopupBlockedError extends Error {
  constructor() {
    super('Popup was blocked');
    this.name = 'PomegranatePopupBlockedError';
  }
}

/** The user closed the popup before it posted a result back. */
export class PomegranatePopupClosedError extends Error {
  constructor() {
    super('Popup was closed');
    this.name = 'PomegranatePopupClosedError';
  }
}

/** The Google account is linked to a different pubkey than expected. */
export class PomegranatePubkeyMismatchError extends Error {
  constructor() {
    super('This Google account is linked to a different Nostr account');
    this.name = 'PomegranatePubkeyMismatchError';
  }
}

/**
 * Normalize a URL to its origin (drops path, trailing slash; bare hosts get
 * https://, localhost gets http://).
 * @param {string} input
 * @returns {string}
 */
export function massageURL(input) {
  let url = input.trim();
  if (!url.startsWith('http')) {
    url = 'http' + (url.startsWith('localhost') ? '' : 's') + '://' + url;
  }
  return new URL(url).origin;
}

/**
 * Default FROST signing threshold for a given operator count.
 * @param {number} operatorCount
 * @returns {number}
 */
export function defaultThreshold(operatorCount) {
  return Math.ceil((operatorCount * 7) / 12);
}

/**
 * Decode + validate the base64 identity token posted back by the central
 * server's Google popup (a Nostr-event-shaped JSON with created_at + email tag).
 * @param {string} raw
 * @returns {GoogleToken}
 */
export function decodeGoogleToken(raw) {
  let createdAt = null;
  let email = '';
  try {
    const parsed = JSON.parse(atob(raw));
    if (typeof parsed.created_at === 'number') {
      createdAt = parsed.created_at * 1000;
    }
    if (Array.isArray(parsed.tags)) {
      const emailTag = parsed.tags.find(
        (tag) => Array.isArray(tag) && tag.length > 1 && tag[0] === 'email'
      );
      email = typeof emailTag?.[1] === 'string' ? emailTag[1] : '';
    }
  } catch {
    throw new Error('Invalid Google sign-in token');
  }
  if (createdAt === null || Date.now() - createdAt > TOKEN_MAX_AGE_MS) {
    throw new Error('Google sign-in token expired, please try again');
  }
  return { raw, email, createdAt };
}

/**
 * Build the NIP-46 bunker URL for a signing profile; the central server
 * doubles as the NIP-46 relay.
 * @param {string} central - massaged central origin
 * @param {PomegranateProfile} profile
 * @returns {string}
 */
export function buildBunkerUrl(central, profile) {
  const relay = central.replace(/^http/, 'ws');
  return `bunker://${profile.handler_pubkey}?relay=${encodeURIComponent(relay)}`;
}

/**
 * Correlation token sent to each operator during registration.
 * @param {string} session
 * @param {string} operatorUrl
 * @returns {string}
 */
export function operatorToken(session, operatorUrl) {
  return bytesToHex(sha256(utf8.encode(`${session}:${operatorUrl}`)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/pomegranate-helpers.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/pomegranate.js src/lib/__tests__/pomegranate-helpers.test.js
git commit -m "feat(pomegranate): protocol pure helpers"
```

---

### Task 8: Pomegranate service — network protocol functions

**Files:**
- Modify: `src/lib/services/pomegranate.js` (append)
- Test: `src/lib/__tests__/pomegranate-service.test.js`

**Interfaces:**
- Produces (appended exports):
  - `getPomegranateAccount(central, token) → Promise<PomegranateAccount | null>` (throws on 401)
  - `createPomegranateAccount(central, token, { operators, threshold, secretKey }) → Promise<void>` (throws when registered operator count < threshold)
  - `ensureProfile(central, token) → Promise<PomegranateProfile>` (GET /profiles, POST when empty)
  - `startGoogleLogin(centralUrl) → Promise<{ token: GoogleToken, hasAccount: boolean }>` (opens popup — call from a user gesture)
  - `finishGoogleLogin(centralUrl, token, config | null) → Promise<{ bunkerUrl: string, central: string }>` — `config = { operators: string[], threshold: number, secretKey: Uint8Array }` for a new account, `null` for existing
  - `startRecovery(centralUrl, expectedPubkey) → Promise<{ token, account }>` (throws `PomegranatePubkeyMismatchError`)
  - `recoverShard(operator: PomegranateOperator) → Promise<string>`
  - `aggregateNsec(shards: string[], expectedPubkey: string) → string`
- Consumes: Task 7 helpers, `@fiatjaf/promenade-trusted-dealer`, `finalizeEvent`/`generateSecretKey`/`getPublicKey` from `nostr-tools`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/pomegranate-service.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  getPomegranateAccount,
  createPomegranateAccount,
  ensureProfile,
  KIND_ACCOUNT_REGISTRATION,
  KIND_OPERATOR_REGISTRATION
} from '../services/pomegranate.js';

const CENTRAL = 'https://central.test';
const nowSec = () => Math.floor(Date.now() / 1000);
const token = { raw: 'raw-token', email: 'a@b.c', createdAt: Date.now() };

/** @type {ReturnType<typeof vi.fn>} */
let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** Minimal Response stand-in. */
function res(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body
  };
}

describe('getPomegranateAccount', () => {
  it('returns the account when registered', async () => {
    fetchMock.mockResolvedValueOnce(
      res(200, { email: 'a@b.c', pubkey: 'ab'.repeat(32), operators: [], threshold: 2 })
    );
    const account = await getPomegranateAccount(CENTRAL, token);
    expect(account?.pubkey).toBe('ab'.repeat(32));
    expect(fetchMock).toHaveBeenCalledWith(`${CENTRAL}/account`, {
      headers: { Authorization: `Token ${token.raw}` }
    });
  });

  it('returns null when no account exists', async () => {
    fetchMock.mockResolvedValueOnce(res(404, undefined));
    expect(await getPomegranateAccount(CENTRAL, token)).toBeNull();
  });

  it('throws on 401 (expired session)', async () => {
    fetchMock.mockResolvedValueOnce(res(401, undefined));
    await expect(getPomegranateAccount(CENTRAL, token)).rejects.toThrow(/expired/);
  });
});

describe('createPomegranateAccount', () => {
  const operators = ['https://op1.test', 'https://op2.test', 'https://op3.test'];

  it('registers kind 20445 at central and kind 20444 at each operator', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    const secretKey = generateSecretKey();
    await createPomegranateAccount(CENTRAL, token, { operators, threshold: 2, secretKey });

    // 1 central + 3 operator calls
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const [centralUrl, centralInit] = fetchMock.mock.calls[0];
    expect(centralUrl).toBe(`${CENTRAL}/register`);
    const regEvent = JSON.parse(centralInit.body);
    expect(regEvent.kind).toBe(KIND_ACCOUNT_REGISTRATION);
    expect(regEvent.pubkey).toBe(getPublicKey(secretKey));
    expect(regEvent.tags.find((t) => t[0] === 'threshold')?.[1]).toBe('2');
    expect(regEvent.tags.filter((t) => t[0] === 'operator')).toHaveLength(3);

    const [opUrl, opInit] = fetchMock.mock.calls[1];
    expect(opUrl).toBe('https://op1.test/po/register');
    const opEvent = JSON.parse(opInit.body);
    expect(opEvent.kind).toBe(KIND_OPERATOR_REGISTRATION);
    expect(opEvent.tags).toContainEqual(['central', CENTRAL]);
    expect(opEvent.tags).toContainEqual(['email', 'a@b.c']);
    expect(opEvent.content).toMatch(/^[0-9a-f]+$/);
    expect(opInit.headers['X-Pomegranate-Operator-Token']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tolerates operator failures down to the threshold', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === `${CENTRAL}/register`) return res(200, {});
      if (url.startsWith('https://op3')) return res(500, undefined);
      return res(200, {});
    });
    await expect(
      createPomegranateAccount(CENTRAL, token, {
        operators,
        threshold: 2,
        secretKey: generateSecretKey()
      })
    ).resolves.toBeUndefined();
  });

  it('aborts when registered operators fall below the threshold', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === `${CENTRAL}/register`) return res(200, {});
      if (url.startsWith('https://op1')) return res(200, {});
      return res(500, undefined);
    });
    await expect(
      createPomegranateAccount(CENTRAL, token, {
        operators,
        threshold: 2,
        secretKey: generateSecretKey()
      })
    ).rejects.toThrow(/enough operators/);
  });

  it('rejects fewer than 2 operators', async () => {
    await expect(
      createPomegranateAccount(CENTRAL, token, {
        operators: ['https://op1.test'],
        threshold: 1,
        secretKey: generateSecretKey()
      })
    ).rejects.toThrow(/At least 2 operators/);
  });
});

describe('ensureProfile', () => {
  it('returns the first existing profile', async () => {
    fetchMock.mockResolvedValueOnce(
      res(200, [{ handler_pubkey: 'cd'.repeat(32), name: 'default', email: 'a@b.c' }])
    );
    const profile = await ensureProfile(CENTRAL, token);
    expect(profile.handler_pubkey).toBe('cd'.repeat(32));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates a profile when none exists', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, []))
      .mockResolvedValueOnce(
        res(200, { handler_pubkey: 'cd'.repeat(32), name: 'default', email: 'a@b.c' })
      );
    const profile = await ensureProfile(CENTRAL, token);
    expect(profile.handler_pubkey).toBe('cd'.repeat(32));
    const [, createInit] = fetchMock.mock.calls[1];
    expect(createInit.method).toBe('POST');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/pomegranate-service.test.js`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the network half**

Append to `src/lib/services/pomegranate.js` (imports go to the top of the file):

```js
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import { nsecEncode } from 'nostr-tools/nip19';
import {
  aggregateSecretKeyShards,
  decodeShard,
  hexPubShard,
  hexShard,
  trustedKeyDeal
} from '@fiatjaf/promenade-trusted-dealer';
```

```js
/** How long to wait for a popup (Google sign-in / shard recovery) to post back. */
const POPUP_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
async function apiJson(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * GET /account — the pomegranate account registered for this Google identity,
 * or null when none exists yet.
 * @param {string} central - massaged origin
 * @param {GoogleToken} token
 * @returns {Promise<PomegranateAccount | null>}
 */
export async function getPomegranateAccount(central, token) {
  const res = await apiJson(`${central}/account`, {
    headers: { Authorization: `Token ${token.raw}` }
  });
  if (res.status === 401) {
    throw new Error('Google session expired, please sign in again');
  }
  if (res.ok && res.data && res.data.pubkey) {
    return res.data;
  }
  return null;
}

/**
 * Create a new account: split the key into FROST shards (trusted dealer) and
 * register with the central server + every operator. The key signs the
 * registration events but is never persisted here.
 * @param {string} central - massaged origin
 * @param {GoogleToken} token
 * @param {{ operators: string[], threshold: number, secretKey: Uint8Array }} config
 */
export async function createPomegranateAccount(central, token, config) {
  const operators = config.operators.map(massageURL);
  if (operators.length < 2) {
    throw new Error('At least 2 operators are required');
  }
  const threshold = config.threshold;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > operators.length) {
    throw new Error('Invalid signing threshold');
  }
  const session = crypto.randomUUID();

  const secretKey = config.secretKey;
  const masterSk = BigInt('0x' + bytesToHex(secretKey));
  const { shards } = trustedKeyDeal(masterSk, threshold, operators.length);

  // Register the account with the central server (kind 20445).
  const regEvent = finalizeEvent(
    {
      kind: KIND_ACCOUNT_REGISTRATION,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['threshold', String(threshold)],
        ...operators.map((op, i) => ['operator', op, hexPubShard(shards[i].pubShard)])
      ],
      content: ''
    },
    secretKey
  );
  const regRes = await fetch(`${central}/register`, {
    method: 'POST',
    body: JSON.stringify(regEvent),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token.raw}`,
      'X-Pomegranate-Session': session
    }
  });
  if (regRes.status !== 200) {
    throw new Error('Central server registration failed');
  }

  // Register with every operator in parallel (kind 20444, one shard each).
  // A few may fail; the account works while ≥ threshold operators hold shards.
  const failed = (
    await Promise.all(
      operators.map(async (operator, i) => {
        const event = finalizeEvent(
          {
            kind: KIND_OPERATOR_REGISTRATION,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['central', central],
              ['email', token.email]
            ],
            content: hexShard(shards[i])
          },
          secretKey
        );
        try {
          const opRes = await fetch(`${operator}/po/register`, {
            method: 'POST',
            body: JSON.stringify(event),
            headers: {
              'Content-Type': 'application/json',
              'X-Pomegranate-Operator-Token': operatorToken(session, operator)
            }
          });
          if (opRes.ok) return null;
          console.warn(`[pomegranate] operator registration failed: ${operator} (${opRes.status})`);
          return operator;
        } catch (err) {
          console.warn(`[pomegranate] operator registration error: ${operator}`, err);
          return operator;
        }
      })
    )
  ).filter((url) => url !== null);

  const registered = operators.length - failed.length;
  if (registered < threshold) {
    throw new Error(
      `Could not register with enough operators (${registered}/${threshold}). Please try again.`
    );
  }
}

/**
 * GET /profiles, creating a "default" one when none exists.
 * @param {string} central
 * @param {GoogleToken} token
 * @returns {Promise<PomegranateProfile>}
 */
export async function ensureProfile(central, token) {
  const list = await apiJson(`${central}/profiles`, {
    headers: { Authorization: `Token ${token.raw}` }
  });
  if (!list.ok || !Array.isArray(list.data)) {
    throw new Error('Failed to load signing profiles');
  }
  if (list.data.length > 0) return list.data[0];

  const created = await fetch(`${central}/profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token.raw}`
    },
    body: JSON.stringify({ name: 'default' })
  });
  if (!created.ok) {
    throw new Error('Signing profile creation failed');
  }
  let profile = null;
  try {
    profile = JSON.parse(await created.text());
  } catch {
    /* fall through */
  }
  if (!profile?.handler_pubkey || !/^[0-9a-f]{64}$/i.test(profile.handler_pubkey)) {
    throw new Error('Signing profile creation did not complete');
  }
  return profile;
}

/**
 * First login half: open the Google popup at the central server (call from a
 * user gesture) and report whether an account already exists.
 * @param {string} centralUrl
 * @returns {Promise<{ token: GoogleToken, hasAccount: boolean }>}
 */
export async function startGoogleLogin(centralUrl) {
  const central = massageURL(centralUrl);
  const popup = openPopup(`${central}/login/google`, 'PomegranateLogin');
  const raw = await awaitPopupMessage(popup, central, (data) =>
    data && typeof data === 'object' && typeof data.token === 'string' ? data.token : undefined
  );
  const token = decodeGoogleToken(raw);
  const account = await getPomegranateAccount(central, token);
  return { token, hasAccount: !!account };
}

/**
 * Second login half. Pass `config` ({operators, threshold, secretKey}) to
 * create a new account, or null for an existing one. Opens no popup.
 * @param {string} centralUrl
 * @param {GoogleToken} token
 * @param {{ operators: string[], threshold: number, secretKey: Uint8Array } | null} config
 * @returns {Promise<{ bunkerUrl: string, central: string }>}
 */
export async function finishGoogleLogin(centralUrl, token, config) {
  const central = massageURL(centralUrl);
  if (config) {
    await createPomegranateAccount(central, token, config);
  }
  const profile = await ensureProfile(central, token);
  return { bunkerUrl: buildBunkerUrl(central, profile), central };
}

/**
 * Authenticate with Google and load the pomegranate account for the nsec
 * export flow. Throws PomegranatePubkeyMismatchError when the Google account
 * maps to a different pubkey than the locally active one.
 * @param {string} centralUrl
 * @param {string} expectedPubkey
 * @returns {Promise<{ token: GoogleToken, account: PomegranateAccount }>}
 */
export async function startRecovery(centralUrl, expectedPubkey) {
  const central = massageURL(centralUrl);
  const popup = openPopup(`${central}/login/google`, 'PomegranateLogin');
  const raw = await awaitPopupMessage(popup, central, (data) =>
    data && typeof data === 'object' && typeof data.token === 'string' ? data.token : undefined
  );
  const token = decodeGoogleToken(raw);
  const account = await getPomegranateAccount(central, token);
  if (!account) {
    throw new Error('No pomegranate account found for this Google login');
  }
  if (account.pubkey !== expectedPubkey) {
    throw new PomegranatePubkeyMismatchError();
  }
  return { token, account };
}

/**
 * Recover one secret-key shard from one operator (popup re-proves the Google
 * identity to that operator). Call from a user gesture.
 * @param {PomegranateOperator} operator
 * @returns {Promise<string>}
 */
export async function recoverShard(operator) {
  const operatorURL = massageURL(operator.url);
  const popup = openPopup(`${operatorURL}/po/recover/google`, 'PomegranateRecover');
  const shard = await awaitPopupMessage(popup, operatorURL, (data) =>
    typeof data === 'string' ? data : undefined
  );
  if (!shard.startsWith(operator.pubshard)) {
    throw new Error('Recovered shard does not match the operator');
  }
  return shard;
}

/**
 * Aggregate ≥threshold recovered shards back into the secret key.
 * @param {string[]} shards
 * @param {string} expectedPubkey
 * @returns {string} nsec
 */
export function aggregateNsec(shards, expectedPubkey) {
  const secret = aggregateSecretKeyShards(shards.map(hexToBytes).map(decodeShard));
  const secretKey = hexToBytes(secret.toString(16).padStart(64, '0'));
  if (getPublicKey(secretKey) !== expectedPubkey) {
    throw new Error('Recovered key does not match the account');
  }
  return nsecEncode(secretKey);
}

/**
 * @param {string} url
 * @param {string} name
 * @returns {Window}
 */
function openPopup(url, name) {
  const width = 600;
  const height = 700;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  const popup = window.open(
    url,
    name,
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`
  );
  if (!popup) throw new PomegranatePopupBlockedError();
  return popup;
}

/**
 * Resolve with the first message posted by `popup` from `expectedOrigin` for
 * which `extract` returns a defined value. Rejects on close or timeout.
 * @template T
 * @param {Window} popup
 * @param {string} expectedOrigin
 * @param {(data: any) => T | undefined} extract
 * @returns {Promise<T>}
 */
function awaitPopupMessage(popup, expectedOrigin, extract) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closeMonitor);
      window.clearTimeout(timer);
    };
    /** @param {MessageEvent} event */
    const onMessage = (event) => {
      if (event.origin !== expectedOrigin || event.source !== popup) return;
      const value = extract(event.data);
      if (value === undefined) return;
      cleanup();
      popup.close();
      resolve(value);
    };
    const closeMonitor = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new PomegranatePopupClosedError());
      }
    }, 300);
    const timer = window.setTimeout(() => {
      cleanup();
      popup.close();
      reject(new Error('Timed out waiting for the popup'));
    }, POPUP_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
  });
}

// generateSecretKey is re-exported for the login UI so it doesn't import
// nostr-tools separately for this one call.
export { generateSecretKey };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/pomegranate-service.test.js src/lib/__tests__/pomegranate-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/pomegranate.js src/lib/__tests__/pomegranate-service.test.js
git commit -m "feat(pomegranate): registration/login/recovery protocol client"
```

---

### Task 9: LoginWithGoogle component (both paths)

**Files:**
- Create: `src/lib/components/LoginWithGoogle.svelte`
- Modify: `src/lib/components/ModalManager.svelte` (id, open/close branches, render branch, transitions)
- Modify: `src/lib/components/LoginModal.svelte` (prominent "Continue with Google" button)
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/LoginWithGoogle.test.js`

**Interfaces:**
- Consumes: `startGoogleLogin`, `finishGoogleLogin`, `defaultThreshold`, `generateSecretKey`, error classes (Task 8); `connectWithBunkerUrl`, `registerBunkerAccount` (`bunker-connection.js`); `pool` from `$lib/stores/nostr-infrastructure.svelte`; `runtimeConfig.googleLogin` (Task 1); `downloadRecoveryFile` from `$lib/helpers/recoveryFile.js`.
- Produces: modal type `'googleLogin'` (typedef already extended in Task 3); after login the account is a `nostr-connect` account with `account.metadata.pomegranateCentral` set (Tasks 11–12 rely on this); new-account flow ends with `modalStore.transitionModal('googleLogin', 'signup', { externalSignup: true })` (Task 10 implements the signup mode — until Task 10 lands, the transition simply opens the normal wizard, which is acceptable mid-stack but means Task 10 must land before manual verification).

- [ ] **Step 1: Add i18n messages**

`messages/en.json`:

```json
"auth_login_modal_google": "Continue with Google",
"auth_login_google_title": "Continue with Google",
"auth_login_google_intro": "Sign in with your Google account. Your key is split across independent servers — Google only proves who you are and never sees your key.",
"auth_login_google_start": "Sign in with Google",
"auth_login_google_status_authenticating": "Waiting for Google sign-in…",
"auth_login_google_status_checking": "Checking your account…",
"auth_login_google_status_creating": "Setting up your account…",
"auth_login_google_status_connecting": "Connecting to the signer…",
"auth_login_google_backup_title": "Your recovery key",
"auth_login_google_backup_description": "This is the master key of your new account. It is stored split across independent servers, so you normally never need it — but saving a copy now keeps you in control even if those servers disappear. You can also export it later in Settings.",
"auth_login_google_backup_copy": "Copy",
"auth_login_google_backup_copied": "Copied!",
"auth_login_google_backup_download": "Download recovery file",
"auth_login_google_backup_skip": "Skip for now",
"auth_login_google_backup_continue": "Continue",
"auth_login_google_error_popup_blocked": "The sign-in popup was blocked. Please allow popups for this site and try again.",
"auth_login_google_error_popup_closed": "The sign-in window was closed before completing. Please try again.",
"auth_login_google_error_generic": "Google sign-in failed. Please try again.",
"auth_google_account_badge": "Google",
```

`messages/de.json`:

```json
"auth_login_modal_google": "Mit Google fortfahren",
"auth_login_google_title": "Mit Google fortfahren",
"auth_login_google_intro": "Melde dich mit deinem Google-Konto an. Dein Schlüssel wird auf unabhängige Server aufgeteilt — Google bestätigt nur deine Identität und sieht deinen Schlüssel nie.",
"auth_login_google_start": "Mit Google anmelden",
"auth_login_google_status_authenticating": "Warte auf Google-Anmeldung…",
"auth_login_google_status_checking": "Konto wird geprüft…",
"auth_login_google_status_creating": "Konto wird eingerichtet…",
"auth_login_google_status_connecting": "Verbinde mit dem Signierdienst…",
"auth_login_google_backup_title": "Dein Wiederherstellungsschlüssel",
"auth_login_google_backup_description": "Das ist der Hauptschlüssel deines neuen Kontos. Er wird aufgeteilt auf unabhängigen Servern gespeichert — normalerweise brauchst du ihn nie. Eine Kopie jetzt zu sichern hält dich aber unabhängig, falls diese Server verschwinden. Du kannst ihn auch später in den Einstellungen exportieren.",
"auth_login_google_backup_copy": "Kopieren",
"auth_login_google_backup_copied": "Kopiert!",
"auth_login_google_backup_download": "Wiederherstellungsdatei herunterladen",
"auth_login_google_backup_skip": "Später",
"auth_login_google_backup_continue": "Weiter",
"auth_login_google_error_popup_blocked": "Das Anmeldefenster wurde blockiert. Bitte erlaube Popups für diese Seite und versuche es erneut.",
"auth_login_google_error_popup_closed": "Das Anmeldefenster wurde geschlossen, bevor die Anmeldung abgeschlossen war. Bitte versuche es erneut.",
"auth_login_google_error_generic": "Google-Anmeldung fehlgeschlagen. Bitte versuche es erneut.",
"auth_google_account_badge": "Google",
```

- [ ] **Step 2: Write the failing component test**

Create `src/lib/components/__tests__/LoginWithGoogle.test.js` (tests the state machine with the service mocked; popups/network are not exercised in jsdom):

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const mockService = vi.hoisted(() => ({
  startGoogleLogin: vi.fn(),
  finishGoogleLogin: vi.fn(),
  defaultThreshold: (n) => Math.ceil((n * 7) / 12),
  generateSecretKey: () => new Uint8Array(32).fill(7)
}));
vi.mock('$lib/services/pomegranate.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, ...mockService };
});

const mockBunker = vi.hoisted(() => ({
  connectWithBunkerUrl: vi.fn(),
  registerBunkerAccount: vi.fn()
}));
vi.mock('$lib/helpers/bunker-connection.js', () => mockBunker);

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ pool: {} }));

const mockManager = vi.hoisted(() => ({ getAccountForPubkey: vi.fn(() => null) }));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));

const mockModalStore = vi.hoisted(() => ({
  activeModal: 'googleLogin',
  closeModal: vi.fn(),
  transitionModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

const mockRuntimeConfig = vi.hoisted(() => ({
  googleLogin: {
    enabled: true,
    centralUrl: 'https://central.test',
    operatorUrls: ['https://op1.test', 'https://op2.test', 'https://op3.test']
  }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: mockRuntimeConfig }));

vi.mock('$lib/helpers/recoveryFile.js', () => ({ downloadRecoveryFile: vi.fn() }));

vi.mock('$lib/paraglide/messages', () => new Proxy({}, { get: (_, key) => () => String(key) }));

import LoginWithGoogle from '../LoginWithGoogle.svelte';

describe('LoginWithGoogle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManager.getAccountForPubkey.mockReturnValue(null);
  });

  it('existing account: logs straight in via the bunker path', async () => {
    mockService.startGoogleLogin.mockResolvedValue({ token: { raw: 'r' }, hasAccount: true });
    mockService.finishGoogleLogin.mockResolvedValue({
      bunkerUrl: 'bunker://x?relay=wss%3A%2F%2Fcentral.test',
      central: 'https://central.test'
    });
    const fakeSigner = {};
    mockBunker.connectWithBunkerUrl.mockResolvedValue({ signer: fakeSigner, pubkey: 'p'.repeat(64) });
    const fakeAccount = { metadata: undefined };
    mockBunker.registerBunkerAccount.mockReturnValue({ account: fakeAccount, alreadyExisted: false });

    const { getByTestId } = render(LoginWithGoogle, { modalId: 'g1' });
    await fireEvent.click(getByTestId('google-login-start'));

    await waitFor(() => expect(mockBunker.registerBunkerAccount).toHaveBeenCalled());
    // finishGoogleLogin called with null config (no account creation)
    expect(mockService.finishGoogleLogin).toHaveBeenCalledWith(
      'https://central.test',
      { raw: 'r' },
      null
    );
    // account is tagged as a pomegranate account
    expect(fakeAccount.metadata).toEqual({ pomegranateCentral: 'https://central.test' });
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });

  it('new account: shows the backup step before creating', async () => {
    mockService.startGoogleLogin.mockResolvedValue({ token: { raw: 'r' }, hasAccount: false });
    const { getByTestId } = render(LoginWithGoogle, { modalId: 'g2' });
    await fireEvent.click(getByTestId('google-login-start'));
    await waitFor(() => expect(getByTestId('google-backup-step')).toBeTruthy());
    expect(mockService.finishGoogleLogin).not.toHaveBeenCalled();
  });

  it('new account: skip proceeds to creation and hands off to signup', async () => {
    mockService.startGoogleLogin.mockResolvedValue({ token: { raw: 'r' }, hasAccount: false });
    mockService.finishGoogleLogin.mockResolvedValue({
      bunkerUrl: 'bunker://x?relay=wss%3A%2F%2Fcentral.test',
      central: 'https://central.test'
    });
    mockBunker.connectWithBunkerUrl.mockResolvedValue({ signer: {}, pubkey: 'p'.repeat(64) });
    mockBunker.registerBunkerAccount.mockReturnValue({
      account: { metadata: undefined },
      alreadyExisted: false
    });

    const { getByTestId } = render(LoginWithGoogle, { modalId: 'g3' });
    await fireEvent.click(getByTestId('google-login-start'));
    await waitFor(() => getByTestId('google-backup-step'));
    await fireEvent.click(getByTestId('google-backup-skip'));

    await waitFor(() =>
      expect(mockModalStore.transitionModal).toHaveBeenCalledWith('googleLogin', 'signup', {
        externalSignup: true
      })
    );
    const config = mockService.finishGoogleLogin.mock.calls[0][2];
    expect(config.operators).toEqual(mockRuntimeConfig.googleLogin.operatorUrls);
    expect(config.threshold).toBe(2); // ceil(3*7/12)
    expect(config.secretKey).toBeInstanceOf(Uint8Array);
  });

  it('popup-blocked error is surfaced', async () => {
    const err = new Error('Popup was blocked');
    err.name = 'PomegranatePopupBlockedError';
    mockService.startGoogleLogin.mockRejectedValue(err);
    const { getByTestId, getByText } = render(LoginWithGoogle, { modalId: 'g4' });
    await fireEvent.click(getByTestId('google-login-start'));
    await waitFor(() => expect(getByText('auth_login_google_error_popup_blocked')).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/LoginWithGoogle.test.js`
Expected: FAIL — component does not exist.

- [ ] **Step 4: Create the component**

Create `src/lib/components/LoginWithGoogle.svelte`:

```svelte
<script>
  import * as m from '$lib/paraglide/messages';
  import { nip19 } from 'nostr-tools';
  import { manager } from '$lib/stores/accounts.svelte';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { connectWithBunkerUrl, registerBunkerAccount } from '$lib/helpers/bunker-connection.js';
  import { downloadRecoveryFile } from '$lib/helpers/recoveryFile.js';
  import {
    startGoogleLogin,
    finishGoogleLogin,
    defaultThreshold,
    generateSecretKey
  } from '$lib/services/pomegranate.js';

  let { modalId } = $props();

  /** @type {'idle' | 'authenticating' | 'backup' | 'creating' | 'connecting'} */
  let status = $state('idle');
  let errorMessage = $state('');
  let copied = $state(false);

  // Raw refs — Uint8Array must not be deep-proxied (see CLAUDE.md).
  let newSecretKey = $state.raw(/** @type {Uint8Array | null} */ (null));
  let newNsec = $state('');
  /** @type {import('$lib/services/pomegranate.js').GoogleToken | null} */
  let token = $state.raw(null);

  const centralUrl = $derived(runtimeConfig.googleLogin?.centralUrl || '');
  const operatorUrls = $derived(runtimeConfig.googleLogin?.operatorUrls || []);

  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;
    const handleDialogClose = () => {
      if (modalStore.activeModal === 'googleLogin') {
        modalStore.closeModal();
      }
    };
    dialog.addEventListener('close', handleDialogClose);
    return () => dialog.removeEventListener('close', handleDialogClose);
  });

  /** @param {unknown} err */
  function surfaceError(err) {
    const name = /** @type {Error} */ (err)?.name || '';
    if (name === 'PomegranatePopupBlockedError') {
      errorMessage = m.auth_login_google_error_popup_blocked();
    } else if (name === 'PomegranatePopupClosedError') {
      errorMessage = m.auth_login_google_error_popup_closed();
    } else {
      errorMessage = /** @type {Error} */ (err)?.message || m.auth_login_google_error_generic();
    }
    status = 'idle';
    console.warn('Google login failed:', err);
  }

  /** Popup must open from this click handler (user gesture). */
  async function start() {
    errorMessage = '';
    status = 'authenticating';
    try {
      const result = await startGoogleLogin(centralUrl);
      token = result.token;
      if (result.hasAccount) {
        await loginWithBunker(null);
      } else {
        newSecretKey = generateSecretKey();
        newNsec = nip19.nsecEncode(newSecretKey);
        status = 'backup';
      }
    } catch (err) {
      surfaceError(err);
    }
  }

  /**
   * Finish login. `config` is null for existing accounts, or the new-account
   * creation config. On success the account is registered through the normal
   * bunker path and tagged with the central URL.
   * @param {{ operators: string[], threshold: number, secretKey: Uint8Array } | null} config
   */
  async function loginWithBunker(config) {
    if (!token) return;
    status = config ? 'creating' : 'connecting';
    const isNew = !!config;
    const { bunkerUrl, central } = await finishGoogleLogin(centralUrl, token, config);
    status = 'connecting';
    const { signer, pubkey } = await connectWithBunkerUrl(bunkerUrl, { pool });
    const { account } = registerBunkerAccount(manager, pubkey, signer);
    account.metadata = { ...(account.metadata || {}), pomegranateCentral: central };
    newSecretKey = null;
    newNsec = '';
    if (isNew) {
      // Hand the fresh account to the signup wizard (profile → communities →
      // publish defaults). The wizard reads the active account (externalSignup).
      modalStore.transitionModal('googleLogin', 'signup', { externalSignup: true });
    } else {
      modalStore.closeModal();
    }
  }

  /** Create the account (backup step's Continue/Skip both land here). */
  async function createAccount() {
    if (!newSecretKey) return;
    errorMessage = '';
    try {
      await loginWithBunker({
        operators: operatorUrls,
        threshold: defaultThreshold(operatorUrls.length),
        secretKey: newSecretKey
      });
    } catch (err) {
      surfaceError(err);
    }
  }

  async function copyNsec() {
    try {
      await navigator.clipboard.writeText(newNsec);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  }

  function downloadBackup() {
    if (!newSecretKey) return;
    downloadRecoveryFile({ privateKey: newSecretKey, nsec: newNsec });
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box">
    <h1 class="text-lg font-bold">{m.auth_login_google_title()}</h1>

    {#if status === 'idle'}
      <p class="py-4">{m.auth_login_google_intro()}</p>
      {#if errorMessage}
        <div class="mb-4 alert alert-error"><span class="text-sm">{errorMessage}</span></div>
      {/if}
      <button data-testid="google-login-start" class="btn w-full btn-primary" onclick={start}>
        {m.auth_login_google_start()}
      </button>
    {:else if status === 'backup'}
      <div class="space-y-4 py-4" data-testid="google-backup-step">
        <h2 class="font-semibold">{m.auth_login_google_backup_title()}</h2>
        <p class="text-sm opacity-80">{m.auth_login_google_backup_description()}</p>
        <div class="flex items-center gap-2">
          <input
            class="input-bordered input w-full font-mono text-xs"
            readonly
            value={newNsec}
            data-testid="google-backup-nsec"
          />
          <button class="btn btn-sm" onclick={copyNsec}>
            {copied ? m.auth_login_google_backup_copied() : m.auth_login_google_backup_copy()}
          </button>
        </div>
        <button class="btn w-full btn-outline" onclick={downloadBackup}>
          {m.auth_login_google_backup_download()}
        </button>
        {#if errorMessage}
          <div class="alert alert-error"><span class="text-sm">{errorMessage}</span></div>
        {/if}
        <div class="flex justify-end gap-2">
          <button data-testid="google-backup-skip" class="btn btn-ghost" onclick={createAccount}>
            {m.auth_login_google_backup_skip()}
          </button>
          <button
            data-testid="google-backup-continue"
            class="btn btn-primary"
            onclick={createAccount}
          >
            {m.auth_login_google_backup_continue()}
          </button>
        </div>
      </div>
    {:else}
      <div class="flex flex-col items-center gap-3 py-8" data-testid="google-login-progress">
        <span class="loading loading-lg loading-spinner"></span>
        <span class="text-sm opacity-80">
          {#if status === 'authenticating'}{m.auth_login_google_status_authenticating()}
          {:else if status === 'creating'}{m.auth_login_google_status_creating()}
          {:else}{m.auth_login_google_status_connecting()}{/if}
        </span>
      </div>
    {/if}

    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{m.common_close()}</button>
      </form>
    </div>
  </div>
</dialog>
```

- [ ] **Step 5: Wire ModalManager + LoginModal**

`src/lib/components/ModalManager.svelte`:

```js
import LoginWithGoogle from './LoginWithGoogle.svelte';
const googleLoginModalId = 'global-google-login-modal';
```

Close branch (in `currentModal === 'none'`):

```js
      const googleLoginModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(googleLoginModalId)
      );
      if (googleLoginModal && googleLoginModal.open) {
        googleLoginModal.close();
      }
```

Open branch:

```js
    } else if (currentModal === 'googleLogin') {
      const googleLoginModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(googleLoginModalId)
      );
      if (googleLoginModal && !googleLoginModal.open) {
        googleLoginModal.showModal();
      }
```

Transition handler + render branch:

```js
  function handleGoogleTransition() {
    modal.transitionModal('login', 'googleLogin');
  }
```

```svelte
{:else if modal.activeModal === 'googleLogin'}
  <LoginWithGoogle modalId={googleLoginModalId} />
```

Pass `onGoogleTransition={handleGoogleTransition}` to `<LoginModal …>`.

`src/lib/components/LoginModal.svelte` — accept the prop and render the button **prominently above** the create-account CTA (the target audience treats it as a primary path):

```js
let { modalId, onNSECTransition, onBunkerTransition, onNpubTransition, onGoogleTransition } =
  $props();
```

Above the signup CTA `div.text-center`:

```svelte
      {#if runtimeConfig.googleLogin?.enabled}
        <button
          data-testid="login-method-google"
          class="btn w-full btn-lg"
          onclick={() => onGoogleTransition?.()}
        >
          {m.auth_login_modal_google()}
        </button>
      {/if}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/components/__tests__/LoginWithGoogle.test.js`
Expected: PASS (4 tests). Also `pnpm run check` — no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/LoginWithGoogle.svelte src/lib/components/ModalManager.svelte src/lib/components/LoginModal.svelte src/lib/components/__tests__/LoginWithGoogle.test.js messages/en.json messages/de.json
git commit -m "feat(auth): Google login via Pomegranate behind GOOGLE_LOGIN_ENABLED"
```

---

### Task 10: SignupModal externalSignup mode

**Files:**
- Modify: `src/lib/components/SignupModal.svelte`
- Modify: `src/lib/components/ModalManager.svelte` (pass the prop from modalProps)
- Test: `src/lib/components/__tests__/SignupModalExternal.test.js`

**Interfaces:**
- Consumes: modal props `{ externalSignup: true }` set by LoginWithGoogle's transition (Task 9); `manager.active` (the freshly activated bunker account) and its `signer`.
- Produces: SignupModal prop `externalSignup?: boolean`. In this mode: no keypair is generated, step 1 does NOT create a SimpleAccount and does NOT set the `signed-up-here:` flag (that flag drives nsec-backup banners which read `signer.key` — bunker signers have none), and `finishSignup` signs through the active account's signer.

- [ ] **Step 1: Write the failing test**

Create `src/lib/components/__tests__/SignupModalExternal.test.js`. Mock strategy: SignupModal has heavy children — mock them all; assert on the script-level behavior (no `addAccount`, signer taken from active account).

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const signEvent = vi.fn(async (draft) => ({ ...draft, id: 'x', sig: 'y' }));
const mockManager = vi.hoisted(() => ({
  active: null,
  addAccount: vi.fn(),
  setActive: vi.fn(),
  getAccountForPubkey: vi.fn(() => null)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));

vi.mock('$lib/helpers/signupKeypair.js', () => ({
  generateSignupKeypair: vi.fn(() => {
    throw new Error('must not generate keys in externalSignup mode');
  })
}));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { activeModal: 'signup', closeModal: vi.fn(), openModal: vi.fn() }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { membership: { enabled: false }, signup: { suggestedCommunities: [] } }
}));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn(async () => ({})) }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: { add: vi.fn() } }));
vi.mock('$lib/loaders/community.js', () => ({
  communikeyTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/helpers/communityFollowSet.js', () => ({ buildCommunityFollowSet: vi.fn() }));
vi.mock('$lib/helpers/dm.js', () => ({ buildDmRelayListEvent: vi.fn(() => ({ kind: 10050 })) }));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getDefaultDmRelays: () => [] }));
vi.mock('$lib/services/relay-list-backfill.js', () => ({
  buildSignedDefaultRelayList: vi.fn(async () => null)
}));
// Heavy child components
vi.mock('../shared/AvatarUploader.svelte', () => ({ default: () => ({}) }));
vi.mock('../SignupCommunityPicker.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/EducatorContextFields.svelte', () => ({ default: () => ({}) }));
vi.mock('../membership/MembershipApplicationForm.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/paraglide/messages', () => new Proxy({}, { get: (_, key) => () => String(key) }));

import SignupModal from '../SignupModal.svelte';

describe('SignupModal externalSignup mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManager.active = {
      pubkey: 'ab'.repeat(32),
      type: 'nostr-connect',
      signer: { signEvent }
    };
    localStorage.clear();
  });

  it('step 1 advances without creating an account or setting the wizard flag', async () => {
    const { getByLabelText, getByText } = render(SignupModal, {
      modalId: 'sm1',
      externalSignup: true
    });
    await fireEvent.input(getByLabelText('auth_signup_modal_name_label'), {
      target: { value: 'Teacher Tina' }
    });
    await fireEvent.click(getByText('auth_signup_modal_continue'));
    await waitFor(() => expect(getByText('auth_signup_modal_step2_subtitle')).toBeTruthy());
    expect(mockManager.addAccount).not.toHaveBeenCalled();
    expect(localStorage.getItem(`signed-up-here:${'ab'.repeat(32)}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/SignupModalExternal.test.js`
Expected: FAIL — `generateSignupKeypair` throws (mode not implemented), or prop unknown.

- [ ] **Step 3: Implement the mode**

In `src/lib/components/SignupModal.svelte`:

1. Props: `let { modalId, externalSignup = false } = $props();`

2. Replace the keygen `$effect` body:

```js
  // Generate keypair on mount so Step 2's AvatarUploader has a working signer
  // immediately. In externalSignup mode (Google/Pomegranate) the account
  // already exists and is active — adopt its pubkey + signer instead.
  $effect(() => {
    if (externalSignup) {
      const active = manager.active;
      if (active && !userData.publicKey) {
        userData.publicKey = active.pubkey;
        userData.npub = nip19.npubEncode(active.pubkey);
        _signer = /** @type {any} */ (active.signer);
      }
      return;
    }
    if (!privateKey) {
      // …existing generateSignupKeypair() body unchanged…
    }
  });
```

3. In `continueFromStep1`, wrap the account-creation + flag block:

```js
    if (!externalSignup) {
      if (!privateKey || !userData.publicKey || !_signer) {
        errors.keyGeneration = 'Keys not ready. Please wait a moment and try again.';
        return;
      }
      if (!manager.getAccountForPubkey(userData.publicKey)) {
        const account = new SimpleAccount(userData.publicKey, _signer);
        manager.addAccount(account);
        manager.setActive(account);
      }
      try {
        localStorage.setItem(`signed-up-here:${userData.publicKey}`, '1');
      } catch {
        /* localStorage may be unavailable in some embeds */
      }
    } else if (!userData.publicKey || !_signer) {
      errors.keyGeneration = 'Account not ready. Please wait a moment and try again.';
      return;
    }
```

(The `if (!userData.name.trim())` name check stays first, unchanged. `finishSignup` already signs via `_signer` and needs no change — in external mode `_signer` is the bunker signer.)

4. `src/lib/components/ModalManager.svelte` — pass the prop from modalProps:

```svelte
{:else if modal.activeModal === 'signup'}
  <SignupModal
    modalId={signupModalId}
    externalSignup={!!(/** @type {any} */ (modal.modalProps)?.externalSignup)}
  />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/components/__tests__/SignupModalExternal.test.js`
Expected: PASS. Also run any existing SignupModal tests: `pnpm vitest run src/lib/components/__tests__/ -t Signup` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SignupModal.svelte src/lib/components/ModalManager.svelte src/lib/components/__tests__/SignupModalExternal.test.js
git commit -m "feat(signup): externalSignup mode for pre-existing accounts"
```

---

### Task 11: MANUAL live verification checkpoint (human in the loop)

**Files:** none committed (checklist only).

This is the spec's signer-compatibility gate: Jumble uses nostr-tools' NIP-46 client; we use applesauce's `NostrConnectSigner`. Verify against the real infrastructure BEFORE building the export/badge polish.

- [ ] **Step 1: Prepare a dev run**

In the worktree `.env`: `GOOGLE_LOGIN_ENABLED=true` (keep the default central/operators). Start `pnpm run dev`. **Verify which server answers your port** (stale worktree vite servers squat ports — check the terminal output for the actual port).

- [ ] **Step 2: Pause and involve the user**

This step needs a real Google account and judgment — STOP and ask the user to walk through it together:

1. **New account:** Login modal → "Continue with Google" → Google popup with a throwaway/test Google account → backup step appears with an nsec → "Continue" → account created → signup wizard opens in externalSignup mode → complete it with a test name → verify the kind 0 gets signed **via the bunker** (network tab: NIP-46 traffic to `wss://auth.njump.me`; no errors) and lands in the profile.
2. **Sign an event:** create a note/reaction — confirm remote signing round-trips.
3. **Cross-device login:** clear site data (or private window) → "Continue with Google" again → same npub is restored without the wizard.
4. **Popup-blocked path:** block popups for localhost → button shows the popup-blocked error.

- [ ] **Step 3: Record the outcome**

If signing fails at the NIP-46 layer, STOP the plan here and diagnose (candidate fallback per spec: thin dedicated signer wrapper around nostr-tools' `BunkerSigner`, registered as a custom account type). Do not proceed to Task 12 until a full sign round-trip works. Note findings in the final commit message or a follow-up issue.

---

### Task 12: Google badge + settings nsec export

**Files:**
- Modify: `src/lib/components/AccountProfile.svelte` (Google badge)
- Create: `src/lib/components/settings/PomegranateExportCard.svelte`
- Modify: `src/routes/settings/+page.svelte` (mount after the recovery card, `data-testid="settings-recovery-card"` ~line 1218)
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/PomegranateExportCard.test.js`

**Interfaces:**
- Consumes: `account.metadata.pomegranateCentral` (Task 9), `startRecovery` / `recoverShard` / `aggregateNsec` / `PomegranatePubkeyMismatchError` (Task 8).
- Produces: `PomegranateExportCard` (no props; renders only when the active account has `metadata.pomegranateCentral`; testid `pomegranate-export-card`).

- [ ] **Step 1: Add i18n messages**

`messages/en.json`:

```json
"settings_pomegranate_title": "Export Google-account key",
"settings_pomegranate_description": "Your signing key is split across independent servers. Recover the full private key (nsec) by re-proving your Google identity to each server — one popup per server.",
"settings_pomegranate_export_button": "Export private key",
"settings_pomegranate_next_shard": "Recover next shard ({current} of {needed})",
"settings_pomegranate_error_mismatch": "This Google account is linked to a different Nostr account.",
"settings_pomegranate_copy": "Copy nsec",
"settings_pomegranate_copied": "Copied!",
```

`messages/de.json`:

```json
"settings_pomegranate_title": "Google-Konto-Schlüssel exportieren",
"settings_pomegranate_description": "Dein Signierschlüssel ist auf unabhängige Server aufgeteilt. Stelle den vollständigen privaten Schlüssel (nsec) wieder her, indem du deine Google-Identität gegenüber jedem Server bestätigst — ein Popup pro Server.",
"settings_pomegranate_export_button": "Privaten Schlüssel exportieren",
"settings_pomegranate_next_shard": "Nächsten Schlüsselteil abrufen ({current} von {needed})",
"settings_pomegranate_error_mismatch": "Dieses Google-Konto ist mit einem anderen Nostr-Konto verknüpft.",
"settings_pomegranate_copy": "nsec kopieren",
"settings_pomegranate_copied": "Kopiert!",
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/components/__tests__/PomegranateExportCard.test.js`:

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';

const active$ = new BehaviorSubject(null);
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active$ } }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: { active$ } }));
vi.mock('$lib/services/pomegranate.js', () => ({
  startRecovery: vi.fn(),
  recoverShard: vi.fn(),
  aggregateNsec: vi.fn(),
  PomegranatePubkeyMismatchError: class extends Error {}
}));
vi.mock('$lib/paraglide/messages', () => new Proxy({}, { get: (_, key) => () => String(key) }));

import PomegranateExportCard from '../settings/PomegranateExportCard.svelte';

describe('PomegranateExportCard', () => {
  beforeEach(() => active$.next(null));

  it('hidden for non-pomegranate accounts', () => {
    active$.next({ pubkey: 'a'.repeat(64), type: 'nostr-connect', metadata: {} });
    const { queryByTestId } = render(PomegranateExportCard);
    expect(queryByTestId('pomegranate-export-card')).toBeNull();
  });

  it('visible for pomegranate accounts', async () => {
    active$.next({
      pubkey: 'a'.repeat(64),
      type: 'nostr-connect',
      metadata: { pomegranateCentral: 'https://auth.njump.me' }
    });
    const { findByTestId } = render(PomegranateExportCard);
    expect(await findByTestId('pomegranate-export-card')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/PomegranateExportCard.test.js`
Expected: FAIL — component does not exist.

- [ ] **Step 4: Implement**

Create `src/lib/components/settings/PomegranateExportCard.svelte`:

```svelte
<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import {
    startRecovery,
    recoverShard,
    aggregateNsec,
    PomegranatePubkeyMismatchError
  } from '$lib/services/pomegranate.js';

  let activeAccount = $state(/** @type {any} */ (null));
  $effect(() => {
    const sub = manager.active$.subscribe((account) => {
      activeAccount = account;
      // Reset any in-progress recovery when the account switches.
      recovery = null;
      shards = [];
      nsec = '';
      errorMessage = '';
    });
    return () => sub.unsubscribe();
  });

  const central = $derived(activeAccount?.metadata?.pomegranateCentral || '');

  /** @type {{ token: any, account: import('$lib/services/pomegranate.js').PomegranateAccount } | null} */
  let recovery = $state.raw(null);
  /** @type {string[]} */
  let shards = $state.raw([]);
  let nsec = $state('');
  let errorMessage = $state('');
  let busy = $state(false);
  let copied = $state(false);

  /** Each recover step opens ONE popup (user gesture per operator). */
  async function step() {
    errorMessage = '';
    busy = true;
    try {
      if (!recovery) {
        recovery = await startRecovery(central, activeAccount.pubkey);
        busy = false;
        return;
      }
      const operator = recovery.account.operators[shards.length];
      const shard = await recoverShard(operator);
      shards = [...shards, shard];
      if (shards.length >= recovery.account.threshold) {
        nsec = aggregateNsec(shards, activeAccount.pubkey);
      }
    } catch (err) {
      errorMessage =
        err instanceof PomegranatePubkeyMismatchError
          ? m.settings_pomegranate_error_mismatch()
          : /** @type {Error} */ (err)?.message || String(err);
    } finally {
      busy = false;
    }
  }

  async function copyNsec() {
    try {
      await navigator.clipboard.writeText(nsec);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  }
</script>

{#if central}
  <div class="card bg-base-100 shadow-md" data-testid="pomegranate-export-card">
    <div class="card-body">
      <h2 class="mb-2 card-title text-2xl">{m.settings_pomegranate_title()}</h2>
      <p class="text-sm opacity-80">{m.settings_pomegranate_description()}</p>

      {#if errorMessage}
        <div class="alert alert-error"><span class="text-sm">{errorMessage}</span></div>
      {/if}

      {#if nsec}
        <div class="flex items-center gap-2">
          <input
            class="input-bordered input w-full font-mono text-xs"
            readonly
            value={nsec}
            data-testid="pomegranate-nsec"
          />
          <button class="btn btn-sm" onclick={copyNsec}>
            {copied ? m.settings_pomegranate_copied() : m.settings_pomegranate_copy()}
          </button>
        </div>
      {:else}
        <button
          class="btn w-fit btn-outline"
          data-testid="pomegranate-export-step"
          disabled={busy}
          onclick={step}
        >
          {#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
          {#if !recovery}
            {m.settings_pomegranate_export_button()}
          {:else}
            {m.settings_pomegranate_next_shard({
              current: shards.length + 1,
              needed: recovery.account.threshold
            })}
          {/if}
        </button>
      {/if}
    </div>
  </div>
{/if}
```

`src/lib/components/AccountProfile.svelte` — after the readonly badge added in Task 4:

```svelte
    {#if account.metadata?.pomegranateCentral}
      <span class="ml-1 badge badge-outline badge-sm badge-info">{m.auth_google_account_badge()}</span>
    {/if}
```

`src/routes/settings/+page.svelte` — import and mount directly after the recovery card's closing tag (find `data-testid="settings-recovery-card"`, insert after that card `</div>` chain closes at the same nesting level):

```js
import PomegranateExportCard from '$lib/components/settings/PomegranateExportCard.svelte';
```

```svelte
<PomegranateExportCard />
```

- [ ] **Step 5: Run tests + verify visually**

Run: `pnpm vitest run src/lib/components/__tests__/PomegranateExportCard.test.js` — PASS.
Dev server with the Task-11 Google account: settings shows the card; a full export round-trip recovers the same nsec shown at signup (compare npub). Verify a non-Google account does NOT show the card.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/settings/PomegranateExportCard.svelte src/lib/components/AccountProfile.svelte src/routes/settings/+page.svelte src/lib/components/__tests__/PomegranateExportCard.test.js messages/en.json messages/de.json
git commit -m "feat(auth): Google account badge + settings nsec export"
```

---

### Task 13: Docs, coverage, full verification

**Files:**
- Modify: `README.md` (env var documentation, wherever the other feature flags are listed)
- Modify: `e2e/COVERAGE.md`
- Modify: `CLAUDE.md` (config section: add the four env vars to the runtime-config list)

- [ ] **Step 1: Document env vars in README**

Add to the README's environment/configuration section:

```markdown
### Login methods

| Variable | Default | Purpose |
| --- | --- | --- |
| `NPUB_LOGIN_ENABLED` | `false` | Read-only "browse as npub" login method |
| `GOOGLE_LOGIN_ENABLED` | `false` | "Continue with Google" via the Pomegranate FROST threshold signer ([promenade](https://pkg.go.dev/fiatjaf.com/promenade)) |
| `POMEGRANATE_CENTRAL_URL` | `https://auth.njump.me` | Central server (Google OAuth + NIP-46 relay + FROST coordinator) |
| `POMEGRANATE_OPERATOR_URLS` | 5 public community operators | Comma-separated shard-operator servers; ≥2 required, signing threshold is ceil(7n/12) |

The Google flow generates a random key client-side, splits it into FROST shards across the operators, and signs via NIP-46 — no server ever holds the whole key. Self-hosting promenade later only requires changing these two URLs.
```

- [ ] **Step 2: Manual-verification checklist in COVERAGE.md**

Append to `e2e/COVERAGE.md`:

```markdown
## Google login (Pomegranate) — manual checklist (no E2E: external OAuth)

- [ ] New account: Google popup → backup step → wizard → kind 0 signed via bunker
- [ ] Existing account: fresh browser → Google popup → same npub restored, no wizard
- [ ] Event signing round-trips via wss://<central> (NIP-46)
- [ ] Popup blocked → inline error; popup closed early → inline error
- [ ] Settings → export private key recovers the matching nsec (threshold popups)
- [ ] Flag off → no Google button in the login modal
```

- [ ] **Step 3: Update CLAUDE.md config list**

In CLAUDE.md's Configuration section, add to the top-level shape list:

```markdown
- `npubLogin.enabled` / `googleLogin.{enabled,centralUrl,operatorUrls}` — login methods (`NPUB_LOGIN_ENABLED`, `GOOGLE_LOGIN_ENABLED`, `POMEGRANATE_CENTRAL_URL`, `POMEGRANATE_OPERATOR_URLS`); Google = Pomegranate/promenade FROST bunker, accounts tagged via `account.metadata.pomegranateCentral`
```

- [ ] **Step 4: Full verification**

```bash
pnpm run lint
pnpm run check
pnpm test
pnpm run test:e2e -- npub-login.test.js
```

Expected: all green (known-flaky inbox/DM test files excepted per memory — rerun those in isolation if they fail in the full run).

- [ ] **Step 5: Commit**

```bash
git add README.md e2e/COVERAGE.md CLAUDE.md
git commit -m "docs: login-method env vars + Google-login manual test checklist"
```

---

## Execution notes

- **Task order matters:** 1→2→3→4→5 (Phase 1 shippable), then 6→7→8→9→10→**11 (manual gate)**→12→13.
- Task 11 requires the user (real Google account, browser popups). Schedule it explicitly; do not skip to Task 12.
- If the applesauce `NostrConnectSigner` turns out incompatible with promenade's NIP-46 dialect at Task 11, stop and re-plan the signer layer before continuing (spec names the fallback: a thin wrapper around nostr-tools' `BunkerSigner` registered as a custom account type).
