/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { toImportEvents } from '$lib/helpers/calendar-import/events.js';

describe('toImportEvents', () => {
  it('normalises a valid timed row to kind 31923 with matching endDate', () => {
    const [event] = toImportEvents({
      events: [{ title: 'Teamsitzung', startDate: '2026-09-10', startTime: '9:00' }]
    });
    expect(event.kind).toBe(31923);
    expect(event.startTime).toBe('09:00');
    expect(event.endDate).toBe(event.startDate);
    expect(event.allDay).toBe(false);
  });

  it('caps the title at 200 and the location at 300 characters', () => {
    const [event] = toImportEvents({
      events: [{ title: 'T'.repeat(500), startDate: '2026-09-10', location: 'L'.repeat(500) }]
    });
    expect(event.title).toHaveLength(200);
    expect(event.location).toHaveLength(300);
  });

  it('treats an explicit allDay row without times as kind 31922', () => {
    const [event] = toImportEvents({
      events: [{ title: 'Workshop', startDate: '2026-09-24', allDay: true }]
    });
    expect(event.kind).toBe(31922);
    expect(event.allDay).toBe(true);
    expect(event.startTime).toBeUndefined();
  });

  it('normalises 12-hour times, including the AM/PM midnight/noon edge cases', () => {
    const [noon] = toImportEvents({
      events: [{ title: 'A', startDate: '2026-01-01', startTime: '12:00 PM' }]
    });
    expect(noon.startTime).toBe('12:00');

    const [midnight] = toImportEvents({
      events: [{ title: 'B', startDate: '2026-01-01', startTime: '12:00 AM' }]
    });
    expect(midnight.startTime).toBe('00:00');
  });

  it('flags an impossible date with problem: date and no dTag', () => {
    const [event] = toImportEvents({
      events: [{ title: 'Broken', startDate: '2026-13-40' }]
    });
    expect(event.problem).toBe('date');
    expect(event.dTag).toBeUndefined();
    expect(event.title).toBe('Broken');
  });

  it('flags an empty title with problem: title', () => {
    const [event] = toImportEvents({
      events: [{ title: '   ', startDate: '2026-09-10' }]
    });
    expect(event.problem).toBe('title');
    expect(event.title).toBe('?');
  });

  it('collapses two identical rows into a single event (same key for a keyed {#each})', () => {
    const events = toImportEvents({
      events: [
        { title: 'Teamsitzung', startDate: '2026-09-10', startTime: '09:00' },
        { title: 'Teamsitzung', startDate: '2026-09-10', startTime: '09:00' }
      ]
    });
    expect(events).toHaveLength(1);
  });

  it('drops a later duplicate dTag but keeps a row with a changed title', () => {
    const events = toImportEvents({
      events: [
        { title: 'Same', startDate: '2026-09-10', startTime: '09:00' },
        { title: 'Same', startDate: '2026-09-10', startTime: '09:00' },
        { title: 'Different', startDate: '2026-09-10', startTime: '09:00' }
      ]
    });
    expect(events).toHaveLength(2);
    expect(events[0].dTag).not.toBe(events[1].dTag);
    expect(events[0].key).toBe(events[0].dTag);
  });

  it('resets an endDate earlier than startDate back to startDate', () => {
    const [event] = toImportEvents({
      events: [{ title: 'Oops', startDate: '2026-09-10', endDate: '2026-09-01' }]
    });
    expect(event.endDate).toBe('2026-09-10');
  });

  it('resets an unparseable or impossible endDate back to startDate', () => {
    const [garbage] = toImportEvents({
      events: [{ title: 'A', startDate: '2026-09-10', endDate: 'garbage' }]
    });
    expect(garbage.endDate).toBe('2026-09-10');

    const [impossible] = toImportEvents({
      events: [{ title: 'B', startDate: '2026-09-10', endDate: '2026-02-30' }]
    });
    expect(impossible.endDate).toBe('2026-09-10');
  });

  it('rejects out-of-range minutes, leaving the row without a time (allDay)', () => {
    const [event] = toImportEvents({
      events: [{ title: 'Odd time', startDate: '2026-09-10', startTime: '9:75' }]
    });
    expect(event.startTime).toBeUndefined();
    expect(event.allDay).toBe(true);
  });

  it('drops a stray startTime/endTime when the row is marked allDay', () => {
    const [event] = toImportEvents({
      events: [
        {
          title: 'Forced all-day',
          startDate: '2026-09-10',
          startTime: '09:00',
          endTime: '10:00',
          allDay: true
        }
      ]
    });
    expect(event.allDay).toBe(true);
    expect(event.startTime).toBeUndefined();
    expect(event.endTime).toBeUndefined();
  });

  it('uses a row-index key for problem rows', () => {
    const [event] = toImportEvents({ events: [{ title: '', startDate: '2026-09-10' }] });
    expect(event.key).toBe('row-0');
  });
});
