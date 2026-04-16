/**
 * Personal bookmarks store tests
 *
 * Tests the pure logic that the personal-bookmarks store will delegate to:
 * - isEventInList (applesauce-common/helpers) for checking bookmark membership
 * - Correct identification of regular events via e-tags
 * - Correct identification of addressable events via a-tags
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { isEventInList } from 'applesauce-common/helpers';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A kind 10003 bookmark list with e-tags and a-tags */
const bookmarkList = {
  id: 'list1',
  pubkey: 'user1',
  kind: 10003,
  created_at: 1000,
  tags: [
    ['e', 'event-id-1', 'wss://relay.example.com'],
    ['e', 'event-id-2'],
    ['a', '30023:author1:article-d-tag', 'wss://relay.example.com'],
    ['a', '31922:author2:cal-event-d-tag']
  ],
  content: '',
  sig: 'sig1'
};

/** An empty bookmark list (no tags) */
const emptyBookmarkList = {
  id: 'list-empty',
  pubkey: 'user1',
  kind: 10003,
  created_at: 1000,
  tags: [],
  content: '',
  sig: 'sig2'
};

/** A bookmark list with only a-tags (no e-tags) */
const aTagOnlyBookmarkList = {
  id: 'list-a-only',
  pubkey: 'user1',
  kind: 10003,
  created_at: 1000,
  tags: [['a', '30142:educator1:resource-1', 'wss://relay.example.com']],
  content: '',
  sig: 'sig3'
};

// Regular events (matched by e-tag on id)
const bookmarkedNote = {
  id: 'event-id-1',
  pubkey: 'author1',
  kind: 1,
  created_at: 900,
  tags: [],
  content: 'Hello world',
  sig: 'note-sig-1'
};

const secondBookmarkedNote = {
  id: 'event-id-2',
  pubkey: 'author2',
  kind: 1,
  created_at: 950,
  tags: [],
  content: 'Second note',
  sig: 'note-sig-2'
};

const notBookmarkedNote = {
  id: 'not-bookmarked',
  pubkey: 'author2',
  kind: 1,
  created_at: 800,
  tags: [],
  content: 'Not in list',
  sig: 'note-sig-3'
};

// Addressable events (matched by a-tag on kind:pubkey:d-tag)
const bookmarkedArticle = {
  id: 'article-event-id-1',
  pubkey: 'author1',
  kind: 30023,
  created_at: 900,
  tags: [['d', 'article-d-tag']],
  content: 'Article content',
  sig: 'article-sig-1'
};

const bookmarkedCalendarEvent = {
  id: 'cal-event-id-1',
  pubkey: 'author2',
  kind: 31922,
  created_at: 950,
  tags: [['d', 'cal-event-d-tag']],
  content: '',
  sig: 'cal-sig-1'
};

const notBookmarkedArticle = {
  id: 'article-event-id-2',
  pubkey: 'author1',
  kind: 30023,
  created_at: 850,
  tags: [['d', 'different-d-tag']],
  content: 'Another article',
  sig: 'article-sig-2'
};

const educationalResource = {
  id: 'edu-resource-1',
  pubkey: 'educator1',
  kind: 30142,
  created_at: 900,
  tags: [['d', 'resource-1']],
  content: 'Educational content',
  sig: 'edu-sig-1'
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isEventInList - e-tag matching (regular events)', () => {
  it('returns true for an event whose id matches an e-tag', () => {
    expect(isEventInList(bookmarkList, bookmarkedNote)).toBe(true);
  });

  it('returns true for a second bookmarked event', () => {
    expect(isEventInList(bookmarkList, secondBookmarkedNote)).toBe(true);
  });

  it('returns false for an event whose id is not in any e-tag', () => {
    expect(isEventInList(bookmarkList, notBookmarkedNote)).toBe(false);
  });

  it('returns false for any event when the bookmark list is empty', () => {
    expect(isEventInList(emptyBookmarkList, bookmarkedNote)).toBe(false);
  });
});

describe('isEventInList - a-tag matching (addressable events)', () => {
  it('returns true for an addressable event matching a bookmark a-tag', () => {
    expect(isEventInList(bookmarkList, bookmarkedArticle)).toBe(true);
  });

  it('returns true for a calendar event matching a bookmark a-tag', () => {
    expect(isEventInList(bookmarkList, bookmarkedCalendarEvent)).toBe(true);
  });

  it('returns false for an addressable event with a different d-tag', () => {
    expect(isEventInList(bookmarkList, notBookmarkedArticle)).toBe(false);
  });

  it('returns false for an addressable event with matching d-tag but different pubkey', () => {
    const wrongAuthor = {
      ...bookmarkedArticle,
      id: 'wrong-author-event',
      pubkey: 'different-author',
      sig: 'wrong-sig'
    };
    expect(isEventInList(bookmarkList, wrongAuthor)).toBe(false);
  });

  it('returns false for an addressable event with matching d-tag but different kind', () => {
    const wrongKind = {
      ...bookmarkedArticle,
      id: 'wrong-kind-event',
      kind: 30142,
      sig: 'wrong-kind-sig'
    };
    expect(isEventInList(bookmarkList, wrongKind)).toBe(false);
  });

  it('matches an educational resource in an a-tag-only list', () => {
    expect(isEventInList(aTagOnlyBookmarkList, educationalResource)).toBe(true);
  });

  it('does not match a regular event in an a-tag-only list', () => {
    expect(isEventInList(aTagOnlyBookmarkList, bookmarkedNote)).toBe(false);
  });
});

describe('isEventInList - edge cases', () => {
  it('returns false when the list has no tags at all', () => {
    expect(isEventInList(emptyBookmarkList, bookmarkedArticle)).toBe(false);
    expect(isEventInList(emptyBookmarkList, bookmarkedNote)).toBe(false);
  });

  it('does not match on unrelated tag types', () => {
    const listWithOtherTags = {
      ...emptyBookmarkList,
      id: 'list-other-tags',
      tags: [
        ['p', 'event-id-1'],
        ['t', 'hashtag']
      ]
    };
    // Even though event-id-1 appears in a p-tag, it should not count as bookmarked
    expect(isEventInList(listWithOtherTags, bookmarkedNote)).toBe(false);
  });

  it('handles addressable event with explicit d-tag in a-tag', () => {
    // NOTE: We construct fresh event objects here rather than spreading from
    // bookmarkedArticle. Applesauce caches getReplaceableIdentifier() on the
    // event object via a Symbol. Object spread copies Symbol-keyed properties,
    // so a spread-then-override-tags pattern would carry the stale cached
    // identifier from the source object, causing false negatives.
    const listWithDTag = {
      id: 'list-with-d',
      pubkey: 'user1',
      kind: 10003,
      created_at: 1000,
      tags: [['a', '30023:author1:my-article']],
      content: '',
      sig: 'sig-list-d'
    };
    const articleMatch = {
      id: 'match-d-article',
      pubkey: 'author1',
      kind: 30023,
      created_at: 900,
      tags: [['d', 'my-article']],
      content: 'Matching article',
      sig: 'match-d-sig'
    };
    const articleMismatch = {
      id: 'mismatch-d-article',
      pubkey: 'author1',
      kind: 30023,
      created_at: 900,
      tags: [['d', 'other-article']],
      content: 'Non-matching article',
      sig: 'mismatch-d-sig'
    };
    expect(isEventInList(listWithDTag, articleMatch)).toBe(true);
    expect(isEventInList(listWithDTag, articleMismatch)).toBe(false);
  });

  it('regular event id match takes precedence even if kind is addressable', () => {
    // An addressable event whose id also appears as an e-tag should be found
    const listWithBothTags = {
      ...emptyBookmarkList,
      id: 'list-both',
      tags: [['e', 'article-event-id-1']]
    };
    expect(isEventInList(listWithBothTags, bookmarkedArticle)).toBe(true);
  });
});
