// @ts-nocheck
/** @vitest-environment jsdom */
// GroupAppStage hosts a webxdc session shared in a group channel above the
// timeline. The important behaviour to lock in: it wires WebxdcPlayer to the
// RELAY-backed group sync (Task 3's createGroupSync), never the solo
// localStorage fallback — that's the difference between "shared session" and
// "everyone plays alone". See src/lib/webxdc/group-sync.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { of, throwError } from 'rxjs';

// Pool mock pattern follows src/lib/__tests__/my-groups-relays.svelte.test.js:
// override just the pieces GroupAppStage/createGroupSync touch. `subscription`
// is a shared spy so tests can prove a fresh createGroupSync() ran (each call
// opens its state subscription once backfill resolves) without reaching into
// internals. `poolHolder.relay` is per-test swappable (defaults set in
// beforeEach) so the auth-retry/load-error tests can make `request()` fail.
const holders = vi.hoisted(() => ({ subscriptionCalls: /** @type {any[][]} */ ([]) }));
const poolHolder = vi.hoisted(() => ({ relay: /** @type {(url: any) => any} */ (null) }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: (/** @type {any} */ url) => poolHolder.relay(url) }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: null } }));

// WebxdcPlayer (mounted by GroupAppStage) imports useUserProfile for the
// collaborative-cursor display name. Its real module chain reaches
// profile-subscription.js, which calls createAddressLoader(pool, ...) at
// import time — against this file's mocked (pool-only) nostr-infrastructure
// module, that throws during collection ("no eventStore export"), killing
// every test in the file before any of them run. Same mock shape as
// NoteCard.test.js and friends.
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

vi.mock('$lib/paraglide/messages', () => ({
  webxdc_session_stage_close: () => 'Close app',
  webxdc_session_publish_failed: (/** @type {{reason: string}} */ { reason }) =>
    `Could not save app state: ${reason}`,
  webxdc_session_load_failed: (/** @type {{reason: string}} */ { reason }) =>
    `Could not load the shared session: ${reason}`,
  webxdc_app_type: () => 'Interactive app',
  webxdc_launch: () => 'Launch',
  webxdc_loading: () => 'Loading app…',
  webxdc_fullscreen: () => 'Fullscreen',
  webxdc_close: () => 'Close',
  webxdc_error_fetch: () => 'The app package could not be downloaded.',
  webxdc_error_integrity: () => 'checksum mismatch',
  webxdc_error_invalid: () => 'invalid package',
  webxdc_error_timeout: () => 'did not start in time',
  webxdc_retry: () => 'Retry'
}));

const { default: GroupAppStage } = await import('$lib/components/groups/GroupAppStage.svelte');

const pointer = { relay: 'wss://relay.example', id: 'group1' };
const session = {
  sessionId: 'session-1',
  app: {
    url: 'https://example.com/app.xdc',
    sha256: 'ab'.repeat(32),
    name: 'Shared Quiz',
    iconUrl: ''
  }
};

/** Default relay: empty, immediately-completing backfill page + a tracked
 * live subscription — no real network round trip. */
function defaultRelay() {
  return {
    request: () => of(),
    subscription: (/** @type {any[]} */ ...args) => {
      holders.subscriptionCalls.push(args);
      return { subscribe: () => ({ unsubscribe: () => {} }) };
    }
  };
}

function renderStage(overrides = {}) {
  return render(GroupAppStage, {
    props: {
      pointer,
      session,
      selfPubkey: 'f'.repeat(64),
      publish: vi.fn(async (t) => t),
      onShareText: vi.fn(),
      onClose: vi.fn(),
      ...overrides
    }
  });
}

describe('GroupAppStage', () => {
  beforeEach(() => {
    localStorage.clear();
    holders.subscriptionCalls = [];
    poolHolder.relay = defaultRelay;
    // Auto-launch fires on mount (see brief step 4) and would otherwise hit
    // the real network in this jsdom environment — keep it deterministic.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network disabled in test');
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the app name and a close button', () => {
    const { getByTestId, getByText } = renderStage();
    expect(getByTestId('group-app-stage').textContent).toContain('Shared Quiz');
    expect(getByText('Close app')).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    const { getByText } = renderStage({ onClose });
    await fireEvent.click(getByText('Close app'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wires the player to the group sync, not the local/solo fallback', () => {
    renderStage();
    // createLocalSync (the solo fallback) keys its storage `webxdc:state:*`.
    // If GroupAppStage failed to pass its relay-backed sync through to
    // WebxdcPlayer, that fallback would engage and touch localStorage.
    const keys = Object.keys(localStorage);
    expect(keys.some((k) => k.startsWith('webxdc:state:'))).toBe(false);
  });

  it('opens a fresh session sync on remount with a different session (mirrors the {#key} remount in GroupChat)', async () => {
    // createGroupSync opens its state subscription once its (paginated)
    // backfill resolves — one subscription() call per createGroupSync() call
    // is a reliable proxy for "a fresh sync was built". GroupChat wraps the
    // stage in {#key activeSession.sessionId}, so switching to a different
    // shared app destroys the old component (and its sync) and mounts a new
    // one — unmount()+render() here is the same lifecycle a key change
    // produces.
    const { unmount } = renderStage({ session });
    await vi.waitFor(() => expect(holders.subscriptionCalls.length).toBe(1));

    unmount();

    const otherSession = {
      sessionId: 'session-2',
      app: { ...session.app, name: 'Other App' }
    };
    renderStage({ session: otherSession });
    await vi.waitFor(() => expect(holders.subscriptionCalls.length).toBe(2));
  });

  it('shows a load-failed banner (not the publish-failed one) when the backfill request errors', async () => {
    poolHolder.relay = () => ({
      request: () => throwError(() => new Error('boom: relay hiccup')),
      subscription: (/** @type {any[]} */ ...args) => {
        holders.subscriptionCalls.push(args);
        return { subscribe: () => ({ unsubscribe: () => {} }) };
      }
    });
    const { findByText, queryByText } = renderStage();
    await findByText('Could not load the shared session: boom: relay hiccup');
    expect(queryByText(/Could not save app state/)).toBeNull();
  });

  it('retries the backfill via the authenticate prop after an auth-required error, then loads cleanly', async () => {
    let attempt = 0;
    poolHolder.relay = () => ({
      request: () => {
        attempt++;
        return attempt === 1
          ? throwError(() => new Error('auth-required: please authenticate'))
          : of();
      },
      subscription: (/** @type {any[]} */ ...args) => {
        holders.subscriptionCalls.push(args);
        return { subscribe: () => ({ unsubscribe: () => {} }) };
      }
    });
    const authenticate = vi.fn(async () => ({ ok: true }));
    const { queryByText } = renderStage({ authenticate });

    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(holders.subscriptionCalls.length).toBe(1));
    expect(queryByText(/Could not load the shared session/)).toBeNull();
  });
});
