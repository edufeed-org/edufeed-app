// @ts-nocheck
/**
 * BreakoutPanel — the host's view of a running session: rooms with their
 * seated people (rosters) and who is live (presence), "move to", "join",
 * the main-room seats, the deadline and "bring everyone back".
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

function Stub() {}
vi.mock('$lib/components/icons', () => ({ CloseIcon: Stub, MeetIcon: Stub, SendIcon: Stub }));
vi.mock(
  '$lib/components/shared/ProfileAvatar.svelte',
  () => import('./fixtures/ProfileAvatarStub.svelte')
);
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map([['b'.repeat(64), { name: 'Bob' }]])
}));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_breakout_title: () => 'Breakout rooms',
  groups_call_breakout_time_left: ({ time }) => `${time} left`,
  groups_call_breakout_room_label: ({ n }) => `Room ${n}`,
  groups_call_breakout_join: () => 'Join',
  groups_call_breakout_empty_room: () => 'Nobody yet',
  groups_call_breakout_in_call_badge: () => 'in the call',
  groups_call_breakout_move_to: () => 'Move to …',
  groups_call_breakout_main_room: () => 'Main room',
  groups_call_breakout_members_in_main: () => 'In the main room',
  groups_call_breakout_panel_hint: () => 'Move people or bring everyone back.',
  groups_call_breakout_host_note: () => 'Host rights apply in the main room only.',
  groups_call_breakout_end_all: () => 'Bring everyone back',
  groups_call_breakout_ending: () => 'Closing rooms …',
  groups_call_breakout_duration: () => 'Duration',
  groups_call_breakout_extend: ({ minutes }) => `+${minutes} min`,
  groups_call_breakout_auto_assign: () => 'Assign late joiners automatically',
  groups_call_breakout_broadcast_title: () => 'Message to all rooms',
  groups_call_breakout_broadcast_placeholder: () => 'A short announcement …',
  groups_call_breakout_broadcast_send: () => 'Send',
  groups_call_breakout_end_confirm_title: () => 'Bring everyone back?',
  groups_call_breakout_end_confirm_body: () => 'The rooms are closed.',
  groups_call_breakout_end_notify: () => 'Announce it first',
  common_cancel: () => 'Cancel',
  common_close: () => 'Close'
}));

import BreakoutPanel from '../groups/call/BreakoutPanel.svelte';

const HOST = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const DAVE = 'd'.repeat(64);
const RELAY = 'wss://r.example/';
const rooms = [
  { id: 'r1', relay: RELAY, name: 'Breakout 1', index: 1 },
  { id: 'r2', relay: RELAY, name: 'Breakout 2', index: 2 }
];
const row = (pubkey, extra = {}) => ({
  key: `seat:${pubkey}`,
  participant: { identity: `${pubkey}:1` },
  pubkey,
  isLocal: false,
  guest: false,
  ...extra
});
function state(over = {}) {
  return {
    session: {
      main: { id: 'main', relay: RELAY, title: 'Seminar' },
      rooms,
      until: 1,
      hosting: true,
      creator: true,
      autoAssign: true,
      channelName: 'Seminar'
    },
    currentRoom: null,
    rooms,
    membersByRoomId: { r1: new Set([HOST, BOB]), r2: new Set([HOST]) },
    presenceByRoomId: { r1: [BOB] },
    remaining: 90,
    busy: false,
    pending: null,
    joinRequest: null,
    ...over
  };
}
const cb = {
  onMove: vi.fn(),
  onJoin: vi.fn(),
  onEnd: vi.fn(),
  onExtend: vi.fn(),
  onAutoAssign: vi.fn(),
  onBroadcast: vi.fn(async () => true),
  onClose: vi.fn()
};
beforeEach(() => Object.values(cb).forEach((fn) => fn.mockClear()));

describe('BreakoutPanel', () => {
  it('lists each room with its seated people (host left out), presence and the deadline', () => {
    render(BreakoutPanel, {
      props: {
        rows: [row(HOST, { isLocal: true }), row(DAVE)],
        breakout: state(),
        myPubkey: HOST,
        ...cb
      }
    });
    const sections = screen.getAllByTestId('breakout-panel-room');
    expect(sections).toHaveLength(2);
    expect(sections[0].textContent).toContain('Room 1');
    expect(sections[0].textContent).toContain('Bob');
    expect(sections[0].textContent).toContain('in the call');
    expect(sections[0].querySelectorAll('[data-testid="breakout-panel-member"]')).toHaveLength(1);
    expect(sections[1].textContent).toContain('Nobody yet');
    expect(screen.getByTestId('breakout-panel-deadline').textContent).toContain('1:30 left');
    // Dave sits in the main room, with a picker into either room
    const main = screen.getByTestId('breakout-panel-main');
    expect(main.querySelectorAll('[data-testid="breakout-panel-main-member"]')).toHaveLength(1);
    expect(screen.getByTestId('breakout-panel').textContent).toContain(
      'Host rights apply in the main room only.'
    );
  });

  it('moves a seated person to another room or back to the main room', async () => {
    render(BreakoutPanel, { props: { rows: [], breakout: state(), myPubkey: HOST, ...cb } });
    const [picker] = screen.getAllByTestId('breakout-panel-move');
    await fireEvent.change(picker, { target: { value: 'r2' } });
    expect(cb.onMove).toHaveBeenCalledWith({ pubkey: BOB, identities: [], toRoomId: 'r2' });
    await fireEvent.change(picker, { target: { value: '' } });
    expect(cb.onMove).toHaveBeenLastCalledWith({ pubkey: BOB, identities: [], toRoomId: null });
  });

  it('sends a main-room seat into a room with its LiveKit identities', async () => {
    render(BreakoutPanel, {
      props: { rows: [row(DAVE), row(CAROL)], breakout: state(), myPubkey: HOST, ...cb }
    });
    const main = screen.getByTestId('breakout-panel-main');
    const pickers = main.querySelectorAll('[data-testid="breakout-panel-move"]');
    expect(pickers).toHaveLength(2);
    await fireEvent.change(pickers[0], { target: { value: 'r1' } });
    expect(cb.onMove).toHaveBeenCalledWith({
      pubkey: DAVE,
      identities: [`${DAVE}:1`],
      toRoomId: 'r1'
    });
  });

  it('joins a room, and brings everyone back after a confirm with the return heads-up on by default', async () => {
    render(BreakoutPanel, { props: { rows: [], breakout: state(), myPubkey: HOST, ...cb } });
    await fireEvent.click(screen.getAllByTestId('breakout-panel-join')[1]);
    expect(cb.onJoin).toHaveBeenCalledWith(rooms[1]);
    await fireEvent.click(screen.getByTestId('breakout-panel-end'));
    expect(cb.onEnd).not.toHaveBeenCalled();
    const confirm = screen.getByTestId('breakout-end-confirm');
    expect(confirm.textContent).toContain('Bring everyone back?');
    expect(screen.getByTestId('breakout-end-notify').checked).toBe(true);
    await fireEvent.click(screen.getByTestId('breakout-end-confirm-action'));
    expect(cb.onEnd).toHaveBeenCalledWith({ notify: true });
    expect(screen.queryByTestId('breakout-end-confirm')).toBeNull();
    await fireEvent.click(screen.getByTestId('breakout-panel-close'));
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('the confirm can be cancelled, and the heads-up switched off', async () => {
    render(BreakoutPanel, { props: { rows: [], breakout: state(), myPubkey: HOST, ...cb } });
    await fireEvent.click(screen.getByTestId('breakout-panel-end'));
    await fireEvent.click(screen.getByTestId('breakout-end-cancel'));
    expect(cb.onEnd).not.toHaveBeenCalled();
    expect(screen.queryByTestId('breakout-end-confirm')).toBeNull();
    await fireEvent.click(screen.getByTestId('breakout-panel-end'));
    await fireEvent.click(screen.getByTestId('breakout-end-notify'));
    await fireEvent.click(screen.getByTestId('breakout-end-confirm-action'));
    expect(cb.onEnd).toHaveBeenCalledWith({ notify: false });
  });

  it('"Nachricht an alle Raeume": sends the draft, clears it on success and keeps it on a refusal', async () => {
    render(BreakoutPanel, { props: { rows: [], breakout: state(), myPubkey: HOST, ...cb } });
    const input = screen.getByTestId('breakout-panel-broadcast-input');
    const send = screen.getByTestId('breakout-panel-broadcast-send');
    expect(send.disabled).toBe(true);
    await fireEvent.input(input, { target: { value: '  two minutes left ' } });
    expect(send.disabled).toBe(false);
    await fireEvent.submit(screen.getByTestId('breakout-panel-broadcast'));
    await waitFor(() => expect(cb.onBroadcast).toHaveBeenCalledWith('two minutes left'));
    await waitFor(() => expect(input.value).toBe(''));
    cb.onBroadcast.mockResolvedValueOnce(false);
    await fireEvent.input(input, { target: { value: 'again' } });
    await fireEvent.submit(screen.getByTestId('breakout-panel-broadcast'));
    await waitFor(() => expect(cb.onBroadcast).toHaveBeenCalledTimes(2));
    expect(input.value).toBe('again');
  });

  it('disables the controls while the store is busy', () => {
    render(BreakoutPanel, {
      props: { rows: [], breakout: state({ busy: true }), myPubkey: HOST, ...cb }
    });
    expect(screen.getByTestId('breakout-panel-end').disabled).toBe(true);
    expect(screen.getByTestId('breakout-panel-end').textContent).toContain('Closing rooms');
    expect(screen.getAllByTestId('breakout-panel-move')[0].disabled).toBe(true);
  });

  it('"+5 min" moves the deadline and the late-joiner switch reflects and sets the session', async () => {
    render(BreakoutPanel, { props: { rows: [], breakout: state(), myPubkey: HOST, ...cb } });
    await fireEvent.click(screen.getByTestId('breakout-panel-extend'));
    expect(cb.onExtend).toHaveBeenCalledWith(5);
    const box = screen.getByTestId('breakout-panel-auto-assign');
    expect(box.checked).toBe(true);
    await fireEvent.click(box);
    expect(cb.onAutoAssign).toHaveBeenCalledWith(false);
  });

  it('shows only the rooms still standing (one the relay deleted is gone)', () => {
    render(BreakoutPanel, {
      props: { rows: [], breakout: state({ rooms: [rooms[1]] }), myPubkey: HOST, ...cb }
    });
    const sections = screen.getAllByTestId('breakout-panel-room');
    expect(sections).toHaveLength(1);
    expect(sections[0].textContent).toContain('Room 2');
    // and the move picker offers no deleted room as a target either
    const main = screen.getByTestId('breakout-panel-main');
    expect(main.querySelectorAll('option[value="r1"]')).toHaveLength(0);
  });
});
