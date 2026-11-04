/** @vitest-environment node */
// Phone create sheet grouping: Notiz, Lesezeichen, Termin first (only those
// the community filter left visible), everything else as rows.
import { describe, it, expect } from 'vitest';
import { PHONE_QUICK_IDS, phoneCreateGroups } from '../create-hub-phone.js';

/** @param {string} id @param {'create'|'add'|'share'} [section] */
const a = (id, section = 'create') => ({ id, section });

describe('phoneCreateGroups', () => {
  it('quick row in fixed order, only present ids; the rest keeps its order', () => {
    const g = phoneCreateGroups(
      [a('event'), a('note'), a('article'), a('bookmark', 'add'), a('share', 'share')],
      []
    );
    expect(PHONE_QUICK_IDS).toEqual(['note', 'bookmark', 'event']);
    expect(g.quick.map((x) => x.id)).toEqual(['note', 'bookmark', 'event']);
    expect(g.more.map((x) => x.id)).toEqual(['article', 'share']);
  });

  it('a filtered community shrinks the quick row; nothing left yields []', () => {
    expect(phoneCreateGroups([a('event'), a('calendar')], []).quick.map((x) => x.id)).toEqual([
      'event'
    ]);
    const none = phoneCreateGroups([a('calendar')], []);
    expect(none.quick).toEqual([]);
    expect(none.more.map((x) => x.id)).toEqual(['calendar']);
  });

  it('passes suggested actions through untouched', () => {
    const suggested = [a('event')];
    expect(phoneCreateGroups([a('event'), a('note')], suggested).suggested).toBe(suggested);
  });
});
