// @ts-nocheck
/** @vitest-environment jsdom */
// GroupAppStage hosts a webxdc session shared in a group channel above the
// timeline. The important behaviour to lock in: it wires WebxdcPlayer to the
// RELAY-backed group sync (Task 3's createGroupSync), never the solo
// localStorage fallback — that's the difference between "shared session" and
// "everyone plays alone". See src/lib/webxdc/group-sync.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// Pool mock pattern follows src/lib/__tests__/my-groups-relays.svelte.test.js:
// override just the pieces GroupAppStage/createGroupSync touch. `subscription`
// is a shared spy so tests can prove a fresh createGroupSync() ran (each call
// opens its state subscription immediately) without reaching into internals.
const holders = vi.hoisted(() => ({ subscriptionCalls: /** @type {any[][]} */ ([]) }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: () => ({
      subscription: (...args) => {
        holders.subscriptionCalls.push(args);
        return { subscribe: () => ({ unsubscribe: () => {} }) };
      }
    })
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: null } }));

vi.mock('$lib/paraglide/messages', () => ({
  webxdc_session_stage_close: () => 'Close app',
  webxdc_session_publish_failed: (/** @type {{reason: string}} */ { reason }) =>
    `Could not save app state: ${reason}`,
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

  it('opens a fresh session sync on remount with a different session (mirrors the {#key} remount in GroupChat)', () => {
    // createGroupSync opens its state subscription synchronously at
    // construction — one subscription() call per createGroupSync() call is
    // a reliable proxy for "a fresh sync was built". GroupChat wraps the
    // stage in {#key activeSession.sessionId}, so switching to a different
    // shared app destroys the old component (and its sync) and mounts a new
    // one — unmount()+render() here is the same lifecycle a key change
    // produces.
    const { unmount } = renderStage({ session });
    expect(holders.subscriptionCalls.length).toBe(1);

    unmount();

    const otherSession = {
      sessionId: 'session-2',
      app: { ...session.app, name: 'Other App' }
    };
    renderStage({ session: otherSession });
    expect(holders.subscriptionCalls.length).toBe(2);
  });
});
