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
  kindToContentType,
  getCommunityAvailableContentTypes,
  getRestrictedTabIds,
  getAccessibleTabIds
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
