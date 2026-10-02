// @ts-nocheck
/**
 * MeetingBar — above a channel's timeline: the next meeting that runs, opens
 * or starts within 24 h ("<title> · heute 14:00 · Beitreten").
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import * as m from '$lib/paraglide/messages';
import { formatTimeOfDay, formatTimestamp } from '$lib/helpers/dates.js';
import MeetingBar from '$lib/components/groups/MeetingBar.svelte';

/** @param {string} title @param {number} start */
const meeting = (title, start) => ({
  id: title,
  kind: 31923,
  pubkey: 'a'.repeat(64),
  tags: [
    ['d', title],
    ['title', title],
    ['start', String(start)],
    ['end', String(start + 3600)],
    ['h', 'g1']
  ]
});

/** Local unix seconds for today/tomorrow at hh:mm, relative to `now`. */
function at(now, dayOffset, hh, mm) {
  const d = new Date(now * 1000);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

afterEach(() => vi.useRealTimers());

describe('MeetingBar', () => {
  it('is hidden without a meeting in the next 24 h', () => {
    const now = Math.floor(Date.now() / 1000);
    render(MeetingBar, { props: { meetings: [meeting('Weit weg', now + 3 * 86400)] } });
    expect(screen.queryByTestId('meeting-bar')).toBeNull();
  });

  it('names a meeting later today with "heute HH:MM" and a disabled join', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fixed = new Date();
    fixed.setHours(9, 0, 0, 0);
    vi.setSystemTime(fixed);
    const now = Math.floor(fixed.getTime() / 1000);
    const start = at(now, 0, 14, 0);
    const onJoin = vi.fn();
    render(MeetingBar, { props: { meetings: [meeting('Elternabend', start)], onJoin } });
    const bar = screen.getByTestId('meeting-bar');
    expect(bar.textContent).toContain('Elternabend');
    expect(bar.textContent).toContain(m.meeting_bar_today({ time: formatTimeOfDay(start) }));
    expect(screen.getByTestId('meeting-bar-join').disabled).toBe(true);
  });

  it('says "morgen" for tomorrow', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fixed = new Date();
    fixed.setHours(20, 0, 0, 0);
    vi.setSystemTime(fixed);
    const now = Math.floor(fixed.getTime() / 1000);
    const start = at(now, 1, 8, 30);
    render(MeetingBar, { props: { meetings: [meeting('Frühstück', start)] } });
    expect(screen.getByTestId('meeting-bar').textContent).toContain(
      m.meeting_bar_tomorrow({ time: formatTimeOfDay(start) })
    );
    // No join button for someone who cannot join.
    expect(screen.queryByTestId('meeting-bar-join')).toBeNull();
  });

  it('gives the date for a meeting still running since yesterday', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fixed = new Date();
    fixed.setHours(0, 30, 0, 0);
    vi.setSystemTime(fixed);
    const now = Math.floor(fixed.getTime() / 1000);
    const start = now - 45 * 60; // 23:45 yesterday, runs until 00:45
    render(MeetingBar, { props: { meetings: [meeting('Nachtschicht', start)] } });
    const day = formatTimestamp(start, { day: '2-digit', month: '2-digit' });
    expect(screen.getByTestId('meeting-bar').textContent).toContain(
      `${day} ${formatTimeOfDay(start)}`
    );
  });

  it('joins a meeting in its window through the channel join', async () => {
    const now = Math.floor(Date.now() / 1000);
    const onJoin = vi.fn();
    render(MeetingBar, {
      props: {
        meetings: [meeting('Später', now + 5 * 3600), meeting('Gleich', now + 600)],
        onJoin
      }
    });
    expect(screen.getByTestId('meeting-bar').textContent).toContain('Gleich');
    const join = screen.getByTestId('meeting-bar-join');
    expect(join.disabled).toBe(false);
    await fireEvent.click(join);
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it('appears once a meeting moves into the next 24 h (30 s clock)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const now = Math.floor(Date.now() / 1000);
    render(MeetingBar, { props: { meetings: [meeting('Morgen', now + 86400 + 20)] } });
    expect(screen.queryByTestId('meeting-bar')).toBeNull();
    vi.advanceTimersByTime(30_000);
    await tick();
    expect(screen.getByTestId('meeting-bar')).toBeTruthy();
  });
});
