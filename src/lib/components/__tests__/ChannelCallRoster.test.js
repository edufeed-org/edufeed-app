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
  call: { active: false },
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
      return call.active ? 'ready' : 'idle';
    }
  }),
  joinGroupCall: (...a) => fns.joinGroupCall(...a),
  showCallStage: (...a) => fns.showCallStage(...a)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => user.current }));
vi.mock(
  '$lib/components/shared/ProfileAvatar.svelte',
  () => import('./fixtures/ProfileAvatarStub.svelte')
);
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_people_in_call: (p) => `${p.count} in the call`,
  groups_call_join: () => 'Join call',
  groups_call_return: () => 'Back to call',
  groups_call_live: () => 'Call live'
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

  it('Join opens the channel, then joins its call', async () => {
    presence.participants = [P('b')];
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
    await waitFor(() => expect(fns.joinGroupCall).toHaveBeenCalled());
    expect(fns.onOpen).toHaveBeenCalledTimes(1);
    expect(fns.joinGroupCall).toHaveBeenCalledWith(
      POINTER,
      user.current,
      expect.objectContaining({ title: 'Sprechstunde', href: expect.any(String) })
    );
  });

  it('already in that call: the button goes back to it instead', async () => {
    presence.participants = [P('a')];
    call.active = true;
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Back to call' }));
    expect(fns.showCallStage).toHaveBeenCalledTimes(1);
    expect(fns.onOpen).toHaveBeenCalledTimes(1);
    expect(fns.joinGroupCall).not.toHaveBeenCalled();
  });

  it('no Join for an anonymous viewer', () => {
    presence.participants = [P('b')];
    user.current = null;
    render(ChannelCallRoster, {
      props: { pointer: POINTER, name: 'Sprechstunde', onOpen: fns.onOpen }
    });
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
    expect(screen.getByTestId('channel-call-roster')).toBeTruthy();
  });
});
