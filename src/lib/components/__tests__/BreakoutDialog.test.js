// @ts-nocheck
/**
 * BreakoutDialog — the host's "open breakout rooms" form: room count,
 * random or manual assignment, optional duration; guests assignable like
 * members (a "Gast" badge, `guest: true` on their seat so the store never
 * seats them); the relay's refusal shown in place.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

function Stub() {}
vi.mock('$lib/components/icons', () => ({ CloseIcon: Stub }));
const prefs = vi.hoisted(() => ({ autoAssign: /** @type {boolean | null} */ (null) }));
vi.mock('$lib/services/call-prefs.js', () => ({
  getBreakoutAutoAssign: () => prefs.autoAssign,
  setBreakoutAutoAssign: (v) => {
    prefs.autoAssign = v;
  }
}));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_breakout_auto_assign: () => 'Assign late joiners automatically',
  groups_call_breakout_auto_assign_hint: () => 'Newcomers go to the smallest room.',
  groups_call_breakout_title: () => 'Breakout rooms',
  groups_call_breakout_room_count: () => 'Number of rooms',
  groups_call_breakout_assign_random: () => 'Assign randomly',
  groups_call_breakout_assign_manual: () => 'Assign manually',
  groups_call_breakout_duration: () => 'Duration',
  groups_call_breakout_duration_none: () => 'No time limit',
  groups_call_breakout_room_label: ({ n }) => `Room ${n}`,
  groups_call_breakout_main_room: () => 'Main room',
  groups_call_breakout_guest_note: () => 'Guests follow with their link.',
  groups_call_breakout_host_note: () => 'Host rights apply in the main room only.',
  groups_call_breakout_nobody: () => 'Nobody else is in the call.',
  groups_call_breakout_start: () => 'Open rooms',
  groups_call_breakout_starting: () => 'Creating rooms …',
  groups_call_breakout_failed: ({ reason }) => `failed: ${reason}`,
  groups_call_breakout_move_to: () => 'Move to …',
  groups_call_guest_badge: () => 'Gast',
  community_groups_relay_membership_required: () => 'Ask the operator.',
  common_close: () => 'Close',
  common_cancel: () => 'Cancel'
}));

import BreakoutDialog from '../groups/call/BreakoutDialog.svelte';

const row = (identity, extra = {}) => ({
  key: `seat:${identity}`,
  participant: { identity },
  pubkey: identity.slice(0, 64),
  isLocal: false,
  guest: false,
  listenOnly: false,
  ...extra
});
const ME = row('a'.repeat(64) + ':me', { isLocal: true });
const BOB = row('b'.repeat(64) + ':1');
const CAROL = row('c'.repeat(64) + ':1');
const DAVE = row('d'.repeat(64) + ':1');
const GUEST = row('e'.repeat(64) + ':g', { guest: true, pubkey: 'e'.repeat(64) });
const nameOf = (r) => r.participant.identity.slice(0, 1).toUpperCase();

const onStart = vi.fn(async () => {});
const onClose = vi.fn();
beforeEach(() => {
  onStart.mockReset();
  onStart.mockResolvedValue(undefined);
  onClose.mockClear();
  prefs.autoAssign = null;
});

describe('BreakoutDialog', () => {
  it('lists every remote seat as assignable — guests with a badge and the note', () => {
    render(BreakoutDialog, { props: { rows: [ME, BOB, GUEST], nameOf, onStart, onClose } });
    const seats = screen.getAllByTestId('breakout-seat');
    expect(seats).toHaveLength(2);
    expect(seats[1].textContent).toContain('Gast');
    expect(screen.getAllByTestId('breakout-seat-guest-badge')).toHaveLength(1);
    expect(seats[1].getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByTestId('breakout-guest-note').textContent).toContain(
      'Guests follow with their link.'
    );
    expect(screen.getByTestId('breakout-start').disabled).toBe(false);
  });

  it('without guests there is no guest note', () => {
    render(BreakoutDialog, { props: { rows: [ME, BOB], nameOf, onStart, onClose } });
    expect(screen.queryByTestId('breakout-guest-note')).toBeNull();
    expect(screen.queryAllByTestId('breakout-seat-guest-badge')).toHaveLength(0);
  });

  it('cannot start with nobody to assign', () => {
    render(BreakoutDialog, { props: { rows: [ME], nameOf, onStart, onClose } });
    expect(screen.getByTestId('breakout-dialog').textContent).toContain('Nobody else');
    expect(screen.getByTestId('breakout-start').disabled).toBe(true);
  });

  it('random: deals every seat — guests included — into the chosen number of rooms, with the duration', async () => {
    render(BreakoutDialog, {
      props: { rows: [ME, BOB, CAROL, DAVE, GUEST], nameOf, onStart, onClose }
    });
    await fireEvent.change(screen.getByTestId('breakout-room-count'), { target: { value: '3' } });
    await fireEvent.input(screen.getByTestId('breakout-duration'), { target: { value: '15' } });
    await fireEvent.click(screen.getByTestId('breakout-start'));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    const [args] = onStart.mock.calls[0];
    expect(args.roomCount).toBe(3);
    expect(args.durationMinutes).toBe(15);
    expect(args.seats.map((s) => s.pubkey).sort()).toEqual(
      [BOB.pubkey, CAROL.pubkey, DAVE.pubkey, GUEST.pubkey].sort()
    );
    // balanced over three rooms, nobody doubled, only I am left out
    expect(args.seats.map((s) => s.roomIndex).sort()).toEqual([1, 1, 2, 3]);
    expect(args.seats.every((s) => typeof s.identity === 'string')).toBe(true);
    // the store must know which seat is a guest's: no put-user for those
    expect(args.seats.find((s) => s.pubkey === GUEST.pubkey).guest).toBe(true);
    expect(
      args.seats.filter((s) => s.pubkey !== GUEST.pubkey).every((s) => s.guest === false)
    ).toBe(true);
    // late joiners are distributed by default when the split is random
    expect(args.autoAssign).toBe(true);
  });

  it('"Nachzügler automatisch verteilen" follows the mode until chosen, then is remembered on this device', async () => {
    render(BreakoutDialog, { props: { rows: [ME, BOB], nameOf, onStart, onClose } });
    const box = screen.getByTestId('breakout-auto-assign');
    expect(box.checked).toBe(true);
    await fireEvent.click(screen.getByTestId('breakout-mode-manual'));
    expect(box.checked).toBe(false);
    await fireEvent.click(screen.getByTestId('breakout-start'));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(onStart.mock.calls[0][0].autoAssign).toBe(false);
    expect(prefs.autoAssign).toBeNull();
    // an explicit choice sticks across the mode and is stored
    await fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(prefs.autoAssign).toBe(true);
    await fireEvent.click(screen.getByTestId('breakout-mode-random'));
    await fireEvent.click(screen.getByTestId('breakout-mode-manual'));
    expect(screen.getByTestId('breakout-auto-assign').checked).toBe(true);
  });

  it('a remembered "off" wins over the random default', () => {
    prefs.autoAssign = false;
    render(BreakoutDialog, { props: { rows: [ME, BOB], nameOf, onStart, onClose } });
    expect(screen.getByTestId('breakout-auto-assign').checked).toBe(false);
  });

  it('manual: sends only the seats given a room, where the host put them', async () => {
    render(BreakoutDialog, { props: { rows: [ME, BOB, CAROL], nameOf, onStart, onClose } });
    await fireEvent.click(screen.getByTestId('breakout-mode-manual'));
    const pickers = screen.getAllByTestId('breakout-seat-room');
    expect(pickers).toHaveLength(2);
    await fireEvent.change(pickers[1], { target: { value: '2' } });
    await fireEvent.click(screen.getByTestId('breakout-start'));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    const [args] = onStart.mock.calls[0];
    expect(args.durationMinutes).toBeNull();
    expect(args.seats).toEqual([
      { identity: CAROL.participant.identity, pubkey: CAROL.pubkey, roomIndex: 2, guest: false }
    ]);
  });

  it('shows the relay whitelist refusal in friendly words, other errors verbatim', async () => {
    onStart.mockRejectedValueOnce(
      new Error('restricted: only members of this relay can create a group')
    );
    render(BreakoutDialog, { props: { rows: [ME, BOB], nameOf, onStart, onClose } });
    await fireEvent.click(screen.getByTestId('breakout-start'));
    await waitFor(() =>
      expect(screen.getByTestId('breakout-error').textContent).toContain('Ask the operator.')
    );
    onStart.mockRejectedValueOnce(new Error('relay down'));
    await fireEvent.click(screen.getByTestId('breakout-start'));
    await waitFor(() =>
      expect(screen.getByTestId('breakout-error').textContent).toContain('failed: relay down')
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
