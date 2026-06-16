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

import { nip19 } from 'nostr-tools';
import {
  detectInputType,
  buildBookmarkTags,
  stripSchemeForDTag,
  updateBookmarkContent,
  getBookmarkEventRefRedirect,
  getInternalBookmarkRedirectTarget,
  BOOKMARK_KIND
} from '../helpers/bookmark.js';

describe('getBookmarkEventRefRedirect', () => {
  const hexPub = 'a'.repeat(64);
  const coord = `30023:${hexPub}:my-article`;

  it('redirects a bare Nostr coordinate to the referenced naddr', () => {
    const path = getBookmarkEventRefRedirect(encodeURIComponent(coord));
    expect(path).not.toBeNull();
    const decoded = nip19.decode(/** @type {string} */ (path).slice(1));
    expect(decoded.type).toBe('naddr');
    expect(decoded.data).toMatchObject({ kind: 30023, pubkey: hexPub, identifier: 'my-article' });
  });

  it('strips a leftover https:// prefix before parsing', () => {
    const path = getBookmarkEventRefRedirect(encodeURIComponent(`https://${coord}`));
    expect(path).not.toBeNull();
    const decoded = nip19.decode(/** @type {string} */ (path).slice(1));
    expect(decoded.data).toMatchObject({ kind: 30023, pubkey: hexPub, identifier: 'my-article' });
  });

  it('returns null for genuine web URLs', () => {
    expect(getBookmarkEventRefRedirect(encodeURIComponent('https://example.com/post'))).toBeNull();
    expect(getBookmarkEventRefRedirect(encodeURIComponent('alice.blog/post'))).toBeNull();
  });
});

describe('getInternalBookmarkRedirectTarget', () => {
  const origin = 'https://dev.edufeed.org';
  const npub = 'npub14esenw6rt4c2pmxwvyey4jqw0sjdahetq6qvh5lffxp7w4thg63ql480z2';

  it('unwraps a community bookmark page that points at another bookmark page', () => {
    const inner = `${origin}/c/${npub}/bookmarks/https://relilab.org`;
    const param = encodeURIComponent(inner);
    expect(getInternalBookmarkRedirectTarget(param, origin)).toBe('https://relilab.org');
  });

  it('unwraps when the inner URL is percent-encoded inside the path', () => {
    const inner = `${origin}/c/${npub}/bookmarks/${encodeURIComponent('https://relilab.org')}`;
    const param = encodeURIComponent(inner);
    expect(getInternalBookmarkRedirectTarget(param, origin)).toBe('https://relilab.org');
  });

  it('unwraps a personal bookmark page (no community segment)', () => {
    const inner = `${origin}/bookmarks/https://relilab.org`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(inner), origin)).toBe(
      'https://relilab.org'
    );
  });

  it('unwraps repeatedly through multiple nested bookmark pages', () => {
    const innermost = 'https://relilab.org';
    const level1 = `${origin}/c/${npub}/bookmarks/${innermost}`;
    const level2 = `${origin}/c/${npub}/bookmarks/${encodeURIComponent(level1)}`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(level2), origin)).toBe(innermost);
  });

  it('returns null for a genuine external article URL', () => {
    expect(
      getInternalBookmarkRedirectTarget(encodeURIComponent('https://relilab.org'), origin)
    ).toBeNull();
    expect(
      getInternalBookmarkRedirectTarget(encodeURIComponent('https://example.com/post'), origin)
    ).toBeNull();
  });

  it('returns null when the URL is on a different origin', () => {
    const other = `https://evil.example/c/${npub}/bookmarks/https://relilab.org`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(other), origin)).toBeNull();
  });

  it('returns null for a non-bookmark edufeed page on the same origin', () => {
    const other = `${origin}/c/${npub}/calendar`;
    expect(getInternalBookmarkRedirectTarget(encodeURIComponent(other), origin)).toBeNull();
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
