// @ts-nocheck
/**
 * BreakoutBanner — "Breakout-Session läuft" for a seat in the main room that
 * is not part of the running session: the rooms with "Beitreten" (a request
 * to the host seat; for a guest a switch with its pass), the deadline and
 * the pending request. Guests see the same rooms as members.
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
  groups_call_breakout_time_left: ({ time }) => `${time} left`,
  groups_call_breakout_room_label: ({ n }) => `Room ${n}`,
  groups_call_breakout_join: () => 'Join',
  groups_call_breakout_join_requested: () => 'Request sent …',
  groups_call_breakout_banner_host_assigns: () => 'The host will assign you to a room.'
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
    render(BreakoutBanner, { props: { breakout: state(), onJoin } });
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

  it('when the host keeps the assignment to themselves it names the session and the deadline, no rooms', () => {
    const onJoin = vi.fn();
    const s = state();
    s.session = { ...s.session, selfJoin: false };
    render(BreakoutBanner, { props: { breakout: s, onJoin } });
    expect(screen.getByText('Breakout session running')).toBeTruthy();
    expect(screen.getByTestId('breakout-banner-deadline')).toBeTruthy();
    expect(screen.getByText('The host will assign you to a room.')).toBeTruthy();
    expect(screen.queryByText('Join a room or stay here.')).toBeNull();
    expect(screen.queryAllByTestId('breakout-banner-join')).toHaveLength(0);
  });

  it('shows the pending request on its room and blocks a second one', () => {
    render(BreakoutBanner, {
      props: { breakout: state({ joinRequest: { roomId: 'r2' } }), onJoin: vi.fn() }
    });
    const joins = screen.getAllByTestId('breakout-banner-join');
    expect(joins[1].textContent).toContain('Request sent');
    expect(joins.every((b) => b.disabled)).toBe(true);
  });

  it('leaves the deadline out without one and lists only the rooms still standing', () => {
    render(BreakoutBanner, {
      props: {
        breakout: state({ remaining: null, rooms: [rooms[0]] }),
        onJoin: vi.fn()
      }
    });
    expect(screen.queryByTestId('breakout-banner-deadline')).toBeNull();
    expect(screen.getAllByTestId('breakout-banner-join')).toHaveLength(1);
  });
});
