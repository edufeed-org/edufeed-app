// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock $env/dynamic/private before importing the module
vi.mock('$env/dynamic/private', () => ({
  env: {
    APP_NAME: 'TestApp',
    FALLBACK_RELAYS: 'wss://relay1.example.com,wss://relay2.example.com',
    CALENDAR_RELAYS: 'wss://cal.example.com',
    AMB_RELAYS: 'wss://amb.example.com',
    LONGFORM_CONTENT_RELAY: 'wss://long.example.com'
  }
}));

// Mock applesauce-common/helpers
vi.mock('applesauce-common/helpers', () => ({
  getCalendarEventTitle: vi.fn(),
  getCalendarEventSummary: vi.fn(),
  getCalendarEventImage: vi.fn(),
  getArticleTitle: vi.fn(),
  getArticleSummary: vi.fn(),
  getArticleImage: vi.fn()
}));

import {
  extractMetadata,
  renderOgTags,
  ogCache,
  extractIdentifier,
  decodeIdentifier,
  resolvePageTarget
} from '$lib/server/og.js';

import {
  getCalendarEventTitle,
  getCalendarEventSummary,
  getCalendarEventImage,
  getArticleTitle,
  getArticleSummary,
  getArticleImage
} from 'applesauce-common/helpers';

describe('OG Meta Tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ogCache.clear();
  });

  describe('extractMetadata', () => {
    it('extracts calendar event metadata using applesauce helpers', () => {
      getCalendarEventTitle.mockReturnValue('Summer Workshop');
      getCalendarEventSummary.mockReturnValue('A great workshop about coding');
      getCalendarEventImage.mockReturnValue('https://example.com/image.jpg');

      const event = {
        kind: 31922,
        pubkey: 'abc',
        content: 'Some content',
        tags: [
          ['d', 'summer-workshop'],
          ['title', 'Summer Workshop']
        ],
        created_at: 1700000000,
        id: 'event1'
      };

      const meta = extractMetadata(event);

      expect(getCalendarEventTitle).toHaveBeenCalledWith(event);
      expect(getCalendarEventSummary).toHaveBeenCalledWith(event);
      expect(getCalendarEventImage).toHaveBeenCalledWith(event);
      expect(meta.title).toBe('Summer Workshop');
      expect(meta.description).toBe('A great workshop about coding');
      expect(meta.image).toBe('https://example.com/image.jpg');
      expect(meta.type).toBe('event');
    });

    it('extracts time-based calendar event (kind 31923)', () => {
      getCalendarEventTitle.mockReturnValue('Meetup');
      getCalendarEventSummary.mockReturnValue(undefined);
      getCalendarEventImage.mockReturnValue(undefined);

      const event = {
        kind: 31923,
        pubkey: 'abc',
        content:
          'Join us for this meetup about Nostr development and decentralized social media. We will discuss the latest NIPs and build something cool together.',
        tags: [['d', 'meetup']],
        created_at: 1700000000,
        id: 'event2'
      };

      const meta = extractMetadata(event);

      expect(meta.title).toBe('Meetup');
      // Falls back to content truncated at 200 chars
      expect(meta.description).toBe(event.content.slice(0, 200));
      expect(meta.image).toBeUndefined();
      expect(meta.type).toBe('event');
    });

    it('extracts article metadata using applesauce helpers', () => {
      getArticleTitle.mockReturnValue('My Article');
      getArticleSummary.mockReturnValue('Article summary here');
      getArticleImage.mockReturnValue('https://example.com/article.jpg');

      const event = {
        kind: 30023,
        pubkey: 'abc',
        content: 'Full article content...',
        tags: [['d', 'my-article']],
        created_at: 1700000000,
        id: 'event3'
      };

      const meta = extractMetadata(event);

      expect(getArticleTitle).toHaveBeenCalledWith(event);
      expect(getArticleSummary).toHaveBeenCalledWith(event);
      expect(getArticleImage).toHaveBeenCalledWith(event);
      expect(meta.title).toBe('My Article');
      expect(meta.description).toBe('Article summary here');
      expect(meta.image).toBe('https://example.com/article.jpg');
      expect(meta.type).toBe('article');
    });

    it('captures publishedAt for an article from the published_at tag', () => {
      getArticleTitle.mockReturnValue('Dated Article');
      getArticleSummary.mockReturnValue('summary');
      getArticleImage.mockReturnValue(undefined);

      const event = {
        kind: 30023,
        pubkey: 'abc',
        content: 'body',
        tags: [
          ['d', 'dated-article'],
          ['published_at', '1780444800']
        ],
        created_at: 1700000000,
        id: 'event-dated'
      };

      const meta = extractMetadata(event);

      expect(meta.publishedAt).toBe(new Date(1780444800 * 1000).toISOString());
    });

    it('extracts educational resource (30142) metadata from tags', () => {
      const event = {
        kind: 30142,
        pubkey: 'abc',
        content: 'Educational content here',
        tags: [
          ['d', 'resource-1'],
          ['title', 'Physics 101'],
          ['description', 'An introductory course on physics'],
          ['image', 'https://example.com/physics.jpg']
        ],
        created_at: 1700000000,
        id: 'event4'
      };

      const meta = extractMetadata(event);

      expect(meta.title).toBe('Physics 101');
      expect(meta.description).toBe('An introductory course on physics');
      expect(meta.image).toBe('https://example.com/physics.jpg');
      expect(meta.type).toBe('article');
    });

    it('falls back to content for educational resource without description tag', () => {
      const event = {
        kind: 30142,
        pubkey: 'abc',
        content: 'This is the content of the educational resource that should be used as fallback',
        tags: [
          ['d', 'resource-2'],
          ['title', 'Math Basics']
        ],
        created_at: 1700000000,
        id: 'event5'
      };

      const meta = extractMetadata(event);

      expect(meta.title).toBe('Math Basics');
      expect(meta.description).toBe(event.content.slice(0, 200));
    });

    it('extracts text note metadata with content truncation', () => {
      const longContent = 'This is a very long text note that goes on and on. '.repeat(10);

      const event = {
        kind: 1,
        pubkey: 'abc',
        content: longContent,
        tags: [],
        created_at: 1700000000,
        id: 'event6'
      };

      const meta = extractMetadata(event);

      // Title truncated at 70 chars
      expect(meta.title.length).toBeLessThanOrEqual(73); // 70 + "..."
      expect(meta.title.endsWith('...')).toBe(true);
      // Description truncated at 200 chars
      expect(meta.description.length).toBeLessThanOrEqual(203); // 200 + "..."
      expect(meta.type).toBe('website');
    });

    it('extracts first image URL from text note content', () => {
      const event = {
        kind: 1,
        pubkey: 'abc',
        content: 'Check out this image https://example.com/photo.jpg and this text',
        tags: [],
        created_at: 1700000000,
        id: 'event7'
      };

      const meta = extractMetadata(event);

      expect(meta.image).toBe('https://example.com/photo.jpg');
    });

    it('uses name tag for educational resource if title tag missing', () => {
      const event = {
        kind: 30142,
        pubkey: 'abc',
        content: '',
        tags: [
          ['d', 'resource-3'],
          ['name', 'Chemistry Basics']
        ],
        created_at: 1700000000,
        id: 'event8'
      };

      const meta = extractMetadata(event);

      expect(meta.title).toBe('Chemistry Basics');
    });
  });

  describe('renderOgTags', () => {
    it('renders all OG and Twitter tags when full metadata provided', () => {
      const html = renderOgTags(
        {
          title: 'My Event',
          description: 'A great event',
          image: 'https://example.com/image.jpg',
          type: 'event'
        },
        'https://example.com/event/naddr1abc'
      );

      expect(html).toContain('<meta property="og:title" content="My Event" />');
      expect(html).toContain('<meta property="og:description" content="A great event" />');
      expect(html).toContain('<meta property="og:image"');
      expect(html).toContain(
        '<meta property="og:url" content="https://example.com/event/naddr1abc" />'
      );
      expect(html).toContain('<meta property="og:type" content="event" />');
      expect(html).toContain('<meta property="og:site_name" content="TestApp" />');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
      expect(html).toContain('<meta name="twitter:title" content="My Event" />');
      expect(html).toContain('<meta name="twitter:description" content="A great event" />');
      expect(html).toContain('<meta name="twitter:image"');
    });

    it('omits image tags and uses summary card when no image', () => {
      const html = renderOgTags(
        {
          title: 'No Image Event',
          description: 'An event without an image',
          image: undefined,
          type: 'article'
        },
        'https://example.com/event/naddr1xyz'
      );

      expect(html).toContain('<meta property="og:title" content="No Image Event" />');
      expect(html).not.toContain('og:image');
      expect(html).not.toContain('twitter:image');
      expect(html).toContain('<meta name="twitter:card" content="summary" />');
    });

    it('escapes XSS characters in content', () => {
      const html = renderOgTags(
        {
          title: '<script>alert("xss")</script>',
          description: 'Description with "quotes" & <tags>',
          image: undefined,
          type: 'article'
        },
        'https://example.com/'
      );

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&amp;');
      expect(html).toContain('&quot;');
      expect(html).not.toContain('alert("xss")');
    });

    it('proxies image through /api/image endpoint', () => {
      const html = renderOgTags(
        {
          title: 'Test',
          description: 'Test',
          image: 'https://example.com/photo.jpg',
          type: 'article'
        },
        'https://myapp.com/event/naddr1abc'
      );

      // Image should be proxied via /api/image with OG dimensions
      expect(html).toContain('/api/image?url=');
      expect(html).toContain('w=1200');
      expect(html).toContain('h=630');
    });

    it('requests a cover-cropped jpeg for the OG image (webp breaks some crawlers)', () => {
      const html = renderOgTags(
        {
          title: 'Test',
          description: 'Test',
          image: 'https://example.com/photo.jpg',
          type: 'article'
        },
        'https://myapp.com/event/naddr1abc'
      );

      expect(html).toContain('fit=cover');
      expect(html).toContain('fmt=jpeg');
    });

    it('declares image dimensions, type, alt and secure_url when image present', () => {
      const html = renderOgTags(
        {
          title: 'My Event',
          description: 'A great event',
          image: 'https://example.com/image.jpg',
          type: 'article'
        },
        'https://example.com/event/naddr1abc'
      );

      expect(html).toContain('<meta property="og:image:width" content="1200" />');
      expect(html).toContain('<meta property="og:image:height" content="630" />');
      expect(html).toContain('<meta property="og:image:type" content="image/jpeg" />');
      expect(html).toContain('<meta property="og:image:alt" content="My Event" />');
      expect(html).toContain('<meta property="og:image:secure_url"');
    });

    it('emits article:published_time when an article has publishedAt', () => {
      const html = renderOgTags(
        {
          title: 'My Article',
          description: 'desc',
          type: 'article',
          publishedAt: '2026-06-03T12:00:00.000Z'
        },
        'https://example.com/article/naddr1abc'
      );

      expect(html).toContain(
        '<meta property="article:published_time" content="2026-06-03T12:00:00.000Z" />'
      );
    });

    it('does not emit article:published_time for non-article types', () => {
      const html = renderOgTags(
        {
          title: 'An Event',
          description: 'desc',
          type: 'event',
          publishedAt: '2026-06-03T12:00:00.000Z'
        },
        'https://example.com/event/naddr1abc'
      );

      expect(html).not.toContain('article:published_time');
    });
  });

  describe('ogCache', () => {
    it('returns cached value on hit', () => {
      ogCache.set('naddr1test', '<meta og />', 3600000);

      const result = ogCache.get('naddr1test');
      expect(result).toBe('<meta og />');
    });

    it('returns null on miss', () => {
      const result = ogCache.get('naddr1nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for expired entries', () => {
      // Set with 0ms TTL (immediately expired)
      ogCache.set('naddr1expired', '<meta />', -1);

      const result = ogCache.get('naddr1expired');
      expect(result).toBeNull();
    });

    it('respects max entries limit', () => {
      // Fill cache beyond max
      for (let i = 0; i < 505; i++) {
        ogCache.set(`key${i}`, `value${i}`, 3600000);
      }

      // Oldest entries should be evicted
      expect(ogCache.get('key0')).toBeNull();
      // Recent entries should still exist
      expect(ogCache.get('key504')).toBe('value504');
    });

    it('clear() removes all entries', () => {
      ogCache.set('key1', 'val1', 3600000);
      ogCache.set('key2', 'val2', 3600000);
      ogCache.clear();

      expect(ogCache.get('key1')).toBeNull();
      expect(ogCache.get('key2')).toBeNull();
    });
  });

  describe('extractIdentifier', () => {
    it('extracts naddr from calendar event path', () => {
      const result = extractIdentifier(
        '/calendar/event/naddr1qqwk2an9de6z6vfhxuenvdeh8qcnzve4xckhjunzwcenzen0duq3wamnwvaz7tmjv4kxz7fwv4j82en9v4jzummjvupzqlxmklvr9rtzj9fx4dcuaw3v8p26za5jldndsqu7fyesrj57vnsfqvzqqqrukvamsshl'
      );
      expect(result).toBe(
        'naddr1qqwk2an9de6z6vfhxuenvdeh8qcnzve4xckhjunzwcenzen0duq3wamnwvaz7tmjv4kxz7fwv4j82en9v4jzummjvupzqlxmklvr9rtzj9fx4dcuaw3v8p26za5jldndsqu7fyesrj57vnsfqvzqqqrukvamsshl'
      );
    });

    it('extracts naddr from root path', () => {
      const result = extractIdentifier(
        '/naddr1qqwk2an9de6z6vfhxuenvdeh8qcnzve4xckhjunzwcenzen0duq3wamnwvaz7tmjv4kxz7fwv4j82en9v4jzummjvupzqlxmklvr9rtzj9fx4dcuaw3v8p26za5jldndsqu7fyesrj57vnsfqvzqqqrukvamsshl'
      );
      expect(result).toBeTruthy();
    });

    it('returns null for paths without identifiers', () => {
      expect(extractIdentifier('/calendar')).toBeNull();
      expect(extractIdentifier('/discover')).toBeNull();
      expect(extractIdentifier('/')).toBeNull();
    });

    it('returns null for too-short naddr strings', () => {
      expect(extractIdentifier('/naddr1short')).toBeNull();
    });
  });

  describe('decodeIdentifier', () => {
    it('decodes a valid naddr', () => {
      const result = decodeIdentifier(
        'naddr1qqwk2an9de6z6vfhxuenvdeh8qcnzve4xckhjunzwcenzen0duq3wamnwvaz7tmjv4kxz7fwv4j82en9v4jzummjvupzqlxmklvr9rtzj9fx4dcuaw3v8p26za5jldndsqu7fyesrj57vnsfqvzqqqrukvamsshl'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('naddr');
      expect(result.kind).toBe(31923);
      expect(result.pubkey).toBeTruthy();
      expect(result.relays).toContain('wss://relay.edufeed.org');
    });

    it('returns null for invalid identifiers', () => {
      expect(decodeIdentifier('invalid')).toBeNull();
      expect(decodeIdentifier('naddr1invalid')).toBeNull();
    });

    it('returns null for npub identifiers', () => {
      expect(decodeIdentifier('npub1abc')).toBeNull();
    });
  });

  describe('resolvePageTarget', () => {
    // hex + npub pair for fixtures
    const HEX = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
    const NPUB = 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m';

    it('resolves naddr anywhere in the path as event (takes precedence over community)', () => {
      const naddr = 'naddr1' + 'q'.repeat(60);
      const target = resolvePageTarget(`/c/${NPUB}/article/${naddr}`);
      expect(target).toEqual({ type: 'event', identifier: naddr });
    });

    it('resolves nevent paths as event', () => {
      const nevent = 'nevent1' + 'q'.repeat(60);
      expect(resolvePageTarget(`/${nevent}`)).toEqual({ type: 'event', identifier: nevent });
    });

    it('resolves /c/<npub> as community with hex pubkey', () => {
      expect(resolvePageTarget(`/c/${NPUB}`)).toEqual({ type: 'community', pubkey: HEX });
    });

    it('resolves /c/<hex> as community', () => {
      expect(resolvePageTarget(`/c/${HEX}`)).toEqual({ type: 'community', pubkey: HEX });
    });

    it('resolves /c/<npub>/bookmarks/foo (community subpage without naddr) as community', () => {
      expect(resolvePageTarget(`/c/${NPUB}/bookmarks/foo`)).toEqual({
        type: 'community',
        pubkey: HEX
      });
    });

    it('does NOT resolve dashboard routes /c, /c/inbox, /c/messages as community', () => {
      expect(resolvePageTarget('/c')).toEqual({ type: 'default' });
      expect(resolvePageTarget('/c/inbox')).toEqual({ type: 'default' });
      expect(resolvePageTarget('/c/messages')).toEqual({ type: 'default' });
    });

    it('resolves /p/<npub> and /p/<hex> as profile', () => {
      expect(resolvePageTarget(`/p/${NPUB}`)).toEqual({ type: 'profile', pubkey: HEX });
      expect(resolvePageTarget(`/p/${HEX}`)).toEqual({ type: 'profile', pubkey: HEX });
    });

    it('resolves /calendar/author/<npub> as profile', () => {
      expect(resolvePageTarget(`/calendar/author/${NPUB}`)).toEqual({
        type: 'profile',
        pubkey: HEX
      });
    });

    it('resolves /wiki/<topic> with URI decoding', () => {
      expect(resolvePageTarget('/wiki/peace%20education')).toEqual({
        type: 'wiki-topic',
        topic: 'peace education'
      });
    });

    it('returns default for /, /discover, /settings and invalid pubkeys', () => {
      expect(resolvePageTarget('/')).toEqual({ type: 'default' });
      expect(resolvePageTarget('/discover')).toEqual({ type: 'default' });
      expect(resolvePageTarget('/settings')).toEqual({ type: 'default' });
      expect(resolvePageTarget('/p/not-a-pubkey')).toEqual({ type: 'default' });
    });

    it('does not throw on malformed percent-encoding', () => {
      // Malformed escapes fall back to the raw segment instead of throwing URIError
      expect(resolvePageTarget('/wiki/%')).toEqual({ type: 'wiki-topic', topic: '%' });
      expect(resolvePageTarget('/c/%zz')).toEqual({ type: 'default' });
      expect(resolvePageTarget('/p/%zz')).toEqual({ type: 'default' });
      expect(resolvePageTarget('/calendar/author/%zz')).toEqual({ type: 'default' });
    });
  });
});
