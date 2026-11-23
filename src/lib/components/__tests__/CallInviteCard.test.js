/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const check = vi.hoisted(() => vi.fn());
const remember = vi.hoisted(() => vi.fn());
vi.mock('$lib/groups/quick-call.js', () => ({
  QUICK_CALL_TTL_S: 12 * 3600,
  rememberCallOrigin: remember
}));
vi.mock('$lib/groups/call-passes.js', () => ({ checkCallPass: check }));
const call = vi.hoisted(() => ({ activeKey: /** @type {string | null} */ (null), phase: 'idle' }));
vi.mock('$lib/groups/group-call.svelte.js', () => ({ getGroupCallState: () => call }));
const relays = vi.hoisted(() => ({ list: ['wss://groups.example.com'] }));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getGroupsRelays: () => relays.list }));
vi.mock('$lib/paraglide/messages', () => ({
  dm_call_card_label: () => 'Videoanruf',
  dm_call_card_running: (/** @type {any} */ { count }) => `Läuft gerade · ${count} im Anruf`,
  dm_call_card_waiting: () => 'Noch niemand im Anruf',
  dm_call_card_ended: () => 'Beendet',
  call_landing_join: () => 'Beitreten',
  groups_call_return: () => 'Anruf anzeigen'
}));

import { channelKey } from '$lib/groups/community-pointer.js';
import CallInviteCard from '$lib/components/dm/CallInviteCard.svelte';

const invite = {
  url: 'https://edufeed.org/call/groups.example.com%27room1#k7Qm2xPz9RtLw4Ybk7Qm2x',
  pointer: { id: 'room1', relay: 'wss://groups.example.com/' },
  code: 'k7Qm2xPz9RtLw4Ybk7Qm2x'
};
const now = () => Math.floor(Date.now() / 1000);
const cta = () => screen.queryByTestId('dm-call-invite-join');

beforeEach(() => {
  check.mockReset();
  call.activeKey = null;
  call.phase = 'idle';
});

describe('CallInviteCard', () => {
  it('shows who is in the call and a join button that keeps the link as sent', async () => {
    check.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 2 });
    render(CallInviteCard, { props: { invite, sentAt: now(), peer: 'b'.repeat(64) } });
    await screen.findByText('Läuft gerade · 2 im Anruf');
    expect(check).toHaveBeenCalledWith(invite.pointer.relay, 'room1', invite.code);
    expect(cta()?.getAttribute('href')).toBe(invite.url);
    // the click notes which conversation to come back to
    cta()?.addEventListener('click', (e) => e.preventDefault());
    cta()?.click();
    expect(remember).toHaveBeenCalledWith(invite.pointer, 'b'.repeat(64));
  });

  it('offers the way back instead of joining when this tab is in that call', async () => {
    check.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 1 });
    call.activeKey = channelKey(invite.pointer);
    call.phase = 'ready';
    render(CallInviteCard, { props: { invite, sentAt: now() } });
    await screen.findByText('Läuft gerade · 1 im Anruf');
    expect(cta()?.textContent?.trim()).toBe('Anruf anzeigen');
  });

  it('says so when nobody is in the call yet', async () => {
    check.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 0 });
    render(CallInviteCard, { props: { invite, sentAt: now() } });
    await screen.findByText('Noch niemand im Anruf');
    expect(cta()).not.toBeNull();
  });

  it('a call whose room is gone reads as ended and offers no button', async () => {
    check.mockResolvedValue({ valid: false, reason: 'unknown', liveCount: 0 });
    render(CallInviteCard, { props: { invite, sentAt: now() } });
    await screen.findByText('Beendet');
    expect(cta()).toBeNull();
  });

  it('an old invitation is ended without asking the relay', async () => {
    render(CallInviteCard, { props: { invite, sentAt: now() - 13 * 3600 } });
    await screen.findByText('Beendet');
    expect(check).not.toHaveBeenCalled();
  });

  it('never asks a relay the deployment does not use: the sender chose that address', async () => {
    const foreign = { ...invite, pointer: { id: 'room1', relay: 'wss://tracker.example/' } };
    render(CallInviteCard, { props: { invite: foreign, sentAt: now() } });
    await new Promise((r) => setTimeout(r, 20));
    expect(check).not.toHaveBeenCalled();
    expect(cta()).not.toBeNull();
    expect(screen.queryByText('Beendet')).toBeNull();
  });

  it('keeps the button when the relay cannot be reached', async () => {
    check.mockResolvedValue({ valid: false, reason: 'unreachable', liveCount: 0 });
    render(CallInviteCard, { props: { invite, sentAt: now() } });
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(cta()).not.toBeNull();
    expect(screen.queryByText('Beendet')).toBeNull();
  });
});
