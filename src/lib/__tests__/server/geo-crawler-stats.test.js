/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = vi.hoisted(() => /** @type {Record<string, string | undefined>} */ ({}));
vi.mock('$env/dynamic/private', () => ({ env }));

import {
  classifyUserAgent,
  classifyReferrer,
  clientIp,
  createRangeVerifier,
  createStatsStore,
  createCrawlerStatsHandle,
  geoStatsHandle
} from '$lib/server/geo/crawler-stats.js';

describe('classifyUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'GPTBot'
    ],
    ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', 'OAI-SearchBot'],
    [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0',
      'ChatGPT-User'
    ],
    ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ClaudeBot'],
    ['Mozilla/5.0 (compatible; Claude-User/1.0)', 'Claude-User'],
    [
      'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
      'PerplexityBot'
    ],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot'],
    ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'bingbot'],
    [
      'Mozilla/5.0 (compatible; DuckAssistBot/1.2; +http://duckduckgo.com/duckassistbot.html)',
      'DuckAssistBot'
    ],
    [
      'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
      'meta-externalagent'
    ]
  ])('%s → %s', (ua, family) => {
    expect(classifyUserAgent(ua)?.family).toBe(family);
  });

  it('flags unknown bots as other-bot and ignores browsers', () => {
    expect(classifyUserAgent('NewAIcrawler/0.1 (+https://x.example)')?.family).toBe('other-bot');
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36'
      )
    ).toBeNull();
    expect(classifyUserAgent('')).toBeNull();
  });

  it('knows which families publish IP ranges', () => {
    expect(classifyUserAgent('GPTBot/1.2')?.ranges?.length).toBeGreaterThan(0);
    expect(classifyUserAgent('ClaudeBot/1.0')?.ranges ?? []).toEqual([]);
  });

  it("checks Google's common crawlers against common-crawlers.json at its current address", () => {
    // GoogleOther and Google-InspectionTool are common crawlers, like Googlebot
    // (Google, "Common crawlers": IP ranges in common-crawlers.json). The old
    // /static/search/apis/ipranges/ paths only redirect there.
    const common = 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json';
    expect(classifyUserAgent('Mozilla/5.0 (compatible; GoogleOther)')?.ranges).toEqual([common]);
    expect(
      classifyUserAgent('Mozilla/5.0 (compatible; Google-InspectionTool/1.0)')?.ranges
    ).toEqual([common]);
    expect(
      classifyUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')
        ?.ranges
    ).toEqual([common]);
  });
});

describe('classifyReferrer', () => {
  it('names AI assistants and search engines by host only', () => {
    expect(classifyReferrer('https://chatgpt.com/c/abc-private-id', 'edufeed.org')).toBe(
      'chatgpt.com'
    );
    expect(classifyReferrer('https://www.perplexity.ai/search/x', 'edufeed.org')).toBe(
      'perplexity.ai'
    );
    expect(classifyReferrer('https://gemini.google.com/app', 'edufeed.org')).toBe(
      'gemini.google.com'
    );
    expect(classifyReferrer('https://www.google.de/', 'edufeed.org')).toBe('google');
    expect(classifyReferrer('https://www.bing.com/search?q=x', 'edufeed.org')).toBe('bing');
  });

  it('collapses every other site into "other" and ignores own and missing referrers', () => {
    expect(classifyReferrer('https://intranet.uni-x.de/path', 'edufeed.org')).toBe('other');
    expect(classifyReferrer('https://edufeed.org/discover', 'edufeed.org')).toBeNull();
    expect(classifyReferrer(null, 'edufeed.org')).toBeNull();
    expect(classifyReferrer('not a url', 'edufeed.org')).toBeNull();
  });
});

describe('clientIp', () => {
  it('takes the left-most X-Forwarded-For entry (set by the edge proxy)', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(clientIp(headers, () => '10.0.0.2')).toBe('203.0.113.7');
  });

  it('falls back to the socket address', () => {
    expect(clientIp(new Headers(), () => '198.51.100.4')).toBe('198.51.100.4');
    expect(
      clientIp(new Headers(), () => {
        throw new Error('no address');
      })
    ).toBeNull();
  });
});

describe('createRangeVerifier', () => {
  const ranges = {
    'https://r.example/gptbot.json': {
      prefixes: [{ ipv4Prefix: '20.15.240.0/24' }, { ipv6Prefix: '2001:db8::/32' }]
    }
  };

  it('returns null until the ranges are loaded, then true/false', async () => {
    const fetchJson = vi.fn(
      async (/** @type {string} */ url) => ranges[/** @type {keyof typeof ranges} */ (url)]
    );
    const verifier = createRangeVerifier({ fetchJson, ttlMs: 1000 });
    const urls = ['https://r.example/gptbot.json'];
    expect(verifier.verify(urls, '20.15.240.9')).toBeNull();
    await vi.waitFor(() => expect(verifier.verify(urls, '20.15.240.9')).toBe(true));
    expect(verifier.verify(urls, '20.15.241.9')).toBe(false);
    expect(verifier.verify(urls, '2001:db8::1')).toBe(true);
    expect(verifier.verify(urls, '::ffff:20.15.240.9')).toBe(true);
    expect(verifier.verify(urls, null)).toBeNull();
  });

  it('can load range lists ahead of the first request', async () => {
    const fetchJson = vi.fn(async () => ranges['https://r.example/gptbot.json']);
    const verifier = createRangeVerifier({ fetchJson, ttlMs: 1000 });
    verifier.prime(['https://r.example/gptbot.json']);
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(verifier.verify(['https://r.example/gptbot.json'], '20.15.240.9')).toBe(true);
  });

  it('returns null for families without published ranges or failed downloads', async () => {
    const verifier = createRangeVerifier({
      fetchJson: async () => {
        throw new Error('down');
      },
      ttlMs: 1000
    });
    expect(verifier.verify([], '1.2.3.4')).toBeNull();
    verifier.verify(['https://r.example/x.json'], '1.2.3.4');
    await new Promise((r) => setTimeout(r, 10));
    expect(verifier.verify(['https://r.example/x.json'], '1.2.3.4')).toBeNull();
  });
});

describe('createStatsStore', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'geo-stats-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('aggregates counts per day and writes one JSON file per day', () => {
    const store = createStatsStore({ dir });
    store.crawler('2026-11-03', {
      family: 'GPTBot',
      verified: true,
      path: '/wiki/a',
      status: 200,
      bytes: 1000
    });
    store.crawler('2026-11-03', {
      family: 'GPTBot',
      verified: true,
      path: '/wiki/a',
      status: 200,
      bytes: 500
    });
    store.crawler('2026-11-03', {
      family: 'GPTBot',
      verified: false,
      path: '/wiki/a',
      status: 200,
      bytes: null
    });
    store.unknownBot('2026-11-03', 'NewAIcrawler/0.1');
    store.referral('2026-11-03', { source: 'chatgpt.com', path: '/wiki/a', utm: 'chatgpt.com' });
    store.pageview('2026-11-03');
    store.pageview('2026-11-03');
    store.flush();

    const data = JSON.parse(readFileSync(join(dir, '2026-11-03.json'), 'utf8'));
    expect(data.day).toBe('2026-11-03');
    expect(data.pageviews).toBe(2);
    expect(data.crawlers).toContainEqual({
      family: 'GPTBot',
      verified: true,
      path: '/wiki/a',
      status: 200,
      count: 2,
      bytes: 1500
    });
    expect(data.crawlers).toContainEqual({
      family: 'GPTBot',
      verified: false,
      path: '/wiki/a',
      status: 200,
      count: 1,
      bytes: 0
    });
    expect(data.unknownBots).toEqual([{ ua: 'NewAIcrawler/0.1', count: 1 }]);
    expect(data.referrals).toEqual([
      { source: 'chatgpt.com', path: '/wiki/a', utm: 'chatgpt.com', count: 1 }
    ]);
    expect(JSON.stringify(data)).not.toMatch(/\d+\.\d+\.\d+\.\d+/); // no IP anywhere
  });

  it('continues an existing day file after a restart instead of overwriting it', () => {
    writeFileSync(
      join(dir, '2026-11-03.json'),
      JSON.stringify({
        day: '2026-11-03',
        pageviews: 5,
        crawlers: [
          { family: 'bingbot', verified: true, path: '/', status: 200, count: 3, bytes: 30 }
        ],
        unknownBots: [],
        referrals: []
      })
    );
    const store = createStatsStore({ dir });
    store.crawler('2026-11-03', {
      family: 'bingbot',
      verified: true,
      path: '/',
      status: 200,
      bytes: 10
    });
    store.pageview('2026-11-03');
    store.flush();
    const data = JSON.parse(readFileSync(join(dir, '2026-11-03.json'), 'utf8'));
    expect(data.pageviews).toBe(6);
    expect(data.crawlers).toEqual([
      { family: 'bingbot', verified: true, path: '/', status: 200, count: 4, bytes: 40 }
    ]);
  });

  it('only writes days that changed', () => {
    const store = createStatsStore({ dir });
    store.flush();
    expect(existsSync(join(dir, '2026-11-03.json'))).toBe(false);
  });
});

describe('createCrawlerStatsHandle', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'geo-stats-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** @param {any} handle @param {string} path @param {Record<string,string>} headers @param {string} [contentType] @param {string} [method] @param {number} [status] */
  async function request(
    handle,
    path,
    headers,
    contentType = 'text/html',
    method = 'GET',
    status = 200
  ) {
    const event = {
      url: new URL(`https://edufeed.org${path}`),
      request: new Request(`https://edufeed.org${path}`, { method, headers }),
      getClientAddress: () => '10.0.0.2'
    };
    const resolve = vi.fn(
      async () =>
        new Response('<html></html>', {
          status,
          headers: { 'content-type': contentType, 'content-length': '13' }
        })
    );
    return handle({ event, resolve });
  }

  const today = new Date().toISOString().slice(0, 10);
  const read = () => JSON.parse(readFileSync(join(dir, `${today}.json`), 'utf8'));

  it('counts crawlers, referrals and human page views — and stores no IP or browser UA', async () => {
    const { handle, store } = createCrawlerStatsHandle({ dir, verifier: { verify: () => true } });
    await request(handle, '/wiki/a', {
      'user-agent': 'GPTBot/1.2',
      'x-forwarded-for': '20.15.240.9'
    });
    await request(handle, '/wiki/a?x=1', {
      'user-agent': 'Mozilla/5.0 Chrome/130',
      referer: 'https://chatgpt.com/c/secret',
      'x-forwarded-for': '203.0.113.7'
    });
    await request(handle, '/robots.txt', { 'user-agent': 'bingbot/2.0' }, 'text/plain');
    store.flush();
    const data = read();
    expect(data.crawlers).toContainEqual({
      family: 'GPTBot',
      verified: true,
      path: '/wiki/a',
      status: 200,
      count: 1,
      bytes: 13
    });
    expect(data.crawlers).toContainEqual({
      family: 'bingbot',
      verified: true,
      path: '/robots.txt',
      status: 200,
      count: 1,
      bytes: 13
    });
    expect(data.referrals).toEqual([
      { source: 'chatgpt.com', path: '/wiki/a', utm: null, count: 1 }
    ]);
    expect(data.pageviews).toBe(1);
    const raw = JSON.stringify(data);
    expect(raw).not.toContain('203.0.113.7');
    expect(raw).not.toContain('Chrome');
    expect(raw).not.toContain('secret');
  });

  it('ignores API calls, non-GET requests and assets', async () => {
    const { handle, store } = createCrawlerStatsHandle({ dir, verifier: { verify: () => null } });
    await request(handle, '/api/config', { 'user-agent': 'GPTBot/1.2' }, 'application/json');
    await request(handle, '/wiki/a', { 'user-agent': 'GPTBot/1.2' }, 'text/html', 'POST');
    await request(handle, '/_app/x.js', { 'user-agent': 'GPTBot/1.2' }, 'text/javascript');
    store.flush();
    expect(existsSync(join(dir, `${today}.json`))).toBe(false);
  });

  it('counts no page view or referral for error pages (scanners probing /.env and co.)', async () => {
    const { handle, store } = createCrawlerStatsHandle({ dir, verifier: { verify: () => null } });
    const scanner = { 'user-agent': 'Mozilla/5.0 Chrome/130', referer: 'https://evil.example/' };
    await request(handle, '/.env', scanner, 'text/html', 'GET', 404);
    await request(handle, '/wp-login.php', scanner, 'text/html', 'GET', 404);
    await request(
      handle,
      '/wiki/a',
      { 'user-agent': 'Mozilla/5.0 Chrome/130' },
      'text/html',
      'GET',
      500
    );
    // a crawler's 404 still counts: it shows what the crawler asked for
    await request(handle, '/gone', { 'user-agent': 'GPTBot/1.2' }, 'text/html', 'GET', 404);
    store.flush();
    const data = read();
    expect(data.pageviews).toBe(0);
    expect(data.referrals).toEqual([]);
    expect(data.crawlers).toContainEqual(
      expect.objectContaining({ family: 'GPTBot', path: '/gone', status: 404 })
    );
  });

  it('keeps only safe utm_source values', async () => {
    const { handle, store } = createCrawlerStatsHandle({ dir, verifier: { verify: () => null } });
    await request(handle, '/wiki/a?utm_source=chatgpt.com', {
      'user-agent': 'Mozilla/5.0 Firefox/130'
    });
    await request(handle, '/wiki/a?utm_source=<script>max@mustermann.de', {
      'user-agent': 'Mozilla/5.0 Firefox/130'
    });
    store.flush();
    const referrals = read().referrals;
    expect(referrals).toContainEqual({
      source: null,
      path: '/wiki/a',
      utm: 'chatgpt.com',
      count: 1
    });
    expect(JSON.stringify(referrals)).not.toContain('mustermann');
  });
});

describe('geoStatsHandle', () => {
  it('is a pass-through without GEO_STATS_DIR', async () => {
    delete env.GEO_STATS_DIR;
    const response = new Response('ok', { headers: { 'content-type': 'text/html' } });
    const resolve = vi.fn(async () => response);
    const event = {
      url: new URL('https://edufeed.org/'),
      request: new Request('https://edufeed.org/', { headers: { 'user-agent': 'GPTBot/1.2' } }),
      getClientAddress: () => '1.2.3.4'
    };
    expect(await geoStatsHandle(/** @type {any} */ ({ event, resolve }))).toBe(response);
    expect(resolve).toHaveBeenCalledWith(event);
  });
});
