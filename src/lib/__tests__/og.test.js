// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import { verifyEvent, finalizeEvent, generateSecretKey } from 'nostr-tools/pure';

// Mock $env/dynamic/private before importing the module
vi.mock('$env/dynamic/private', () => ({
  env: {
    APP_NAME: 'TestApp',
    APP_OG_DESCRIPTION: 'Test site description',
    OG_DEFAULT_IMAGE: '/og-default.png',
    FALLBACK_RELAYS: 'wss://relay1.example.com,wss://relay2.example.com',
    CALENDAR_RELAYS: 'wss://cal.example.com',
    AMB_RELAYS: 'wss://amb.example.com',
    LONGFORM_CONTENT_RELAY: 'wss://long.example.com',
    COMMUNIKEY_RELAYS: 'wss://ck.example.com',
    KANBAN_RELAYS: 'wss://kanban.example.com',
    RELAY_LIST_LOOKUP_RELAYS: 'wss://lookup.example.com',
    INDEXER_RELAYS: 'wss://indexer.example.com'
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
  resolvePageTarget,
  getRelaysForKind,
  buildDefaultMeta,
  ogMetaHandle,
  eventMatchesFilter
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

      // Title comes from getFeedCardData, truncated at 120 chars
      expect(meta.title.length).toBeLessThanOrEqual(123); // 120 + "..."
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

    it('extracts calendar collection (31924) metadata from tags', () => {
      const event = {
        kind: 31924,
        content: '',
        tags: [
          ['d', 'my-cal'],
          ['title', 'Community Calendar'],
          ['description', 'All our events'],
          ['image', 'https://example.com/cal.png']
        ]
      };
      const meta = extractMetadata(event);
      expect(meta.title).toBe('Community Calendar');
      expect(meta.description).toBe('All our events');
      expect(meta.image).toBe('https://example.com/cal.png');
      expect(meta.type).toBe('website');
    });

    it('extracts wiki page (30818) metadata via feed card data', () => {
      const event = {
        kind: 30818,
        content: 'Peace education is a practice...',
        tags: [
          ['d', 'peace-education'],
          ['title', 'Peace Education']
        ]
      };
      const meta = extractMetadata(event);
      expect(meta.title).toBe('Peace Education');
      expect(meta.type).toBe('website');
      expect(meta.description.length).toBeGreaterThan(0);
    });

    it('extracts form template (30168) name and description tags', () => {
      const event = {
        kind: 30168,
        content: '',
        tags: [
          ['d', 'membership'],
          ['name', 'Membership Form'],
          ['description', 'Apply to join']
        ]
      };
      const meta = extractMetadata(event);
      expect(meta.title).toBe('Membership Form');
      expect(meta.type).toBe('website');
    });

    it('extracts kanban board (30301) title and never leaks JSON content', () => {
      const event = {
        kind: 30301,
        content: '{"columns":[{"id":"todo"}]}',
        tags: [
          ['d', 'board-1'],
          ['title', 'Sprint Board']
        ]
      };
      const meta = extractMetadata(event);
      expect(meta.title).toBe('Sprint Board');
      expect(meta.description).not.toContain('{');
      expect(meta.image).toBeUndefined();
      expect(meta.type).toBe('website');
    });

    it('extracts profile metadata from kind 0 via getProfileContent', () => {
      const event = {
        kind: 0,
        content: JSON.stringify({
          name: 'alice',
          display_name: 'Alice A.',
          about: 'Educator on Nostr',
          picture: 'https://example.com/alice.png'
        }),
        tags: []
      };
      const meta = extractMetadata(event);
      // display_name wins over the npub fallback
      expect(meta.title).toBe('Alice A.');
      expect(meta.description).toBe('Educator on Nostr');
      expect(meta.image).toBe('https://example.com/alice.png');
      expect(meta.type).toBe('profile');
    });

    it('handles kind 0 with unparseable content gracefully, falling back to npub short form', () => {
      const pubkey = 'c'.repeat(64);
      const meta = extractMetadata({ kind: 0, pubkey, content: 'not json', tags: [] });
      expect(meta.type).toBe('profile');
      const npub = nip19.npubEncode(pubkey);
      expect(meta.title).toBe(`${npub.slice(0, 12)}…${npub.slice(-4)}`);
      expect(meta.description).toBe('');
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

    it('uses default brand image and summary_large_image card when no content image', () => {
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
      expect(html).toContain('og:image');
      expect(html).toContain('https://example.com/og-default.png');
      expect(html).toContain('twitter:image');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
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

  describe('default site tags', () => {
    it('buildDefaultMeta uses APP_NAME and APP_OG_DESCRIPTION', () => {
      const meta = buildDefaultMeta();
      expect(meta.title).toBe('TestApp');
      expect(meta.description).toBe('Test site description');
      expect(meta.type).toBe('website');
    });

    it('renderOgTags falls back to the default brand image when meta has none', () => {
      const html = renderOgTags(
        { title: 'A Form', description: 'desc', type: 'website' },
        'https://app.example.com/forms/naddr1xyz'
      );
      expect(html).toContain('og:image');
      expect(html).toContain('https://app.example.com/og-default.png');
      expect(html).toContain('summary_large_image');
      expect(html).not.toContain('/api/image'); // default image is not proxied
    });

    it('renderOgTags still proxies content images', () => {
      const html = renderOgTags(
        { title: 'T', description: 'd', image: 'https://x.example/pic.png', type: 'article' },
        'https://app.example.com/x'
      );
      expect(html).toContain('/api/image?url=');
    });

    it('renderOgTags falls back to site description when description is empty', () => {
      const html = renderOgTags(
        { title: 'Board', description: '', type: 'website' },
        'https://app.example.com/x'
      );
      expect(html).toContain('Test site description');
    });

    it('renders og:type profile for profile metadata', () => {
      const html = renderOgTags(
        { title: 'Alice', description: 'about', type: 'profile' },
        'https://app.example.com/p/npub1xyz'
      );
      expect(html).toContain('<meta property="og:type" content="profile" />');
    });

    it('supports an absolute OG_DEFAULT_IMAGE override', async () => {
      // temporarily override the mocked env value
      const { env } = await import('$env/dynamic/private');
      const prev = env.OG_DEFAULT_IMAGE;
      env.OG_DEFAULT_IMAGE = 'https://cdn.example.com/brand.png';
      try {
        const html = renderOgTags(
          { title: 'T', description: 'd', type: 'website' },
          'https://app.example.com/x'
        );
        expect(html).toContain('https://cdn.example.com/brand.png');
      } finally {
        env.OG_DEFAULT_IMAGE = prev;
      }
    });

    it('declares image/jpeg for a .jpg OG_DEFAULT_IMAGE override', async () => {
      const { env } = await import('$env/dynamic/private');
      const prev = env.OG_DEFAULT_IMAGE;
      env.OG_DEFAULT_IMAGE = 'https://cdn.example.com/brand.jpg';
      try {
        const html = renderOgTags(
          { title: 'T', description: 'd', type: 'website' },
          'https://app.example.com/x'
        );
        expect(html).toContain('og:image:type" content="image/jpeg"');
      } finally {
        env.OG_DEFAULT_IMAGE = prev;
      }
    });

    it('omits og:image:type for an extension-less OG_DEFAULT_IMAGE override', async () => {
      const { env } = await import('$env/dynamic/private');
      const prev = env.OG_DEFAULT_IMAGE;
      env.OG_DEFAULT_IMAGE = 'https://cdn.example.com/brand';
      try {
        const html = renderOgTags(
          { title: 'T', description: 'd', type: 'website' },
          'https://app.example.com/x'
        );
        expect(html).toContain('og:image');
        expect(html).not.toContain('og:image:type');
      } finally {
        env.OG_DEFAULT_IMAGE = prev;
      }
    });

    it('declares image/png for the default /og-default.png', () => {
      const html = renderOgTags(
        { title: 'T', description: 'd', type: 'website' },
        'https://app.example.com/x'
      );
      expect(html).toContain('<meta property="og:image:type" content="image/png" />');
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

  describe('getRelaysForKind', () => {
    it('maps forms/community/thread kinds to communikey relays', () => {
      for (const kind of [30168, 10222, 11]) {
        expect(getRelaysForKind(kind, [])).toContain('wss://ck.example.com');
      }
    });

    it('maps kanban boards to kanban relays', () => {
      expect(getRelaysForKind(30301, [])).toContain('wss://kanban.example.com');
    });

    it('maps wiki pages to communikey + lookup relays', () => {
      const relays = getRelaysForKind(30818, []);
      expect(relays).toContain('wss://ck.example.com');
      expect(relays).toContain('wss://lookup.example.com');
    });

    it('maps kind 0 profiles to lookup + indexer relays', () => {
      const relays = getRelaysForKind(0, []);
      expect(relays).toContain('wss://lookup.example.com');
      expect(relays).toContain('wss://indexer.example.com');
    });

    it('always unions hint relays and fallback relays', () => {
      const relays = getRelaysForKind(30301, ['wss://hint.example.com']);
      expect(relays).toContain('wss://hint.example.com');
      expect(relays).toContain('wss://relay1.example.com');
    });

    it('includes calendar relays for calendar collections (31924)', () => {
      expect(getRelaysForKind(31924, [])).toContain('wss://cal.example.com');
    });
  });

  describe('ogMetaHandle', () => {
    const npubOfAAAA = nip19.npubEncode('a'.repeat(64));

    /** Build a minimal SvelteKit-shaped handle input */
    function makeHandleInput(pathname) {
      /** @type {any} */
      const captured = {};
      const event = { url: new URL(`https://app.example.com${pathname}`) };
      const resolve = vi.fn((evt, opts) => {
        captured.opts = opts;
        // simulate page rendering so transformPageChunk runs
        const html = '<html><head></head><body></body></html>';
        captured.html = opts?.transformPageChunk ? opts.transformPageChunk({ html }) : html;
        return new Response(captured.html);
      });
      return { event, resolve, captured };
    }

    it('injects default site tags on pages without a target', async () => {
      const { event, resolve, captured } = makeHandleInput('/discover');
      await ogMetaHandle({ event, resolve });
      expect(captured.html).toContain('og:title');
      expect(captured.html).toContain('TestApp');
      expect(captured.html).toContain('og-default.png');
    });

    it('injects default tags for the home page', async () => {
      const { event, resolve, captured } = makeHandleInput('/');
      await ogMetaHandle({ event, resolve });
      expect(captured.html).toContain('og:site_name');
    });

    it('serves cached content tags for a previously resolved target', async () => {
      ogCache.clear();
      ogCache.set(
        'profile:'.concat('a'.repeat(64)),
        '<meta property="og:title" content="Cached" />',
        60000
      );
      const { event, resolve, captured } = makeHandleInput(`/p/${npubOfAAAA}`);
      await ogMetaHandle({ event, resolve });
      expect(captured.html).toContain('content="Cached"');
    });

    it('falls back to default tags when the cached value is a negative entry', async () => {
      ogCache.clear();
      ogCache.set('wiki:missing-topic', '', 60000);
      const { event, resolve, captured } = makeHandleInput('/wiki/missing-topic');
      await ogMetaHandle({ event, resolve });
      expect(captured.html).toContain('og-default.png');
    });

    it('does not corrupt output when cached OG html contains $-pattern replacement syntax', async () => {
      ogCache.clear();
      const npub = nip19.npubEncode('b'.repeat(64));
      const key = `profile:${'b'.repeat(64)}`;
      const dangerousTagHtml = renderOgTags(
        { title: "Deal $' now", description: 'd', type: 'profile' },
        'https://app.example.com/p/foo'
      );
      ogCache.set(key, dangerousTagHtml, 60000);
      const { event, resolve, captured } = makeHandleInput(`/p/${npub}`);
      await ogMetaHandle({ event, resolve });
      expect(captured.html).toContain('Deal $&#39; now');
      expect(captured.html.match(/<\/head>/g)?.length).toBe(1);
    });

    it('does not touch /api/ paths (no target resolution, no transformPageChunk, nothing cached)', async () => {
      ogCache.clear();
      const naddr = 'naddr1' + 'q'.repeat(60);
      const { event, resolve, captured } = makeHandleInput(`/api/calendar/${naddr}/ics`);
      await ogMetaHandle({ event, resolve });
      expect(resolve).toHaveBeenCalledWith(event);
      expect(resolve.mock.calls[0].length).toBe(1);
      expect(captured.html).toBe('<html><head></head><body></body></html>');
      expect(ogCache.get(naddr)).toBeNull();
    });
  });

  describe('eventMatchesFilter', () => {
    it('matches when kinds/authors/ids/#d all satisfy the filter', () => {
      const event = {
        kind: 30142,
        pubkey: 'abc123',
        id: 'eventid1',
        tags: [['d', 'my-d-tag']]
      };
      expect(
        eventMatchesFilter(event, {
          kinds: [30142],
          authors: ['abc123'],
          ids: ['eventid1'],
          '#d': ['my-d-tag']
        })
      ).toBe(true);
    });

    it('rejects when kind does not match', () => {
      const event = { kind: 1, pubkey: 'abc123', id: 'e1', tags: [] };
      expect(eventMatchesFilter(event, { kinds: [30142] })).toBe(false);
    });

    it('rejects when author is not in the filter list', () => {
      const event = { kind: 1, pubkey: 'someoneelse', id: 'e1', tags: [] };
      expect(eventMatchesFilter(event, { authors: ['abc123'] })).toBe(false);
    });

    it('rejects when id is not in the filter list', () => {
      const event = { kind: 1, pubkey: 'abc123', id: 'wrongid', tags: [] };
      expect(eventMatchesFilter(event, { ids: ['eventid1'] })).toBe(false);
    });

    it('rejects when #d filter present but event has no matching d-tag', () => {
      const event = { kind: 30142, pubkey: 'abc123', id: 'e1', tags: [] };
      expect(eventMatchesFilter(event, { '#d': ['my-d-tag'] })).toBe(false);
    });

    it('rejects when #d filter present but event d-tag value differs', () => {
      const event = { kind: 30142, pubkey: 'abc123', id: 'e1', tags: [['d', 'other-tag']] };
      expect(eventMatchesFilter(event, { '#d': ['my-d-tag'] })).toBe(false);
    });

    it('matches when filter has no constraining fields', () => {
      const event = { kind: 1, pubkey: 'abc123', id: 'e1', tags: [] };
      expect(eventMatchesFilter(event, {})).toBe(true);
    });

    it('never throws on malformed event input', () => {
      expect(() => eventMatchesFilter(null, { kinds: [1] })).not.toThrow();
      expect(eventMatchesFilter(null, { kinds: [1] })).toBe(false);
      expect(() => eventMatchesFilter(undefined, {})).not.toThrow();
      expect(() => eventMatchesFilter({}, { '#d': ['x'] })).not.toThrow();
    });
  });

  describe('verifyEvent integration (locks in nostr-tools/pure import path)', () => {
    it('accepts a properly signed event and rejects a tampered one', () => {
      const sk = generateSecretKey();
      const signed = finalizeEvent(
        { kind: 1, created_at: 1700000000, tags: [], content: 'hello world' },
        sk
      );
      expect(verifyEvent(signed)).toBe(true);
      // Round-trip through JSON to drop nostr-tools' internal verified-cache
      // Symbol (spreading `signed` directly would carry the cached `true`
      // verdict along with it, since Symbol-keyed props survive `{...obj}`).
      const tampered = JSON.parse(JSON.stringify(signed));
      tampered.content = 'tampered';
      expect(verifyEvent(tampered)).toBe(false);
    });
  });
});
