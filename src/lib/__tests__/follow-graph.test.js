/** @vitest-environment node */
/**
 * Pure helpers behind "N Follower · M Gefolgt" on profiles: who follows a
 * person (contact lists that p-tag them) and whom they follow (their own
 * contact list), and the ordering for the list modal.
 */
import { describe, it, expect } from 'vitest';
import { followingOf, followersFrom, knownFirst } from '$lib/helpers/follow-graph.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const SELF = 'f'.repeat(64);

/** @param {string} pubkey @param {string[]} follows */
const kind3 = (pubkey, follows) => ({
  kind: 3,
  pubkey,
  created_at: 1,
  tags: follows.map((p) => ['p', p]),
  content: ''
});

describe('followingOf', () => {
  it('lists each valid followed pubkey once, without the author', () => {
    const event = kind3(SELF, [A, B, A, SELF, 'nope']);
    event.tags.push(['t', 'x']);
    expect(followingOf(event)).toEqual([A, B]);
  });

  it('is empty without a contact list', () => {
    expect(followingOf(undefined)).toEqual([]);
  });
});

describe('followersFrom', () => {
  it('names each author whose contact list has the subject, once', () => {
    const events = [kind3(A, [SELF]), kind3(B, [C]), kind3(A, [SELF, C]), kind3(C, [SELF])];
    expect(followersFrom(events, SELF)).toEqual([A, C]);
  });

  it('never counts the subject following itself', () => {
    expect(followersFrom([kind3(SELF, [SELF])], SELF)).toEqual([]);
  });
});

describe('knownFirst', () => {
  it('puts the people the viewer follows first, keeping order inside', () => {
    expect(knownFirst([A, B, C], [C, A])).toEqual([A, C, B]);
  });
});
