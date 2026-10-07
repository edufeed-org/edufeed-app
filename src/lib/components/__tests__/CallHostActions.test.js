// @ts-nocheck
/**
 * CallHostActions — the host's / co-host's entries in a participant row's
 * menu (issues "Video-Call: host role" + "mute other participants"). Pure
 * visibility matrix: who sees which action on which seat; the actions
 * themselves are the stage's.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

function Stub() {}
vi.mock('$lib/components/icons', () => ({
  MicOffIcon: Stub,
  VideoIcon: Stub,
  ScreenShareIcon: Stub,
  CloseIcon: Stub,
  StarIcon: Stub
}));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_host_actions_title: () => 'Host actions',
  groups_call_mod_mute: () => 'Mute',
  groups_call_mod_stop_video: () => 'Stop camera',
  groups_call_mod_stop_screen: () => 'Stop screen share',
  groups_call_mod_remove: () => 'Remove from call',
  groups_call_mod_make_cohost: () => 'Make co-host',
  groups_call_mod_revoke_cohost: () => 'Remove co-host'
}));

const { default: CallHostActions } = await import(
  '$lib/components/groups/call/CallHostActions.svelte'
);

const B = 'b'.repeat(64);
function row(extra = {}) {
  return {
    key: `seat:${B}:1`,
    participant: { identity: `${B}:1` },
    pubkey: B,
    isLocal: false,
    micOff: false,
    speaking: false,
    handRaised: false,
    guest: false,
    role: null,
    listenOnly: false,
    pinned: false,
    volume: 1,
    ...extra
  };
}
const ids = (container) =>
  [...container.querySelectorAll('[data-testid^="call-mod-"]')].map((el) => el.dataset.testid);

describe('CallHostActions', () => {
  it('renders nothing for a viewer without a role', () => {
    const { container } = render(CallHostActions, {
      props: { row: row(), myRole: null, onAction: vi.fn() }
    });
    expect(container.querySelector('[data-testid="call-host-actions"]')).toBeNull();
  });

  it('renders nothing on my own row', () => {
    const { container } = render(CallHostActions, {
      props: { row: row({ isLocal: true }), myRole: 'host', onAction: vi.fn() }
    });
    expect(container.querySelector('[data-testid="call-host-actions"]')).toBeNull();
  });

  it('the host gets mute, stop camera, stop screen, make co-host and remove on a member', () => {
    const { container } = render(CallHostActions, {
      props: { row: row(), myRole: 'host', onAction: vi.fn() }
    });
    expect(ids(container)).toEqual([
      'call-mod-mute',
      'call-mod-stop-video',
      'call-mod-stop-screen',
      'call-mod-make-cohost',
      'call-mod-remove'
    ]);
  });

  it('offers "Remove co-host" instead on a co-host, and never a role on a guest or a listener', () => {
    const cohost = render(CallHostActions, {
      props: { row: row({ role: 'cohost' }), myRole: 'host', onAction: vi.fn() }
    });
    expect(ids(cohost.container)).toContain('call-mod-revoke-cohost');
    expect(ids(cohost.container)).not.toContain('call-mod-make-cohost');
    cohost.unmount();

    const guest = render(CallHostActions, {
      props: { row: row({ guest: true }), myRole: 'host', onAction: vi.fn() }
    });
    expect(ids(guest.container)).toEqual([
      'call-mod-mute',
      'call-mod-stop-video',
      'call-mod-stop-screen',
      'call-mod-remove'
    ]);
    guest.unmount();

    const listener = render(CallHostActions, {
      props: { row: row({ listenOnly: true }), myRole: 'host', onAction: vi.fn() }
    });
    expect(ids(listener.container)).not.toContain('call-mod-make-cohost');
  });

  it('a co-host moderates members but not the host and cannot change roles', () => {
    const member = render(CallHostActions, {
      props: { row: row(), myRole: 'cohost', onAction: vi.fn() }
    });
    expect(ids(member.container)).toEqual([
      'call-mod-mute',
      'call-mod-stop-video',
      'call-mod-stop-screen',
      'call-mod-remove'
    ]);
    member.unmount();

    const host = render(CallHostActions, {
      props: { row: row({ role: 'host' }), myRole: 'cohost', onAction: vi.fn() }
    });
    expect(host.container.querySelector('[data-testid="call-host-actions"]')).toBeNull();
  });

  it('disables mute on a seat that is already muted', () => {
    const { container } = render(CallHostActions, {
      props: { row: row({ micOff: true }), myRole: 'host', onAction: vi.fn() }
    });
    expect(container.querySelector('[data-testid="call-mod-mute"]').disabled).toBe(true);
  });

  it('reports the chosen action', async () => {
    const onAction = vi.fn();
    const { container } = render(CallHostActions, {
      props: { row: row({ role: 'cohost' }), myRole: 'host', onAction }
    });
    await fireEvent.click(container.querySelector('[data-testid="call-mod-stop-screen"]'));
    await fireEvent.click(container.querySelector('[data-testid="call-mod-revoke-cohost"]'));
    await fireEvent.click(container.querySelector('[data-testid="call-mod-remove"]'));
    expect(onAction.mock.calls.map((c) => c[0])).toEqual([
      'stop-screen',
      'revoke-cohost',
      'remove'
    ]);
  });
});
