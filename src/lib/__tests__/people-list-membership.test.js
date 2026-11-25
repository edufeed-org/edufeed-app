/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { listMembership, pickablePeopleLists } from '$lib/helpers/people-list-membership.js';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const HIDDEN = Symbol.for('hidden-tags');

/**
 * @param {string} d
 * @param {string[][]} tags
 * @param {string} [content]
 * @returns {any}
 */
const list = (d, tags = [], content = '') => ({
  kind: 30000,
  pubkey: ME,
  created_at: 1,
  content,
  tags: [['d', d], ...tags]
});

describe('listMembership', () => {
  it('is public when a p tag names the person', () => {
    expect(listMembership(list('x', [['p', BOB]]), BOB)).toBe('public');
  });

  it('is none for a list without private part and without the person', () => {
    expect(listMembership(list('x', [['p', ME]]), BOB)).toBe('none');
  });

  it('is locked when a private part exists that was not decrypted', () => {
    expect(listMembership(list('x', [], 'ciphertext'), BOB)).toBe('locked');
  });

  it('reads an unlocked private part', () => {
    const l = list('x', [], 'ciphertext');
    l[HIDDEN] = [['p', BOB]];
    expect(listMembership(l, BOB)).toBe('hidden');
    l[HIDDEN] = [['p', ME]];
    expect(listMembership(l, BOB)).toBe('none');
  });

  it('public wins over a locked private part', () => {
    expect(listMembership(list('x', [['p', BOB]], 'ciphertext'), BOB)).toBe('public');
  });
});

describe('pickablePeopleLists', () => {
  it('keeps kind 30000 lists, drops community membership, sorts by title', () => {
    const lists = [
      list('communities', [['title', 'Communities']]),
      list('b', [['title', 'beta']]),
      list('a', [['title', 'Alpha']]),
      { ...list('z'), kind: 30003 }
    ];
    expect(pickablePeopleLists(lists).map((l) => l.tags[0][1])).toEqual(['a', 'b']);
  });
});
