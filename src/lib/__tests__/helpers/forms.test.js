/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { findLinkedProfileLists, buildUserResponseFilter } from '$lib/helpers/forms.js';

/** @param {Partial<import('nostr-tools').NostrEvent>} overrides */
function makeProfileList(overrides = {}) {
  return {
    kind: 30000,
    pubkey: 'abc',
    created_at: 1,
    id: 'id1',
    sig: '',
    content: '',
    tags: [],
    ...overrides
  };
}

describe('buildUserResponseFilter', () => {
  it('returns correct filter shape for user response lookup', () => {
    const filter = buildUserResponseFilter('30168:pubkey1:my-form', 'userpub');
    expect(filter).toEqual({
      kinds: [1069],
      authors: ['userpub'],
      '#a': ['30168:pubkey1:my-form']
    });
  });
});

describe('findLinkedProfileLists', () => {
  it('returns sections whose form tag matches the form address', () => {
    const formAddress = '30168:pubkey1:my-form';
    const events = [
      makeProfileList({
        id: 'list1',
        tags: [
          ['d', 'calendar'],
          ['form', '30168:pubkey1:my-form']
        ]
      }),
      makeProfileList({
        id: 'list2',
        tags: [
          ['d', 'forum'],
          ['form', '30168:pubkey1:my-form']
        ]
      })
    ];

    const result = findLinkedProfileLists(events, formAddress);
    expect(result).toHaveLength(2);
    expect(result[0].sectionName).toBe('calendar');
    expect(result[0].event.id).toBe('list1');
    expect(result[1].sectionName).toBe('forum');
    expect(result[1].event.id).toBe('list2');
  });

  it('returns empty array when no profile lists link to the form', () => {
    const events = [
      makeProfileList({
        tags: [
          ['d', 'calendar'],
          ['form', '30168:other:other-form']
        ]
      })
    ];

    const result = findLinkedProfileLists(events, '30168:pubkey1:my-form');
    expect(result).toEqual([]);
  });

  it('extracts section name from d-tag', () => {
    const events = [
      makeProfileList({
        tags: [
          ['d', 'my-section-name'],
          ['form', '30168:pub:dtag']
        ]
      })
    ];

    const result = findLinkedProfileLists(events, '30168:pub:dtag');
    expect(result[0].sectionName).toBe('my-section-name');
  });

  it('returns empty string for sectionName when d-tag is missing', () => {
    const events = [
      makeProfileList({
        tags: [['form', '30168:pub:dtag']]
      })
    ];

    const result = findLinkedProfileLists(events, '30168:pub:dtag');
    expect(result[0].sectionName).toBe('');
  });
});
