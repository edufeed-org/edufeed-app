/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  extractUrlFromEvent,
  filterSocialBookmarks,
  groupByUrl,
  extractEventRefFromHighlight,
  extractEventRefFromBookmark,
  parseEventCoordinate,
  groupByEventRef
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

  it('returns undefined for kind 39701 event-ref bookmark (has a-tag)', () => {
    const event = {
      kind: 39701,
      tags: [
        ['d', `30023:${'a'.repeat(64)}:my-article`],
        ['a', `30023:${'a'.repeat(64)}:my-article`, 'wss://relay.example.com']
      ],
      content: '',
      created_at: 1000
    };
    expect(extractUrlFromEvent(event)).toBeUndefined();
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

describe('extractEventRefFromHighlight', () => {
  // Valid 64-char hex pubkeys for applesauce helpers
  const hexPub1 = 'a'.repeat(64);

  it('returns AddressPointer for kind 9802 with a-tag and no r-tag', () => {
    const event = {
      kind: 9802,
      tags: [['a', `30023:${hexPub1}:my-article`]],
      content: 'highlighted text',
      created_at: 1000
    };
    const result = extractEventRefFromHighlight(event);
    expect(result).toMatchObject({ kind: 30023, pubkey: hexPub1, identifier: 'my-article' });
  });

  it('returns undefined for kind 9802 with r-tag (URL highlight)', () => {
    const event = {
      kind: 9802,
      tags: [
        ['r', 'https://example.com/post'],
        ['a', `30023:${hexPub1}:my-article`]
      ],
      content: 'highlighted text',
      created_at: 1000
    };
    expect(extractEventRefFromHighlight(event)).toBeUndefined();
  });

  it('returns undefined for non-9802 kinds', () => {
    const event = {
      kind: 39701,
      tags: [['a', `30023:${hexPub1}:my-article`]],
      content: '',
      created_at: 1000
    };
    expect(extractEventRefFromHighlight(event)).toBeUndefined();
  });

  it('returns undefined for kind 9802 without a-tag', () => {
    const event = {
      kind: 9802,
      tags: [['p', 'somepubkey']],
      content: 'highlighted text',
      created_at: 1000
    };
    expect(extractEventRefFromHighlight(event)).toBeUndefined();
  });

  it('handles wiki highlights (kind 30818)', () => {
    const event = {
      kind: 9802,
      tags: [['a', `30818:${hexPub1}:my-wiki-page`]],
      content: 'wiki text',
      created_at: 1000
    };
    const result = extractEventRefFromHighlight(event);
    expect(result).toMatchObject({ kind: 30818, pubkey: hexPub1, identifier: 'my-wiki-page' });
  });

  it('returns undefined for null/undefined input', () => {
    expect(extractEventRefFromHighlight(null)).toBeUndefined();
    expect(extractEventRefFromHighlight(undefined)).toBeUndefined();
  });
});

describe('parseEventCoordinate', () => {
  const hexPub = 'a'.repeat(64);

  it('parses a kind:pubkey:identifier coordinate', () => {
    expect(parseEventCoordinate(`30023:${hexPub}:my-article`)).toEqual({
      kind: 30023,
      pubkey: hexPub,
      identifier: 'my-article'
    });
  });

  it('preserves colons in the identifier', () => {
    expect(parseEventCoordinate(`30023:${hexPub}:a:b:c`)).toEqual({
      kind: 30023,
      pubkey: hexPub,
      identifier: 'a:b:c'
    });
  });

  it('tolerates an empty identifier', () => {
    expect(parseEventCoordinate(`30000:${hexPub}:`)).toEqual({
      kind: 30000,
      pubkey: hexPub,
      identifier: ''
    });
  });

  it('returns undefined for plain URLs', () => {
    expect(parseEventCoordinate('alice.blog/post')).toBeUndefined();
    expect(parseEventCoordinate('https://example.com/x')).toBeUndefined();
  });

  it('returns undefined for malformed input', () => {
    expect(parseEventCoordinate('30023:not-hex:id')).toBeUndefined();
    expect(parseEventCoordinate('notakind:' + hexPub + ':id')).toBeUndefined();
    expect(parseEventCoordinate('')).toBeUndefined();
    expect(parseEventCoordinate(null)).toBeUndefined();
  });
});

describe('extractEventRefFromBookmark', () => {
  const hexPub = 'a'.repeat(64);

  it('returns AddressPointer for kind 39701 with a-tag', () => {
    const event = {
      kind: 39701,
      tags: [
        ['d', `30023:${hexPub}:my-article`],
        ['a', `30023:${hexPub}:my-article`, 'wss://relay.example.com']
      ],
      content: '',
      created_at: 1000
    };
    expect(extractEventRefFromBookmark(event)).toMatchObject({
      kind: 30023,
      pubkey: hexPub,
      identifier: 'my-article'
    });
  });

  it('returns undefined for a kind 39701 web-URL bookmark (no a-tag)', () => {
    const event = {
      kind: 39701,
      tags: [['d', 'alice.blog/post']],
      content: '',
      created_at: 1000
    };
    expect(extractEventRefFromBookmark(event)).toBeUndefined();
  });

  it('returns undefined for non-39701 kinds', () => {
    const event = {
      kind: 9802,
      tags: [['a', `30023:${hexPub}:my-article`]],
      content: '',
      created_at: 1000
    };
    expect(extractEventRefFromBookmark(event)).toBeUndefined();
  });
});

describe('groupByEventRef', () => {
  // Valid 64-char hex pubkeys for applesauce helpers
  const hexPub1 = 'a'.repeat(64);
  const hexPub2 = 'b'.repeat(64);
  const authorPub1 = 'c'.repeat(64);
  const authorPub2 = 'd'.repeat(64);

  const articleHighlight1 = {
    id: 'h1',
    kind: 9802,
    pubkey: hexPub1,
    tags: [['a', `30023:${authorPub1}:my-article`]],
    content: 'first highlight',
    created_at: 1000
  };

  const articleHighlight2 = {
    id: 'h2',
    kind: 9802,
    pubkey: hexPub2,
    tags: [['a', `30023:${authorPub1}:my-article`]],
    content: 'second highlight',
    created_at: 2000
  };

  const wikiHighlight = {
    id: 'h3',
    kind: 9802,
    pubkey: hexPub1,
    tags: [['a', `30818:${authorPub2}:wiki-page`]],
    content: 'wiki highlight',
    created_at: 3000
  };

  const urlHighlight = {
    id: 'h4',
    kind: 9802,
    pubkey: hexPub1,
    tags: [['r', 'https://example.com']],
    content: 'url highlight',
    created_at: 4000
  };

  it('groups highlights by a-tag value', () => {
    const groups = groupByEventRef([articleHighlight1, articleHighlight2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].highlights).toHaveLength(2);
  });

  it('creates separate groups for different a-tags', () => {
    const groups = groupByEventRef([articleHighlight1, wikiHighlight]);
    expect(groups).toHaveLength(2);
  });

  it('ignores URL highlights (with r-tag)', () => {
    const groups = groupByEventRef([urlHighlight, articleHighlight1]);
    expect(groups).toHaveLength(1);
    expect(groups[0].highlights).toHaveLength(1);
  });

  it('ignores web-URL bookmarks (kind 39701 without a-tag)', () => {
    const bookmark = {
      id: 'b1',
      kind: 39701,
      pubkey: hexPub1,
      tags: [['d', 'example.com']],
      content: '',
      created_at: 1000
    };
    const groups = groupByEventRef([bookmark, articleHighlight1]);
    expect(groups).toHaveLength(1);
    expect(groups[0].bookmarks).toHaveLength(0);
  });

  it('includes kind 39701 event-ref bookmarks', () => {
    const bookmark = {
      id: 'b1',
      kind: 39701,
      pubkey: hexPub1,
      tags: [
        ['d', `30023:${authorPub1}:my-article`],
        ['a', `30023:${authorPub1}:my-article`, 'wss://relay.example.com'],
        ['title', 'My Article']
      ],
      content: '',
      created_at: 5000
    };
    const groups = groupByEventRef([bookmark]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe(30023);
    expect(groups[0].pubkey).toBe(authorPub1);
    expect(groups[0].identifier).toBe('my-article');
    expect(groups[0].bookmarks).toHaveLength(1);
    expect(groups[0].highlights).toHaveLength(0);
    expect(groups[0].relayHints).toContain('wss://relay.example.com');
  });

  it('groups a bookmark and a highlight on the same coordinate together', () => {
    const bookmark = {
      id: 'b1',
      kind: 39701,
      pubkey: hexPub2,
      tags: [
        ['d', `30023:${authorPub1}:my-article`],
        ['a', `30023:${authorPub1}:my-article`]
      ],
      content: '',
      created_at: 5000
    };
    const groups = groupByEventRef([articleHighlight1, bookmark]);
    expect(groups).toHaveLength(1);
    expect(groups[0].highlights).toHaveLength(1);
    expect(groups[0].bookmarks).toHaveLength(1);
    expect(groups[0].contributors).toEqual(expect.arrayContaining([hexPub1, hexPub2]));
    expect(groups[0].latestActivity).toBe(5000);
  });

  it('tracks latestActivity from most recent highlight', () => {
    const groups = groupByEventRef([articleHighlight1, articleHighlight2]);
    expect(groups[0].latestActivity).toBe(2000);
  });

  it('collects unique contributors', () => {
    const groups = groupByEventRef([articleHighlight1, articleHighlight2]);
    expect(groups[0].contributors).toEqual(expect.arrayContaining([hexPub1, hexPub2]));
    expect(groups[0].contributors).toHaveLength(2);
  });

  it('sorts groups by latestActivity descending', () => {
    const groups = groupByEventRef([articleHighlight1, wikiHighlight]);
    expect(groups[0].aTagValue).toBe(`30818:${authorPub2}:wiki-page`);
    expect(groups[1].aTagValue).toBe(`30023:${authorPub1}:my-article`);
  });

  it('stores parsed kind, pubkey, identifier on each group', () => {
    const groups = groupByEventRef([articleHighlight1]);
    expect(groups[0].kind).toBe(30023);
    expect(groups[0].pubkey).toBe(authorPub1);
    expect(groups[0].identifier).toBe('my-article');
  });

  it('collects relay hints from a-tag position [2]', () => {
    const withHint = {
      id: 'h5',
      kind: 9802,
      pubkey: hexPub1,
      tags: [['a', `30023:${authorPub1}:my-article`, 'wss://relay.example.com']],
      content: 'highlighted text',
      created_at: 1000
    };
    const withHint2 = {
      id: 'h6',
      kind: 9802,
      pubkey: hexPub2,
      tags: [['a', `30023:${authorPub1}:my-article`, 'wss://other.relay.com']],
      content: 'more text',
      created_at: 2000
    };
    const groups = groupByEventRef([withHint, withHint2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].relayHints).toEqual(
      expect.arrayContaining(['wss://relay.example.com', 'wss://other.relay.com'])
    );
    expect(groups[0].relayHints).toHaveLength(2);
  });

  it('deduplicates relay hints', () => {
    const h1 = {
      id: 'h7',
      kind: 9802,
      pubkey: hexPub1,
      tags: [['a', `30023:${authorPub1}:my-article`, 'wss://relay.example.com']],
      content: 'text1',
      created_at: 1000
    };
    const h2 = {
      id: 'h8',
      kind: 9802,
      pubkey: hexPub2,
      tags: [['a', `30023:${authorPub1}:my-article`, 'wss://relay.example.com']],
      content: 'text2',
      created_at: 2000
    };
    const groups = groupByEventRef([h1, h2]);
    expect(groups[0].relayHints).toHaveLength(1);
  });

  it('returns empty relayHints when no a-tag relay hint present', () => {
    const groups = groupByEventRef([articleHighlight1]);
    expect(groups[0].relayHints).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(groupByEventRef([])).toEqual([]);
  });

  it('returns empty array when no event-ref highlights exist', () => {
    expect(groupByEventRef([urlHighlight])).toEqual([]);
  });
});
