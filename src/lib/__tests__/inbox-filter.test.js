/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { filterNotificationsByType } from '../helpers/inbox.js';

/**
 * @param {number} kind
 * @param {string[][]} [tags]
 * @param {string} [id]
 */
function makeEvent(kind, tags = [], id = `id-${kind}-${tags.length}`) {
  return {
    id,
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
const reply = makeEvent(1, [['e', 'root']], 'id-reply');
const noteMention = makeEvent(1, [['p', 'abc']], 'id-note-mention');
const all = [reaction, wave, comment, mention, rsvp, formRequest, formResponse, reply, noteMention];

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

  it('filters comments and rsvps by type', () => {
    expect(filterNotificationsByType(all, 'comment')).toEqual([comment]);
    expect(filterNotificationsByType(all, 'rsvp')).toEqual([rsvp]);
  });

  it('separates kind 1 replies from NIP-22 comments', () => {
    expect(filterNotificationsByType(all, 'reply')).toEqual([reply]);
  });

  it('groups community mentions and kind 1 note mentions under "mention"', () => {
    expect(filterNotificationsByType(all, 'mention')).toEqual([mention, noteMention]);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterNotificationsByType([reaction], 'comment')).toEqual([]);
  });
});
