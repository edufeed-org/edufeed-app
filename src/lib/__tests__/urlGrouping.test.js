/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  extractUrlFromEvent,
  filterSocialBookmarks,
  groupByUrl
} from '$lib/helpers/urlGrouping.js';

describe('normalizeUrl', () => {
  it('strips https:// scheme', () => {
    expect(normalizeUrl('https://example.com/post')).toBe('example.com/post');
  });

  it('strips http:// scheme', () => {
    expect(normalizeUrl('http://example.com/post')).toBe('example.com/post');
  });

  it('strips www. prefix', () => {
    expect(normalizeUrl('https://www.example.com/post')).toBe('example.com/post');
  });

  it('strips trailing slash', () => {
    expect(normalizeUrl('https://example.com/post/')).toBe('example.com/post');
  });

  it('lowercases hostname', () => {
    expect(normalizeUrl('https://Example.COM/Post')).toBe('example.com/Post');
  });

  it('handles URLs without scheme (d-tag style)', () => {
    expect(normalizeUrl('example.com/post')).toBe('example.com/post');
  });

  it('preserves query parameters', () => {
    expect(normalizeUrl('https://example.com/post?id=1')).toBe('example.com/post?id=1');
  });

  it('preserves fragments', () => {
    expect(normalizeUrl('https://example.com/post#section')).toBe('example.com/post#section');
  });

  it('handles root domain with no path', () => {
    expect(normalizeUrl('https://example.com')).toBe('example.com');
  });

  it('handles root domain with trailing slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('example.com');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl(undefined)).toBe('');
    expect(normalizeUrl(null)).toBe('');
  });
});

describe('extractUrlFromEvent', () => {
  it('extracts d-tag from kind 39701 bookmark', () => {
    const event = {
      kind: 39701,
      tags: [['d', 'alice.blog/post']],
      content: '',
      created_at: 1000
    };
    expect(extractUrlFromEvent(event)).toBe('alice.blog/post');
  });

  it('extracts r-tag from kind 9802 highlight', () => {
    const event = {
      kind: 9802,
      tags: [['r', 'https://alice.blog/post']],
      content: 'highlighted text',
      created_at: 1000
    };
    expect(extractUrlFromEvent(event)).toBe('https://alice.blog/post');
  });

  it('extracts I-tag from kind 1111 page note', () => {
    const event = {
      kind: 1111,
      tags: [
        ['I', 'https://alice.blog/post'],
        ['K', 'web']
      ],
      content: 'a note',
      created_at: 1000
    };
    expect(extractUrlFromEvent(event)).toBe('https://alice.blog/post');
  });

  it('returns undefined for kind 9802 without r-tag', () => {
    const event = {
      kind: 9802,
      tags: [['a', '30023:pubkey:id']],
      content: 'highlighted text',
      created_at: 1000
    };
    expect(extractUrlFromEvent(event)).toBeUndefined();
  });

  it('returns undefined for kind 1111 without K=web', () => {
    const event = {
      kind: 1111,
      tags: [
        ['I', 'https://example.com'],
        ['K', '31923']
      ],
      content: 'comment',
      created_at: 1000
    };
    expect(extractUrlFromEvent(event)).toBeUndefined();
  });

  it('returns undefined for unsupported kinds', () => {
    const event = { kind: 1, tags: [], content: '', created_at: 1000 };
    expect(extractUrlFromEvent(event)).toBeUndefined();
  });
});

describe('filterSocialBookmarks', () => {
  it('keeps kind 39701 bookmarks', () => {
    const events = [
      { id: '1', kind: 39701, tags: [['d', 'example.com/post']], content: '', created_at: 1000 }
    ];
    expect(filterSocialBookmarks(events)).toHaveLength(1);
  });

  it('keeps kind 9802 with r-tag (URL highlights)', () => {
    const events = [
      {
        id: '1',
        kind: 9802,
        tags: [['r', 'https://example.com/post']],
        content: 'text',
        created_at: 1000
      }
    ];
    expect(filterSocialBookmarks(events)).toHaveLength(1);
  });

  it('excludes kind 9802 without r-tag (Nostr highlights)', () => {
    const events = [
      {
        id: '1',
        kind: 9802,
        tags: [['a', '30023:pubkey:id']],
        content: 'text',
        created_at: 1000
      }
    ];
    expect(filterSocialBookmarks(events)).toHaveLength(0);
  });

  it('keeps kind 1111 with K=web', () => {
    const events = [
      {
        id: '1',
        kind: 1111,
        tags: [
          ['I', 'https://example.com'],
          ['K', 'web']
        ],
        content: 'note',
        created_at: 1000
      }
    ];
    expect(filterSocialBookmarks(events)).toHaveLength(1);
  });

  it('excludes kind 1111 with K=numeric (event comments)', () => {
    const events = [
      {
        id: '1',
        kind: 1111,
        tags: [
          ['I', 'https://example.com'],
          ['K', '31923']
        ],
        content: 'comment',
        created_at: 1000
      }
    ];
    expect(filterSocialBookmarks(events)).toHaveLength(0);
  });

  it('excludes unrelated kinds', () => {
    const events = [{ id: '1', kind: 1, tags: [], content: '', created_at: 1000 }];
    expect(filterSocialBookmarks(events)).toHaveLength(0);
  });
});

describe('groupByUrl', () => {
  const bookmark = {
    id: 'b1',
    kind: 39701,
    pubkey: 'pub1',
    tags: [
      ['d', 'alice.blog/post'],
      ['title', 'Alice Blog Post']
    ],
    content: 'A description',
    created_at: 1000
  };

  const highlight = {
    id: 'h1',
    kind: 9802,
    pubkey: 'pub2',
    tags: [['r', 'https://alice.blog/post']],
    content: 'highlighted text',
    created_at: 2000
  };

  const pageNote = {
    id: 'n1',
    kind: 1111,
    pubkey: 'pub3',
    tags: [
      ['I', 'https://alice.blog/post'],
      ['K', 'web']
    ],
    content: 'a page note',
    created_at: 3000
  };

  it('groups events from different kinds by normalized URL', () => {
    const groups = groupByUrl([bookmark, highlight, pageNote]);
    expect(groups).toHaveLength(1);
    expect(groups[0].bookmarks).toHaveLength(1);
    expect(groups[0].highlights).toHaveLength(1);
    expect(groups[0].pageNotes).toHaveLength(1);
  });

  it('extracts title from bookmark title tag', () => {
    const groups = groupByUrl([bookmark]);
    expect(groups[0].title).toBe('Alice Blog Post');
  });

  it('falls back to URL for title when no bookmark', () => {
    const groups = groupByUrl([highlight]);
    expect(groups[0].title).toBe('alice.blog/post');
  });

  it('sets displayUrl from first event with full URL', () => {
    const groups = groupByUrl([bookmark, highlight]);
    expect(groups[0].displayUrl).toBe('https://alice.blog/post');
  });

  it('constructs displayUrl from d-tag when only bookmarks present', () => {
    const groups = groupByUrl([bookmark]);
    expect(groups[0].displayUrl).toBe('https://alice.blog/post');
  });

  it('sorts groups by latestActivity descending', () => {
    const old = {
      id: 'b2',
      kind: 39701,
      pubkey: 'pub1',
      tags: [['d', 'old.com/page']],
      content: '',
      created_at: 100
    };
    const recent = {
      id: 'b3',
      kind: 39701,
      pubkey: 'pub1',
      tags: [['d', 'recent.com/page']],
      content: '',
      created_at: 5000
    };
    const groups = groupByUrl([old, recent]);
    expect(groups[0].url).toBe('recent.com/page');
    expect(groups[1].url).toBe('old.com/page');
  });

  it('collects unique contributors', () => {
    const groups = groupByUrl([bookmark, highlight, pageNote]);
    expect(groups[0].contributors).toEqual(expect.arrayContaining(['pub1', 'pub2', 'pub3']));
    expect(groups[0].contributors).toHaveLength(3);
  });

  it('uses latestActivity from most recent event', () => {
    const groups = groupByUrl([bookmark, highlight, pageNote]);
    expect(groups[0].latestActivity).toBe(3000);
  });

  it('returns empty array for empty input', () => {
    expect(groupByUrl([])).toEqual([]);
  });

  it('creates separate groups for different URLs', () => {
    const other = {
      id: 'b2',
      kind: 39701,
      pubkey: 'pub1',
      tags: [['d', 'other.com/page']],
      content: '',
      created_at: 500
    };
    const groups = groupByUrl([bookmark, other]);
    expect(groups).toHaveLength(2);
  });
});
