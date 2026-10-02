// @ts-nocheck
/**
 * ChannelCallRoster — under an AV channel in a channel list: who is in its
 * call right now (relay-signed kind 39004) and a one-click Join. Renders
 * nothing while the call is empty.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { presence, call, fns, user } = vi.hoisted(() => ({
  presence: { participants: [] },
  call: { active: false, phase: 'ready', stageViews: 0, stageHidden: false, popout: false },
  fns: {
    joinGroupCall: vi.fn(async () => {}),
    showCallStage: vi.fn(),
    onOpen: vi.fn(async () => {})
  },
  user: { current: { pubkey: 'a'.repeat(64), signer: {} } }
}));

vi.mock('$lib/groups/call-presence.svelte.js', () => ({
  useCallPresence: (getPointer) => () => ({
    participants: getPointer() ? presence.participants : [],
    answered: true
  })
}));
vi.mock('$lib/groups/group-call.svelte.js', () => ({
  getGroupCallState: () => ({
    isActiveFor: () => call.active,
    get phase() {
      return call.active ? call.phase : 'idle';
    },
    get stageViews() {
      return call.stageViews;
    },
    get stageHidden() {
      return call.stageHidden;
    }
  }),
  joinGroupCall: (...a) => fns.joinGroupCall(...a),
  showCallStage: (...a) => fns.showCallStage(...a)
}));
vi.mock('$lib/groups/call-popout.svelte.js', () => ({
  getCallPopoutState: () => ({
    get open() {
      return call.popout;
    }
  })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => user.current }));
vi.mock(
  '$lib/components/shared/ProfileAvatar.svelte',
  () => import('./fixtures/ProfileAvatarStub.svelte')
);
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_people_in_call: (p) => `${p.count} in the call`,
  groups_join: () => 'Join',
  groups_call_join_running: (p) => `Join the running call (${p.count})`,
  groups_call_return: () => 'Show call',
  groups_call_in_this_call: (p) => `You're in the call · ${p.count}`
}));

const { default: ChannelCallRoster } = await import(
  '$lib/components/groups/call/ChannelCallRoster.svelte'
);

const POINTER = { id: 'sprech', relay: 'wss://groups.example/' };
const P = (c) => c.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  presence.participants = [];
  call.active = false;
  call.phase = 'ready';
  call.stageViews = 0;
  call.stageHidden = false;
  call.popout = false;
  user.current = { pubkey: P('a'), signer: {} };
});

describe('ChannelCallRoster', () => {
  it('renders nothing while nobody is in the call', () => {
    const { container } = render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    expect(container.querySelector('[data-testid="channel-call-roster"]')).toBeNull();
  });

  it('shows who is in the call, capped avatars plus a count', () => {
    presence.participants = [P('b'), P('c'), P('d'), P('e'), P('f')];
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    expect(screen.getAllByTestId('profile-avatar-stub')).toHaveLength(3);
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByTitle('5 in the call')).toBeTruthy();
  });

  // Design 1a: the running call reads as a soft success pill, "● N im Anruf".
  it('leads with the soft success pill carrying the head count', () => {
    presence.participants = [P('b'), P('c')];
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    const pill = screen.getByTestId('call-count-pill');
    expect(pill.className).toContain('badge');
    expect(pill.className).toContain('badge-soft');
    expect(pill.className).toContain('badge-success');
    expect(pill.textContent).toContain('2 in the call');
  });

  it('Join opens the channel, then joins its call', async () => {
    presence.participants = [P('b')];
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    const button = screen.getByRole('button', { name: 'Join the running call (1)' });
    expect(button.textContent.trim()).toBe('Join');
    await fireEvent.click(button);
    await waitFor(() => expect(fns.joinGroupCall).toHaveBeenCalled());
    expect(fns.onOpen).toHaveBeenCalledTimes(1);
    expect(fns.joinGroupCall).toHaveBeenCalledWith(
      POINTER,
      user.current,
      expect.objectContaining({ title: 'Sprechstunde', href: expect.any(String) })
    );
  });

  it('in that call with its stage on screen: a status line, no button', () => {
    presence.participants = [P('a'), P('b')];
    call.active = true;
    call.stageViews = 1;
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('channel-call-roster-here').textContent).toContain(
      "You're in the call · 2"
    );
  });

  it.each([
    ['no stage mounted (other channel or route)', { stageViews: 0 }],
    ['stage stepped behind the chat', { stageViews: 1, stageHidden: true }],
    ['call popped out into its own window', { stageViews: 1, popout: true }]
  ])('in that call, %s: "Show call" brings it back', async (_label, state) => {
    presence.participants = [P('a')];
    call.active = true;
    Object.assign(call, state);
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Show call' }));
    expect(fns.showCallStage).toHaveBeenCalledTimes(1);
    expect(fns.onOpen).toHaveBeenCalledTimes(1);
    expect(fns.joinGroupCall).not.toHaveBeenCalled();
  });

  // Final review 2 minor: an ENDED (or failed) call of this channel is not
  // one "you are in" — the card offers Join again, not "Show call".
  it.each(['ended', 'error'])('a %s call of this channel offers Join again', async (phase) => {
    presence.participants = [P('b')];
    call.active = true;
    call.phase = phase;
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    expect(screen.queryByRole('button', { name: 'Show call' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Join the running call (1)' }).textContent).toContain(
      'Join'
    );
  });

  it('no Join for an anonymous viewer', () => {
    presence.participants = [P('b')];
    user.current = null;
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('channel-call-roster')).toBeTruthy();
  });
});
