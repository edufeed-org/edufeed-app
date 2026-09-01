/**
 * Bookmark helper tests
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => ({
    build: vi.fn(async (/** @type {any} */ t) => ({
      ...t,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: ''
    })),
    sign: vi.fn(async (/** @type {any} */ t) => ({ ...t, id: 'mock-id', sig: 'mock-sig' }))
  }))
}));

import {
  detectInputType,
  buildBookmarkTags,
  buildBookmarkEditTags,
  getBookmarkEditPrefill,
  stripSchemeForDTag,
  updateBookmarkContent,
  updateBookmarkEvent,
  parseBookmarkUrlParam,
  getInternalBookmarkRedirectTarget,
  decodeNaddr,
  BOOKMARK_KIND
} from '../helpers/bookmark.js';

describe('parseBookmarkUrlParam', () => {
  const hexPub = 'a'.repeat(64);
  const coord = `30023:${hexPub}:my-article`;

  it('parses a bare Nostr coordinate into a pointer + a-tag value', () => {
    const result = parseBookmarkUrlParam(encodeURIComponent(coord));
    expect(result).not.toBeNull();
    expect(result?.pointer).toMatchObject({
      kind: 30023,
      pubkey: hexPub,
      identifier: 'my-article'
    });
    expect(result?.aTagValue).toBe(coord);
  });

  it('strips a leftover https:// prefix before parsing', () => {
    const result = parseBookmarkUrlParam(encodeURIComponent(`https://${coord}`));
    expect(result?.pointer).toMatchObject({
      kind: 30023,
      pubkey: hexPub,
      identifier: 'my-article'
    });
    expect(result?.aTagValue).toBe(coord);
  });

  it('keeps colons inside the identifier', () => {
    const weird = `30023:${hexPub}:scope:slug`;
    const result = parseBookmarkUrlParam(encodeURIComponent(weird));
    expect(result?.pointer.identifier).toBe('scope:slug');
    expect(result?.aTagValue).toBe(weird);
  });

  it('returns null for genuine web URLs', () => {
    expect(parseBookmarkUrlParam(encodeURIComponent('https://example.com/post'))).toBeNull();
    expect(parseBookmarkUrlParam(encodeURIComponent('alice.blog/post'))).toBeNull();
  });
});

describe('getInternalBookmarkRedirectTarget', () => {
  const origin = 'https://dev.edufeed.org';
  const npub = 'npub14esenw6rt4c2pmxwvyey4jqw0sjdahetq6qvh5lffxp7w4thg63ql480z2';

  it('unwraps a community bookmark page that points at another bookmark page', () => {
    const inner = `${origin}/c/${npub}/bookmarks/https://relilab.org`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(inner))).toBe(
      'https://relilab.org'
    );
  });

  it('unwraps when the inner URL is percent-encoded inside the path', () => {
    const inner = `${origin}/c/${npub}/bookmarks/${encodeURIComponent('https://relilab.org')}`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(inner))).toBe(
      'https://relilab.org'
    );
  });

  it('unwraps a personal bookmark page (no community segment)', () => {
    const inner = `${origin}/bookmarks/https://relilab.org`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(inner))).toBe(
      'https://relilab.org'
    );
  });

  it('unwraps repeatedly through multiple nested bookmark pages', () => {
    const innermost = 'https://relilab.org';
    const level1 = `${origin}/c/${npub}/bookmarks/${innermost}`;
    const level2 = `${origin}/c/${npub}/bookmarks/${encodeURIComponent(level1)}`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(level2))).toBe(innermost);
  });

  it('unwraps regardless of host (bad data created on a different deployment)', () => {
    // Viewed on localhost, but the stored URL points at dev.edufeed.org.
    const inner = `${origin}/c/${npub}/bookmarks/https://relilab.org`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(inner))).toBe(
      'https://relilab.org'
    );
  });

  it('returns null for a genuine external article URL', () => {
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent('https://relilab.org'))).toBeNull();
    expect(
      getInternalBookmarkRedirectTarget(encodeURIComponent('https://example.com/post'))
    ).toBeNull();
  });

  it('returns null for an unrelated site whose /bookmarks/ slug is not a wrapped URL', () => {
    expect(
      getInternalBookmarkRedirectTarget(
        encodeURIComponent('https://blog.example/bookmarks/my-post')
      )
    ).toBeNull();
  });

  it('returns null when the /c/ segment is not a valid pubkey', () => {
    const other = `${origin}/c/not-a-pubkey/bookmarks/https://relilab.org`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(other))).toBeNull();
  });

  it('returns null for a non-bookmark edufeed page', () => {
    const other = `${origin}/c/${npub}/calendar`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(other))).toBeNull();
  });
});

describe('detectInputType', () => {
  it('returns "url" for http URLs', () => {
    expect(detectInputType('https://example.com/article')).toBe('url');
    expect(detectInputType('http://example.com')).toBe('url');
  });

  it('returns "naddr" for naddr-encoded strings', () => {
    const validNaddr =
      'naddr1qvzqqqr4gupzp24menw64w7vmk4thnxa42auehd2h0xdm24menw64w7vmk4thnxaqqz8getnwsfh2hzr';
    expect(detectInputType(validNaddr)).toBe('naddr');
  });

  it('returns "invalid" for empty or nonsense input', () => {
    expect(detectInputType('')).toBe('invalid');
    expect(detectInputType('   ')).toBe('invalid');
    expect(detectInputType('just some text')).toBe('invalid');
    expect(detectInputType('npub1abc')).toBe('invalid');
  });

  it('returns "url" for URLs without scheme when they look like domains', () => {
    expect(detectInputType('example.com/article')).toBe('url');
    expect(detectInputType('www.example.com')).toBe('url');
  });
});

describe('stripSchemeForDTag', () => {
  it('strips https scheme', () => {
    expect(stripSchemeForDTag('https://example.com/page')).toBe('example.com/page');
  });

  it('strips http scheme', () => {
    expect(stripSchemeForDTag('http://example.com/page')).toBe('example.com/page');
  });

  it('returns as-is if no scheme', () => {
    expect(stripSchemeForDTag('example.com/page')).toBe('example.com/page');
  });

  it('strips trailing slash', () => {
    expect(stripSchemeForDTag('https://example.com/')).toBe('example.com');
  });

  it('preserves path and query', () => {
    expect(stripSchemeForDTag('https://example.com/a/b?q=1')).toBe('example.com/a/b?q=1');
  });
});

describe('buildBookmarkTags', () => {
  it('builds correct tags for a URL bookmark', () => {
    const tags = buildBookmarkTags('https://example.com/article', 'My Article', [
      'abc123',
      'def456'
    ]);

    expect(tags).toContainEqual(['d', 'example.com/article']);
    expect(tags).toContainEqual(['r', 'https://example.com/article']);
    expect(tags).toContainEqual(['title', 'My Article']);
    expect(tags).toContainEqual(['h', 'abc123']);
    expect(tags).toContainEqual(['h', 'def456']);
  });

  it('builds tags without title when empty', () => {
    const tags = buildBookmarkTags('https://example.com', '', ['abc']);
    expect(tags.find((t) => t[0] === 'title')).toBeUndefined();
  });

  it('includes a-tag for naddr data', () => {
    const naddrData = { kind: 30023, pubkey: 'aabbcc', identifier: 'my-article' };
    const tags = buildBookmarkTags('https://example.com', 'Title', ['abc'], naddrData);

    expect(tags).toContainEqual(['a', '30023:aabbcc:my-article', '']);
    expect(tags).toContainEqual(['r', 'https://example.com']);
  });

  it('includes a-tag with relay hint when provided', () => {
    const naddrData = {
      kind: 30023,
      pubkey: 'aabbcc',
      identifier: 'my-article',
      relayHint: 'wss://relay.example.com'
    };
    const tags = buildBookmarkTags('https://example.com', 'Title', ['abc'], naddrData);

    expect(tags).toContainEqual(['a', '30023:aabbcc:my-article', 'wss://relay.example.com']);
  });

  it('uses a-tag value as d-tag when naddrData is provided and no URL', () => {
    const naddrData = { kind: 30023, pubkey: 'aabbcc', identifier: 'my-article' };
    const tags = buildBookmarkTags('', 'Title', ['abc'], naddrData);

    expect(tags).toContainEqual(['d', '30023:aabbcc:my-article']);
  });
});

describe('updateBookmarkContent', () => {
  /** @type {import('nostr-tools').NostrEvent} */
  const existingEvent = {
    kind: BOOKMARK_KIND,
    pubkey: 'testpubkey',
    content: 'Old description',
    tags: [
      ['d', 'example.com/article'],
      ['r', 'https://example.com/article'],
      ['title', 'My Article'],
      ['h', 'community1']
    ],
    created_at: 1000000,
    id: 'abc123',
    sig: 'sig123'
  };

  const mockAccount = {
    /** @param {any} template */
    signEvent: async (template) => ({
      ...template,
      id: 'new-id',
      pubkey: 'testpubkey',
      sig: 'fake-sig'
    })
  };

  it('creates a replacement event with updated content and same tags', async () => {
    const result = await updateBookmarkContent(existingEvent, 'Updated description', mockAccount);

    expect(result.kind).toBe(BOOKMARK_KIND);
    expect(result.content).toBe('Updated description');
    expect(result.tags).toEqual(existingEvent.tags);
  });

  it('preserves all original tags', async () => {
    /** @type {import('nostr-tools').NostrEvent} */
    const event = {
      ...existingEvent,
      tags: [
        ['d', 'example.com/page'],
        ['r', 'https://example.com/page'],
        ['title', 'Page Title'],
        ['h', 'comm1'],
        ['h', 'comm2'],
        ['a', '30023:pubkey:id', 'wss://relay.example.com']
      ]
    };

    const result = await updateBookmarkContent(event, 'new content', mockAccount);
    expect(result.tags).toEqual(event.tags);
  });
});

describe('buildBookmarkEditTags', () => {
  /** @type {import('nostr-tools').NostrEvent} */
  const existingEvent = {
    kind: BOOKMARK_KIND,
    pubkey: 'testpubkey',
    content: 'Old description',
    tags: [
      ['d', 'example.com/article'],
      ['r', 'https://example.com/article'],
      ['title', 'Old Title'],
      ['h', 'community1']
    ],
    created_at: 1000000,
    id: 'abc123',
    sig: 'sig123'
  };

  it('preserves the identity tags that address the event', () => {
    const tags = buildBookmarkEditTags(existingEvent, {
      title: 'New Title',
      communityPubkeys: ['community1']
    });

    expect(tags).toContainEqual(['d', 'example.com/article']);
    expect(tags).toContainEqual(['r', 'https://example.com/article']);
  });

  it('replaces the title tag', () => {
    const tags = buildBookmarkEditTags(existingEvent, {
      title: 'New Title',
      communityPubkeys: ['community1']
    });

    expect(tags.filter((t) => t[0] === 'title')).toEqual([['title', 'New Title']]);
  });

  it('trims the title and drops the tag entirely when it is blank', () => {
    expect(
      buildBookmarkEditTags(existingEvent, { title: '  Padded  ', communityPubkeys: [] })
    ).toContainEqual(['title', 'Padded']);

    const cleared = buildBookmarkEditTags(existingEvent, { title: '   ', communityPubkeys: [] });
    expect(cleared.some((t) => t[0] === 'title')).toBe(false);
  });

  it('replaces the full set of h-tags rather than merging with the old ones', () => {
    const tags = buildBookmarkEditTags(existingEvent, {
      title: 'New Title',
      communityPubkeys: ['community2', 'community3']
    });

    expect(tags.filter((t) => t[0] === 'h')).toEqual([
      ['h', 'community2'],
      ['h', 'community3']
    ]);
  });

  it('preserves the a-tag of an event-reference bookmark', () => {
    /** @type {import('nostr-tools').NostrEvent} */
    const eventRefBookmark = {
      ...existingEvent,
      tags: [
        ['d', '30023:pubkey:id'],
        ['a', '30023:pubkey:id', 'wss://relay.example.com'],
        ['title', 'Old Title'],
        ['h', 'community1']
      ]
    };

    const tags = buildBookmarkEditTags(eventRefBookmark, {
      title: 'New Title',
      communityPubkeys: ['community1']
    });

    expect(tags).toContainEqual(['a', '30023:pubkey:id', 'wss://relay.example.com']);
    expect(tags).toContainEqual(['d', '30023:pubkey:id']);
  });

  it('preserves unknown tags it does not understand', () => {
    /** @type {import('nostr-tools').NostrEvent} */
    const withExtras = {
      ...existingEvent,
      tags: [...existingEvent.tags, ['client', 'edufeed'], ['published_at', '1700000000']]
    };

    const tags = buildBookmarkEditTags(withExtras, { title: 'New', communityPubkeys: [] });

    expect(tags).toContainEqual(['client', 'edufeed']);
    expect(tags).toContainEqual(['published_at', '1700000000']);
  });

  it('tolerates an event with no tags', () => {
    /** @type {import('nostr-tools').NostrEvent} */
    const bare = { ...existingEvent, tags: [] };

    expect(buildBookmarkEditTags(bare, { title: 'T', communityPubkeys: ['c1'] })).toEqual([
      ['title', 'T'],
      ['h', 'c1']
    ]);
  });
});

describe('updateBookmarkEvent', () => {
  /** @type {import('nostr-tools').NostrEvent} */
  const existingEvent = {
    kind: BOOKMARK_KIND,
    pubkey: 'testpubkey',
    content: 'Old description',
    tags: [
      ['d', 'example.com/article'],
      ['r', 'https://example.com/article'],
      ['title', 'Old Title'],
      ['h', 'community1']
    ],
    created_at: 1000000,
    id: 'abc123',
    sig: 'sig123'
  };

  const mockAccount = {
    /** @param {any} template */
    signEvent: async (template) => ({
      ...template,
      id: 'new-id',
      pubkey: 'testpubkey',
      sig: 'fake-sig'
    })
  };

  it('signs a replacement event carrying the edited title, comment and communities', async () => {
    const result = await updateBookmarkEvent({
      event: existingEvent,
      title: 'New Title',
      description: 'New comment',
      communityPubkeys: ['community2'],
      account: mockAccount
    });

    expect(result.kind).toBe(BOOKMARK_KIND);
    expect(result.content).toBe('New comment');
    expect(result.tags).toContainEqual(['d', 'example.com/article']);
    expect(result.tags).toContainEqual(['title', 'New Title']);
    expect(result.tags.filter((/** @type {string[]} */ t) => t[0] === 'h')).toEqual([
      ['h', 'community2']
    ]);
  });

  it('writes an empty content when the comment is cleared', async () => {
    const result = await updateBookmarkEvent({
      event: existingEvent,
      title: 'New Title',
      description: '',
      communityPubkeys: ['community1'],
      account: mockAccount
    });

    expect(result.content).toBe('');
  });
});

describe('getBookmarkEditPrefill', () => {
  const hexPub = 'b'.repeat(64);

  it('prefills a web bookmark from its r, title, content and h tags', () => {
    /** @type {import('nostr-tools').NostrEvent} */
    const event = {
      kind: BOOKMARK_KIND,
      pubkey: 'testpubkey',
      content: 'Why I saved this',
      tags: [
        ['d', 'example.com/article'],
        ['r', 'https://example.com/article'],
        ['title', 'My Article'],
        ['h', 'community1'],
        ['h', 'community2']
      ],
      created_at: 1000000,
      id: 'abc123',
      sig: 'sig123'
    };

    expect(getBookmarkEditPrefill(event)).toEqual({
      input: 'https://example.com/article',
      title: 'My Article',
      description: 'Why I saved this',
      communityPubkeys: ['community1', 'community2']
    });
  });

  it('prefills an event-reference bookmark with an naddr rebuilt from its a-tag', () => {
    /** @type {import('nostr-tools').NostrEvent} */
    const event = {
      kind: BOOKMARK_KIND,
      pubkey: 'testpubkey',
      content: '',
      tags: [
        ['d', `30023:${hexPub}:my-article`],
        ['a', `30023:${hexPub}:my-article`, 'wss://relay.example.com/'],
        ['title', 'An Article']
      ],
      created_at: 1000000,
      id: 'abc123',
      sig: 'sig123'
    };

    const prefill = getBookmarkEditPrefill(event);

    expect(prefill.input.startsWith('naddr1')).toBe(true);
    expect(decodeNaddr(prefill.input)).toEqual({
      kind: 30023,
      pubkey: hexPub,
      identifier: 'my-article',
      relayHint: 'wss://relay.example.com/'
    });
    expect(prefill.communityPubkeys).toEqual([]);
  });

  it('falls back to the d-tag when there is no r-tag and no a-tag', () => {
    /** @type {import('nostr-tools').NostrEvent} */
    const event = {
      kind: BOOKMARK_KIND,
      pubkey: 'testpubkey',
      content: '',
      tags: [['d', 'example.com/page']],
      created_at: 1000000,
      id: 'abc123',
      sig: 'sig123'
    };

    expect(getBookmarkEditPrefill(event).input).toBe('https://example.com/page');
  });

  it('returns empty defaults for a null event', () => {
    expect(getBookmarkEditPrefill(null)).toEqual({
      input: '',
      title: '',
      description: '',
      communityPubkeys: []
    });
  });

  it('deduplicates repeated h-tags so a keyed selector cannot crash', () => {
    /** @type {import('nostr-tools').NostrEvent} */
    const event = {
      kind: BOOKMARK_KIND,
      pubkey: 'testpubkey',
      content: '',
      tags: [
        ['d', 'example.com'],
        ['r', 'https://example.com'],
        ['h', 'community1'],
        ['h', 'community1']
      ],
      created_at: 1000000,
      id: 'abc123',
      sig: 'sig123'
    };

    expect(getBookmarkEditPrefill(event).communityPubkeys).toEqual(['community1']);
  });
});
