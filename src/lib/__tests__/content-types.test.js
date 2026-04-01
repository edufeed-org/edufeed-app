/**
 * Content Types Tests
 *
 * Tests CONTENT_TYPE_CONFIG, kindToContentType, and getCommunityAvailableContentTypes.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  CONTENT_TYPE_CONFIG,
  CONTENT_TYPE_TO_SECTION,
  kindToContentType,
  getCommunityAvailableContentTypes,
  getRestrictedTabIds,
  getAccessibleTabIds,
  filterEventsByAccess,
  getSectionNameForContentType
} from '$lib/helpers/contentTypes.js';

describe('CONTENT_TYPE_CONFIG', () => {
  it('has entry for kind 30818 (wikis)', () => {
    const config = CONTENT_TYPE_CONFIG[30818];
    expect(config).toBeDefined();
    expect(config.kind).toBe(30818);
    expect(config.name).toBe('Wikis');
    expect(config.supported).toBe(true);
    expect(config.component).toBe('WikisView');
  });
});

describe('kindToContentType', () => {
  it('maps 30818 to wikis', () => {
    expect(kindToContentType(30818)).toBe('wikis');
  });

  it('maps known kinds correctly', () => {
    expect(kindToContentType(9)).toBe('chat');
    expect(kindToContentType(30023)).toBe('articles');
    expect(kindToContentType(30142)).toBe('learning');
    expect(kindToContentType(31923)).toBe('calendar');
  });

  it('returns null for unknown kinds', () => {
    expect(kindToContentType(99999)).toBeNull();
  });
});

describe('getCommunityAvailableContentTypes', () => {
  it('includes wikis when community event has kind 30818', () => {
    const communityEvent = {
      tags: [
        ['content', 'Wikis'],
        ['k', '30818']
      ]
    };

    const result = getCommunityAvailableContentTypes(communityEvent);
    const wikiEntry = result.find((ct) => ct.kind === 30818);

    expect(wikiEntry).toBeDefined();
    expect(/** @type {any} */ (wikiEntry).name).toBe('Wikis');
    expect(/** @type {any} */ (wikiEntry).supported).toBe(true);
    expect(/** @type {any} */ (wikiEntry).enabled).toBe(true);
  });

  it('does not include wikis when community event lacks kind 30818', () => {
    const communityEvent = {
      tags: [
        ['content', 'Chat'],
        ['k', '9']
      ]
    };

    const result = getCommunityAvailableContentTypes(communityEvent);
    const wikiEntry = result.find((ct) => ct.kind === 30818);

    expect(wikiEntry).toBeUndefined();
  });
});

describe('getRestrictedTabIds', () => {
  it('returns empty Set when event is null', () => {
    expect(getRestrictedTabIds(null)).toEqual(new Set());
  });

  it('returns empty Set when no sections have profileList', () => {
    const event = {
      tags: [
        ['content', 'Chat'],
        ['k', '9'],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };
    expect(getRestrictedTabIds(event)).toEqual(new Set());
  });

  it('returns Set with correct tab IDs for sections with profileList', () => {
    const event = {
      tags: [
        ['content', 'Chat'],
        ['k', '9'],
        ['content', 'Learning'],
        ['k', '30142'],
        ['a', '30000:abc123:approved-learners', 'wss://relay.example.com']
      ]
    };
    const result = getRestrictedTabIds(event);
    expect(result).toEqual(new Set(['learning']));
    expect(result.has('chat')).toBe(false);
  });

  it('handles multiple restricted sections', () => {
    const event = {
      tags: [
        ['content', 'Chat'],
        ['k', '9'],
        ['a', '30000:abc123:chat-members', 'wss://relay.example.com'],
        ['content', 'Calendar'],
        ['k', '31923'],
        ['a', '30000:abc123:calendar-members'],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };
    const result = getRestrictedTabIds(event);
    expect(result).toEqual(new Set(['chat', 'calendar']));
    expect(result.has('learning')).toBe(false);
  });

  it('maps calendar kinds to single calendar tab ID', () => {
    const event = {
      tags: [
        ['content', 'Calendar'],
        ['k', '31922'],
        ['k', '31923'],
        ['k', '31924'],
        ['k', '31925'],
        ['a', '30000:abc123:calendar-access']
      ]
    };
    const result = getRestrictedTabIds(event);
    expect(result).toEqual(new Set(['calendar']));
  });
});

describe('CONTENT_TYPE_TO_SECTION', () => {
  it('maps content type IDs to section names', () => {
    expect(CONTENT_TYPE_TO_SECTION.calendar).toBe('Calendar');
    expect(CONTENT_TYPE_TO_SECTION.chat).toBe('Chat');
    expect(CONTENT_TYPE_TO_SECTION.articles).toBe('Articles');
    expect(CONTENT_TYPE_TO_SECTION.forum).toBe('Forum');
    expect(CONTENT_TYPE_TO_SECTION.learning).toBe('Learning');
    expect(CONTENT_TYPE_TO_SECTION.boards).toBe('Boards');
    expect(CONTENT_TYPE_TO_SECTION['social-bookmarks']).toBe('Social Bookmarks');
  });
});

describe('getSectionNameForContentType', () => {
  it('returns section name from old-style event with "Posts"', () => {
    const event = {
      tags: [
        ['content', 'Posts'],
        ['k', '1'],
        ['k', '11']
      ]
    };
    expect(getSectionNameForContentType(event, 'forum')).toBe('Posts');
  });

  it('returns section name from new-style event with "Forum"', () => {
    const event = {
      tags: [
        ['content', 'Forum'],
        ['k', '1'],
        ['k', '11']
      ]
    };
    expect(getSectionNameForContentType(event, 'forum')).toBe('Forum');
  });

  it('returns null for unmapped content type', () => {
    const event = {
      tags: [
        ['content', 'Chat'],
        ['k', '9']
      ]
    };
    expect(getSectionNameForContentType(event, 'forum')).toBeNull();
  });

  it('returns null when event is null', () => {
    expect(getSectionNameForContentType(null, 'forum')).toBeNull();
  });

  it('returns null when contentTypeId is empty', () => {
    const event = {
      tags: [
        ['content', 'Chat'],
        ['k', '9']
      ]
    };
    expect(getSectionNameForContentType(event, '')).toBeNull();
  });

  it('maps calendar kinds (31922/31923) to same section', () => {
    const event = {
      tags: [
        ['content', 'Events'],
        ['k', '31922'],
        ['k', '31923']
      ]
    };
    expect(getSectionNameForContentType(event, 'calendar')).toBe('Events');
  });

  it('handles custom section names', () => {
    const event = {
      tags: [
        ['content', 'Discussions'],
        ['k', '11']
      ]
    };
    expect(getSectionNameForContentType(event, 'forum')).toBe('Discussions');
  });
});

describe('filterEventsByAccess', () => {
  /** @param {Partial<import('nostr-tools').Event>} overrides */
  function makeEvent(overrides) {
    return {
      id: 'e1',
      pubkey: 'author1',
      kind: 1,
      created_at: 0,
      content: '',
      tags: [],
      sig: '',
      ...overrides
    };
  }

  it('returns all events when communityEvent is null', () => {
    const events = [makeEvent({ kind: 11, pubkey: 'a' }), makeEvent({ kind: 30142, pubkey: 'b' })];
    const profileAccess = { getAllowedAuthors: () => null, isLoading: false };
    expect(filterEventsByAccess(events, null, profileAccess)).toEqual(events);
  });

  it('returns all events when no sections are restricted', () => {
    const communityEvent = {
      tags: [
        ['content', 'Forum'],
        ['k', '11'],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };
    const events = [makeEvent({ kind: 11, pubkey: 'a' }), makeEvent({ kind: 30142, pubkey: 'b' })];
    const profileAccess = { getAllowedAuthors: () => null, isLoading: false };
    expect(filterEventsByAccess(events, communityEvent, profileAccess)).toEqual(events);
  });

  it('filters out events from restricted sections when author not allowed', () => {
    const communityEvent = {
      tags: [
        ['content', 'Forum'],
        ['k', '11'],
        ['a', '30000:abc:forum-members', 'wss://relay.example.com'],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };
    const events = [
      makeEvent({ id: 'forum1', kind: 11, pubkey: 'unauthorized' }),
      makeEvent({ id: 'learn1', kind: 30142, pubkey: 'anyone' })
    ];
    const profileAccess = {
      /** @param {string} name */
      getAllowedAuthors: (name) => (name === 'Forum' ? ['allowed1', 'allowed2'] : null),
      isLoading: false
    };
    const result = filterEventsByAccess(events, communityEvent, profileAccess);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('learn1');
  });

  it('allows shared content when sharer is in allowed list but author is not', () => {
    const communityEvent = {
      tags: [
        ['content', 'Learning'],
        ['k', '30142'],
        ['a', '30000:abc:learning-members', 'wss://relay.example.com']
      ]
    };
    const events = [
      makeEvent({ id: 'shared1', kind: 30142, pubkey: 'outsideAuthor', _sharedBy: 'allowedSharer' })
    ];
    const profileAccess = {
      getAllowedAuthors: () => ['allowedSharer', 'otherMember'],
      isLoading: false
    };
    const result = filterEventsByAccess(events, communityEvent, profileAccess);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('shared1');
  });

  it('keeps events from restricted sections when author IS allowed', () => {
    const communityEvent = {
      tags: [
        ['content', 'Forum'],
        ['k', '11'],
        ['a', '30000:abc:forum-members', 'wss://relay.example.com']
      ]
    };
    const events = [makeEvent({ id: 'forum1', kind: 11, pubkey: 'allowed1' })];
    const profileAccess = {
      getAllowedAuthors: () => ['allowed1', 'allowed2'],
      isLoading: false
    };
    const result = filterEventsByAccess(events, communityEvent, profileAccess);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('forum1');
  });

  it('keeps events whose kind has no content type mapping', () => {
    const communityEvent = {
      tags: [
        ['content', 'Forum'],
        ['k', '11'],
        ['a', '30000:abc:forum-members', 'wss://relay.example.com']
      ]
    };
    // kind 7 (reaction) has no contentType mapping — should pass through
    const events = [makeEvent({ id: 'reaction1', kind: 7, pubkey: 'anyone' })];
    const profileAccess = {
      getAllowedAuthors: () => ['allowed1'],
      isLoading: false
    };
    const result = filterEventsByAccess(events, communityEvent, profileAccess);
    expect(result).toHaveLength(1);
  });

  it('returns all events when profileAccess is still loading', () => {
    const communityEvent = {
      tags: [
        ['content', 'Forum'],
        ['k', '11'],
        ['a', '30000:abc:forum-members', 'wss://relay.example.com']
      ]
    };
    const events = [makeEvent({ kind: 11, pubkey: 'unauthorized' })];
    const profileAccess = {
      getAllowedAuthors: () => ['allowed1'],
      isLoading: true
    };
    const result = filterEventsByAccess(events, communityEvent, profileAccess);
    expect(result).toEqual(events);
  });
});

describe('getAccessibleTabIds', () => {
  it('returns empty set when no community event', () => {
    const profileAccess = { canPublish: () => true };
    expect(getAccessibleTabIds(null, profileAccess)).toEqual(new Set());
  });

  it('returns empty set when no restricted sections', () => {
    const event = {
      tags: [
        ['content', 'Chat'],
        ['k', '9'],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };
    const profileAccess = { canPublish: () => true };
    expect(getAccessibleTabIds(event, profileAccess)).toEqual(new Set());
  });

  it('returns tab IDs for sections where canPublish returns true', () => {
    const event = {
      tags: [
        ['content', 'Learning'],
        ['k', '30142'],
        ['a', '30000:abc123:approved-learners', 'wss://relay.example.com']
      ]
    };
    const profileAccess = { canPublish: () => true };
    const result = getAccessibleTabIds(event, profileAccess);
    expect(result).toEqual(new Set(['learning']));
  });

  it('excludes tab IDs where canPublish returns false', () => {
    const event = {
      tags: [
        ['content', 'Learning'],
        ['k', '30142'],
        ['a', '30000:abc123:approved-learners', 'wss://relay.example.com']
      ]
    };
    const profileAccess = { canPublish: () => false };
    const result = getAccessibleTabIds(event, profileAccess);
    expect(result).toEqual(new Set());
  });

  it('handles mixed accessible/inaccessible sections', () => {
    const event = {
      tags: [
        ['content', 'Chat'],
        ['k', '9'],
        ['a', '30000:abc123:chat-members', 'wss://relay.example.com'],
        ['content', 'Calendar'],
        ['k', '31923'],
        ['a', '30000:abc123:calendar-members'],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };
    const profileAccess = {
      /** @param {string} name */
      canPublish: (name) => name === 'Chat'
    };
    const result = getAccessibleTabIds(event, profileAccess);
    expect(result).toEqual(new Set(['chat']));
    expect(result.has('calendar')).toBe(false);
    expect(result.has('learning')).toBe(false);
  });
});
