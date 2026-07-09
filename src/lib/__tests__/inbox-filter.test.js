/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { filterNotificationsByType } from '../helpers/inbox.js';

/**
 * @param {number} kind
 * @param {string[][]} [tags]
 */
function makeEvent(kind, tags = []) {
  return {
    id: `id-${kind}-${tags.length}`,
    kind,
    created_at: 1000,
    pubkey: 'abc',
    tags,
    content: '',
    sig: ''
  };
}

const reaction = makeEvent(7);
const wave = makeEvent(7, [['k', '0']]);
const comment = makeEvent(1111);
const mention = makeEvent(9);
const rsvp = makeEvent(31925);
const formRequest = makeEvent(1070);
const formResponse = makeEvent(1069);
const all = [reaction, wave, comment, mention, rsvp, formRequest, formResponse];

describe('filterNotificationsByType', () => {
  it('returns everything for "all"', () => {
    expect(filterNotificationsByType(all, 'all')).toEqual(all);
  });

  it('groups form requests and responses under "formRequest"', () => {
    expect(filterNotificationsByType(all, 'formRequest')).toEqual([formRequest, formResponse]);
  });

  it('distinguishes waves from plain reactions', () => {
    expect(filterNotificationsByType(all, 'reaction')).toEqual([reaction]);
    expect(filterNotificationsByType(all, 'wave')).toEqual([wave]);
  });

  it('filters comments, mentions and rsvps by type', () => {
    expect(filterNotificationsByType(all, 'comment')).toEqual([comment]);
    expect(filterNotificationsByType(all, 'mention')).toEqual([mention]);
    expect(filterNotificationsByType(all, 'rsvp')).toEqual([rsvp]);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterNotificationsByType([reaction], 'comment')).toEqual([]);
  });
});
