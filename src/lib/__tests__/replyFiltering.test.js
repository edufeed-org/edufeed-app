/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getNip10References } from 'applesauce-common/helpers';

/**
 * Tests the reply filtering logic used on the profile page notes tab.
 * The filter: `!refs?.reply?.e && !refs?.root?.e` keeps only standalone notes.
 */

/** @param {import('nostr-tools').NostrEvent} event */
function isStandaloneNote(event) {
  const refs = getNip10References(event);
  return !refs?.reply?.e && !refs?.root?.e;
}

/** @param {string[][]} [tags] */
function makeEvent(tags = []) {
  return {
    id: 'abc123',
    pubkey: 'pubkey1',
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags,
    content: 'test',
    sig: 'sig'
  };
}

describe('reply filtering for profile notes', () => {
  it('standalone note with no tags is not filtered', () => {
    const event = makeEvent([]);
    expect(isStandaloneNote(event)).toBe(true);
  });

  it('note with only t-tags is not filtered', () => {
    const event = makeEvent([
      ['t', 'nostr'],
      ['t', 'education']
    ]);
    expect(isStandaloneNote(event)).toBe(true);
  });

  it('note with only p-tags (mention, not reply) is not filtered', () => {
    const event = makeEvent([['p', 'somepubkey']]);
    expect(isStandaloneNote(event)).toBe(true);
  });

  it('reply with NIP-10 root+reply markers is filtered', () => {
    const event = makeEvent([
      ['e', 'rootid', '', 'root'],
      ['e', 'replyid', '', 'reply']
    ]);
    expect(isStandaloneNote(event)).toBe(false);
  });

  it('reply with only NIP-10 root marker (direct reply) is filtered', () => {
    const event = makeEvent([['e', 'rootid', '', 'root']]);
    expect(isStandaloneNote(event)).toBe(false);
  });

  it('legacy positional e-tag reply is filtered', () => {
    // No marker in position 3 — legacy positional: first=root, last=reply
    const event = makeEvent([
      ['e', 'rootid'],
      ['e', 'replyid']
    ]);
    expect(isStandaloneNote(event)).toBe(false);
  });

  it('single legacy positional e-tag is filtered (both root and reply)', () => {
    const event = makeEvent([['e', 'someid']]);
    expect(isStandaloneNote(event)).toBe(false);
  });
});
