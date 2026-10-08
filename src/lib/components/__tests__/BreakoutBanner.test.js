// @ts-nocheck
/**
 * BreakoutBanner — "Breakout-Session läuft" for a seat in the main room that
 * is not part of the running session: the rooms with "Beitreten" (a request
 * to the host seat), the deadline, the pending request, and the guest note.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

function Stub() {}
vi.mock('$lib/components/icons', () => ({ ChannelsIcon: Stub }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_breakout_banner_title: () => 'Breakout session running',
  groups_call_breakout_banner_body: () => 'Join a room or stay here.',
  groups_call_breakout_banner_guest: () => 'As a guest you stay in the main room.',
  groups_call_breakout_time_left: ({ time }) => `${time} left`,
  groups_call_breakout_room_label: ({ n }) => `Room ${n}`,
  groups_call_breakout_join: () => 'Join',
  groups_call_breakout_join_requested: () => 'Request sent …'
}));

import BreakoutBanner from '../groups/call/BreakoutBanner.svelte';

const RELAY = 'wss://r.example/';
const rooms = [
  { id: 'r1', relay: RELAY, name: 'Breakout 1', index: 1 },
  { id: 'r2', relay: RELAY, name: 'Breakout 2', index: 2 }
];
const state = (over = {}) => ({
  session: {
    main: { id: 'main', relay: RELAY, title: 'Seminar' },
    rooms,
    until: 1,
    hosting: false
  },
  currentRoom: null,
  rooms,
  membersByRoomId: { r1: new Set(['a', 'b']), r2: new Set(['a']) },
  presenceByRoomId: {},
  remaining: 125,
  busy: false,
  pending: null,
  joinRequest: null,
  ...over
});

describe('BreakoutBanner', () => {
  it('names the session, the deadline and every room with its seats and a Join button', async () => {
    const onJoin = vi.fn();
    render(BreakoutBanner, { props: { breakout: state(), guest: false, onJoin } });
    const banner = screen.getByTestId('breakout-banner');
    expect(banner.textContent).toContain('Breakout session running');
    expect(banner.textContent).toContain('Join a room or stay here.');
    expect(screen.getByTestId('breakout-banner-deadline').textContent).toContain('2:05 left');
    const joins = screen.getAllByTestId('breakout-banner-join');
    expect(joins).toHaveLength(2);
    expect(joins[0].textContent.replace(/\s+/g, ' ')).toContain('Room 1 (2) · Join');
    await fireEvent.click(joins[1]);
    expect(onJoin).toHaveBeenCalledWith(rooms[1]);
  });

  it('shows the pending request on its room and blocks a second one', () => {
    render(BreakoutBanner, {
      props: { breakout: state({ joinRequest: { roomId: 'r2' } }), guest: false, onJoin: vi.fn() }
    });
    const joins = screen.getAllByTestId('breakout-banner-join');
    expect(joins[1].textContent).toContain('Request sent');
    expect(joins.every((b) => b.disabled)).toBe(true);
  });

  it('tells a guest they stay, with no rooms to join', () => {
    render(BreakoutBanner, { props: { breakout: state(), guest: true, onJoin: vi.fn() } });
    expect(screen.getByTestId('breakout-banner-guest').textContent).toContain('As a guest');
    expect(screen.queryAllByTestId('breakout-banner-join')).toHaveLength(0);
  });

  it('leaves the deadline out without one and lists only the rooms still standing', () => {
    render(BreakoutBanner, {
      props: {
        breakout: state({ remaining: null, rooms: [rooms[0]] }),
        guest: false,
        onJoin: vi.fn()
      }
    });
    expect(screen.queryByTestId('breakout-banner-deadline')).toBeNull();
    expect(screen.getAllByTestId('breakout-banner-join')).toHaveLength(1);
  });
});
