// @ts-nocheck

/**
 * CALENDAR_HIDDEN_PUBKEYS: bulk calendar sources (our own event mirrors,
 * imported course catalogues) are hidden from the global calendar surfaces by
 * default and shown on request. The list is the ONLY signal: a NIP-24
 * `bot: true` profile does not hide an author by itself — OER World Map is a
 * bot and wanted on the calendar (laoc, 2026-10-24).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

const profiles = vi.hoisted(() => new Map());
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { getReplaceable: (kind, pubkey) => (kind === 0 ? profiles.get(pubkey) : undefined) },
  pool: { request: () => of() }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getAllLookupRelays: () => [] }));
const config = vi.hoisted(() => ({ runtimeConfig: { calendarHiddenPubkeys: [] } }));
vi.mock('$lib/stores/config.svelte.js', () => config);

const {
  initCalendarHiddenSources,
  isHiddenCalendarSource,
  partitionHiddenCalendarSources,
  _resetCalendarSourcesForTesting
} = await import('../calendar-sources.svelte.js');

const MIRROR = 'a'.repeat(64);
const BOT = 'b'.repeat(64);
const HUMAN = 'c'.repeat(64);
const profileEvent = (pubkey, content) => ({
  id: 'p',
  kind: 0,
  pubkey,
  created_at: 1,
  tags: [],
  content: JSON.stringify(content),
  sig: ''
});
const ev = (pubkey, id) => ({ id, pubkey, kind: 31923, start: 10, title: id });

describe('calendar sources', () => {
  beforeEach(() => {
    _resetCalendarSourcesForTesting();
    localStorage.clear();
    profiles.clear();
    config.runtimeConfig.calendarHiddenPubkeys = [];
  });

  it('hides a configured source and nothing else — not even a NIP-24 bot profile', async () => {
    config.runtimeConfig.calendarHiddenPubkeys = [MIRROR];
    await initCalendarHiddenSources();
    profiles.set(BOT, profileEvent(BOT, { name: 'OER World Map', bot: true }));
    profiles.set(HUMAN, profileEvent(HUMAN, { name: 'Ada' }));
    expect(isHiddenCalendarSource(MIRROR)).toBe(true);
    expect(isHiddenCalendarSource(BOT)).toBe(false);
    expect(isHiddenCalendarSource(HUMAN)).toBe(false);
    expect(isHiddenCalendarSource('d'.repeat(64))).toBe(false);
  });

  it('partitions a list into shown and hidden events, keeping the array when nothing is hidden', async () => {
    config.runtimeConfig.calendarHiddenPubkeys = [MIRROR];
    await initCalendarHiddenSources();
    const events = [ev(MIRROR, 'm1'), ev(HUMAN, 'h1'), ev(MIRROR, 'm2')];
    const { shown, hidden } = partitionHiddenCalendarSources(events);
    expect(shown.map((e) => e.id)).toEqual(['h1']);
    expect(hidden).toBe(2);
    const clean = [ev(HUMAN, 'h1')];
    expect(partitionHiddenCalendarSources(clean).shown).toBe(clean);
  });

  it('shows everything when asked to', async () => {
    config.runtimeConfig.calendarHiddenPubkeys = [MIRROR];
    await initCalendarHiddenSources();
    const events = [ev(MIRROR, 'm1'), ev(HUMAN, 'h1')];
    const { shown, hidden } = partitionHiddenCalendarSources(events, { showHidden: true });
    expect(shown).toBe(events);
    expect(hidden).toBe(1);
  });
});
