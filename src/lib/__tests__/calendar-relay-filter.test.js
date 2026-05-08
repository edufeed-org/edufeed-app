/**
 * Calendar Relay Post-Filter Tests
 *
 * Covers the post-filter applied in CalendarView that narrows the set of
 * CalendarEvent wrappers to those whose underlying raw NostrEvent was seen
 * on at least one of the user-selected relays.
 *
 * Regression: previously the filter called getSeenRelays on the wrapper
 * instead of the wrapper's originalEvent, so the Symbol-based seen-relays
 * metadata was unreachable and every event was dropped as soon as the user
 * ticked any relay checkbox.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { addSeenRelay, fakeVerifyEvent } from 'applesauce-core/helpers';
import { filterEventsBySelectedRelays } from '../helpers/calendar.js';

/**
 * @param {string} id
 * @returns {any}
 */
function makeRawEvent(id) {
  const paddedId = id.padEnd(64, '0');
  const event = {
    id: paddedId,
    pubkey: 'deadbeef'.repeat(8),
    created_at: Math.floor(Date.now() / 1000),
    kind: 31923,
    tags: [],
    content: '',
    sig: 'cafebabe'.repeat(16)
  };
  fakeVerifyEvent(event);
  return event;
}

/**
 * Build a CalendarEvent-shaped wrapper around a raw event.
 * Mirrors the shape produced by CalendarEventRangeModel / GlobalCalendarEventModel.
 * @param {string} id
 * @param {string[]} seenRelays
 */
function makeWrappedEvent(id, seenRelays) {
  const raw = makeRawEvent(id);
  for (const r of seenRelays) addSeenRelay(raw, r);
  return {
    id: raw.id,
    pubkey: raw.pubkey,
    kind: raw.kind,
    title: `event ${id}`,
    start: raw.created_at,
    originalEvent: raw
  };
}

describe('filterEventsBySelectedRelays', () => {
  it('returns all events when no relays are selected', () => {
    const a = makeWrappedEvent('a', ['wss://relay.a.example/']);
    const b = makeWrappedEvent('b', ['wss://relay.b.example/']);

    expect(filterEventsBySelectedRelays([a, b], [])).toEqual([a, b]);
  });

  it('keeps events whose originalEvent was seen on a selected relay', () => {
    const a = makeWrappedEvent('a', ['wss://relay.a.example/']);
    const b = makeWrappedEvent('b', ['wss://relay.b.example/']);

    const filtered = filterEventsBySelectedRelays([a, b], ['wss://relay.a.example']);
    expect(filtered).toEqual([a]);
  });

  it('drops events whose originalEvent has no seen-relays metadata', () => {
    const raw = makeRawEvent('no-seen');
    const wrapped = {
      id: raw.id,
      pubkey: raw.pubkey,
      kind: raw.kind,
      start: raw.created_at,
      originalEvent: raw
    };
    expect(filterEventsBySelectedRelays([wrapped], ['wss://relay.a.example'])).toEqual([]);
  });

  it('normalizes relay URLs on both sides (trailing slash, case)', () => {
    const a = makeWrappedEvent('a', ['wss://Relay.A.Example']);

    const filtered = filterEventsBySelectedRelays([a], ['wss://relay.a.example/']);
    expect(filtered).toEqual([a]);
  });

  it('matches when any seen-relay is in the selection (OR semantics)', () => {
    const multi = makeWrappedEvent('multi', ['wss://relay.a.example/', 'wss://relay.b.example/']);

    expect(filterEventsBySelectedRelays([multi], ['wss://relay.b.example'])).toEqual([multi]);
  });

  it('falls back to treating the item itself as the raw event when no wrapper is present', () => {
    const raw = makeRawEvent('bare');
    addSeenRelay(raw, 'wss://relay.a.example/');

    expect(filterEventsBySelectedRelays([raw], ['wss://relay.a.example'])).toEqual([raw]);
  });
});
