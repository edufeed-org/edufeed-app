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

  it('gives identical rows the same dTag, and a changed title a different one', () => {
    const [a, b, c] = toImportEvents({
      events: [
        { title: 'Same', startDate: '2026-09-10', startTime: '09:00' },
        { title: 'Same', startDate: '2026-09-10', startTime: '09:00' },
        { title: 'Different', startDate: '2026-09-10', startTime: '09:00' }
      ]
    });
    expect(a.dTag).toBe(b.dTag);
    expect(a.dTag).not.toBe(c.dTag);
    expect(a.key).toBe(a.dTag);
  });

  it('resets an endDate earlier than startDate back to startDate', () => {
    const [event] = toImportEvents({
      events: [{ title: 'Oops', startDate: '2026-09-10', endDate: '2026-09-01' }]
    });
    expect(event.endDate).toBe('2026-09-10');
  });

  it('uses a row-index key for problem rows', () => {
    const [event] = toImportEvents({ events: [{ title: '', startDate: '2026-09-10' }] });
    expect(event.key).toBe('row-0');
  });
});
