/**
 * GEO measurement: daily counters of crawler requests and of visits referred
 * by AI assistants / search engines, written as one JSON file per day to
 * GEO_STATS_DIR (unset = off).
 *
 * Data minimization by design: nothing per request is stored. The client IP is
 * only used in memory to check a crawler against the IP ranges its operator
 * publishes, then dropped. Stored are sums per (crawler family, verified,
 * path, status), per (referrer host group, landing path, utm_source), the
 * total human page views, and the user-agent strings of unknown *bots*.
 * No IP, no browser user agent, no full referrer URL, no cookies.
 */
import { env } from '$env/dynamic/private';
import { BlockList, isIP } from 'node:net';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OPENAI = 'https://openai.com';
// Moved 2026: the old /static/search/apis/ipranges/ lists only redirect here.
const GOOGLE = 'https://developers.google.com/static/crawling/ipranges';
const PERPLEXITY = 'https://www.perplexity.com';

/**
 * Most specific first. `ranges`: the operator's published IP range lists
 * (Anthropic, Meta, Amazon … publish none — their requests stay "unverified").
 * @type {{ family: string, ua: RegExp, ranges: string[] }[]}
 */
const CRAWLERS = [
  { family: 'OAI-SearchBot', ua: /OAI-SearchBot/i, ranges: [`${OPENAI}/searchbot.json`] },
  { family: 'ChatGPT-User', ua: /ChatGPT-User/i, ranges: [`${OPENAI}/chatgpt-user.json`] },
  { family: 'GPTBot', ua: /GPTBot/i, ranges: [`${OPENAI}/gptbot.json`] },
  { family: 'Claude-User', ua: /Claude-User/i, ranges: [] },
  { family: 'Claude-SearchBot', ua: /Claude-SearchBot/i, ranges: [] },
  { family: 'ClaudeBot', ua: /ClaudeBot|anthropic-ai/i, ranges: [] },
  {
    family: 'Perplexity-User',
    ua: /Perplexity-User/i,
    ranges: [`${PERPLEXITY}/perplexity-user.json`]
  },
  { family: 'PerplexityBot', ua: /PerplexityBot/i, ranges: [`${PERPLEXITY}/perplexitybot.json`] },
  {
    family: 'MistralAI-User',
    ua: /MistralAI-User/i,
    ranges: ['https://mistral.ai/mistralai-user-ips.json']
  },
  {
    family: 'DuckAssistBot',
    ua: /DuckAssistBot/i,
    ranges: ['https://duckduckgo.com/duckassistbot.json']
  },
  {
    family: 'DuckDuckBot',
    ua: /DuckDuckBot/i,
    ranges: ['https://duckduckgo.com/duckduckbot.json']
  },
  {
    family: 'GoogleOther',
    ua: /GoogleOther|Google-InspectionTool/i,
    // Common crawlers, like Googlebot — not the special-case list (AdsBot & co.)
    ranges: [`${GOOGLE}/common-crawlers.json`]
  },
  { family: 'Googlebot', ua: /Googlebot/i, ranges: [`${GOOGLE}/common-crawlers.json`] },
  { family: 'bingbot', ua: /bingbot/i, ranges: ['https://www.bing.com/toolbox/bingbot.json'] },
  {
    family: 'Applebot',
    ua: /Applebot/i,
    ranges: ['https://search.developer.apple.com/applebot.json']
  },
  { family: 'meta-externalagent', ua: /meta-externalagent|meta-webindexer/i, ranges: [] },
  { family: 'Amazonbot', ua: /Amazonbot/i, ranges: [] },
  { family: 'Bytespider', ua: /Bytespider/i, ranges: [] },
  { family: 'CCBot', ua: /CCBot/i, ranges: [] },
  { family: 'YandexBot', ua: /YandexBot/i, ranges: [] },
  { family: 'Baiduspider', ua: /Baiduspider/i, ranges: [] }
];

const GENERIC_BOT = /bot\b|bot\/|crawler|spider|scraper|fetcher/i;

/**
 * @param {string | null | undefined} ua
 * @returns {{ family: string, ranges: string[] } | null} null for browsers
 */
export function classifyUserAgent(ua) {
  if (!ua) return null;
  const known = CRAWLERS.find((c) => c.ua.test(ua));
  if (known) return { family: known.family, ranges: known.ranges };
  return GENERIC_BOT.test(ua) ? { family: 'other-bot', ranges: [] } : null;
}

/** Referrer hosts reported by name; every other external site is "other". */
const REFERRER_HOSTS = /** @type {[RegExp, string][]} */ ([
  [/^(chatgpt\.com|chat\.openai\.com)$/, 'chatgpt.com'],
  [/^(www\.)?perplexity\.ai$/, 'perplexity.ai'],
  [/^copilot\.microsoft\.com$/, 'copilot.microsoft.com'],
  [/^gemini\.google\.com$/, 'gemini.google.com'],
  [/^claude\.ai$/, 'claude.ai'],
  [/^chat\.mistral\.ai$/, 'chat.mistral.ai'],
  [/^(www\.)?you\.com$/, 'you.com'],
  [/^(www\.)?phind\.com$/, 'phind.com'],
  [/^(www\.)?google\.[a-z.]+$/, 'google'],
  [/^(www\.|cn\.)?bing\.com$/, 'bing'],
  [/^(html\.|lite\.)?duckduckgo\.com$/, 'duckduckgo'],
  [/^(www\.)?ecosia\.org$/, 'ecosia'],
  [/^search\.brave\.com$/, 'brave'],
  [/^(www\.)?startpage\.com$/, 'startpage']
]);

/**
 * @param {string | null | undefined} referer
 * @param {string} ownHost
 * @returns {string | null} host group, "other", or null (none / own site)
 */
export function classifyReferrer(referer, ownHost) {
  if (!referer) return null;
  let host;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === ownHost) return null;
  return REFERRER_HOSTS.find(([re]) => re.test(host))?.[1] ?? 'other';
}

/** @param {string | null} value */
const safeUtm = (value) =>
  value && /^[a-z0-9._-]{1,50}$/i.test(value) ? value.toLowerCase() : null;

/**
 * Client IP: the edge proxy (VPS Traefik) replaces untrusted X-Forwarded-For
 * and the homelab Traefik appends its hop, so the left-most entry is the client.
 * @param {Headers} headers
 * @param {() => string} getClientAddress
 * @returns {string | null}
 */
export function clientIp(headers, getClientAddress) {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getClientAddress();
  } catch {
    return null;
  }
}

/**
 * Checks IPs against published crawler range lists, refreshed in the
 * background (never on the request path).
 * @param {{ fetchJson: (url: string) => Promise<any>, ttlMs: number, now?: () => number }} opts
 */
export function createRangeVerifier({ fetchJson, ttlMs, now = Date.now }) {
  /** @type {Map<string, { list: BlockList, at: number }>} */
  const lists = new Map();
  /** @type {Set<string>} */
  const loading = new Set();

  /** @param {string} url */
  function load(url) {
    if (loading.has(url)) return;
    loading.add(url);
    fetchJson(url)
      .then((data) => {
        const list = new BlockList();
        for (const p of data?.prefixes ?? []) {
          const [net, len] = String(p.ipv4Prefix ?? p.ipv6Prefix ?? '').split('/');
          const type = p.ipv4Prefix ? 'ipv4' : 'ipv6';
          if (net && len && isIP(net)) list.addSubnet(net, Number(len), type);
        }
        lists.set(url, { list, at: now() });
      })
      .catch(() => {})
      .finally(() => loading.delete(url));
  }

  return {
    /** Start loading range lists ahead of the first crawler request. @param {string[]} urls */
    prime(urls) {
      for (const url of urls) if (!lists.has(url)) load(url);
    },
    /**
     * @param {string[]} urls - range lists of the claimed crawler family
     * @param {string | null} ip
     * @returns {boolean | null} null = cannot tell (no published ranges, not loaded, no IP)
     */
    verify(urls, ip) {
      if (urls.length === 0 || !ip) return null;
      const mapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
      const type = isIP(mapped) === 4 ? 'ipv4' : isIP(mapped) === 6 ? 'ipv6' : null;
      if (!type) return null;
      let known = false;
      for (const url of urls) {
        const entry = lists.get(url);
        if (!entry || now() - entry.at > ttlMs) load(url);
        if (!entry) continue;
        known = true;
        if (entry.list.check(mapped, type)) return true;
      }
      return known ? false : null;
    }
  };
}

/**
 * @typedef {{ family: string, verified: boolean | null, path: string, status: number, count: number, bytes: number }} CrawlerRow
 * @typedef {{ source: string | null, path: string, utm: string | null, count: number }} ReferralRow
 * @typedef {{ day: string, pageviews: number, crawlers: Map<string, CrawlerRow>, unknownBots: Map<string, number>, referrals: Map<string, ReferralRow>, dirty: boolean }} DayStats
 */

/**
 * In-memory day counters, persisted as `<dir>/<YYYY-MM-DD>.json`. A day file
 * that already exists (e.g. after a restart) is continued, not overwritten.
 * @param {{ dir: string }} opts
 */
export function createStatsStore({ dir }) {
  /** @type {Map<string, DayStats>} */
  const days = new Map();

  /** @param {string} day */
  function getDay(day) {
    let stats = days.get(day);
    if (stats) return stats;
    stats = {
      day,
      pageviews: 0,
      crawlers: new Map(),
      unknownBots: new Map(),
      referrals: new Map(),
      dirty: false
    };
    try {
      const saved = JSON.parse(readFileSync(join(dir, `${day}.json`), 'utf8'));
      stats.pageviews = saved.pageviews ?? 0;
      for (const r of saved.crawlers ?? []) stats.crawlers.set(crawlerKey(r), { ...r });
      for (const r of saved.unknownBots ?? []) stats.unknownBots.set(r.ua, r.count);
      for (const r of saved.referrals ?? []) stats.referrals.set(referralKey(r), { ...r });
    } catch {
      // no file yet (or unreadable): start empty
    }
    days.set(day, stats);
    // Keep memory bounded: finished days are flushed and dropped.
    for (const [d, s] of days) {
      if (d < day && !s.dirty) days.delete(d);
    }
    return stats;
  }

  /** @param {{ family: string, verified: boolean | null, path: string, status: number }} r */
  const crawlerKey = (r) => `${r.family}|${r.verified}|${r.status}|${r.path}`;
  /** @param {{ source: string | null, path: string, utm: string | null }} r */
  const referralKey = (r) => `${r.source}|${r.utm}|${r.path}`;

  return {
    /**
     * @param {string} day
     * @param {{ family: string, verified: boolean | null, path: string, status: number, bytes: number | null }} r
     */
    crawler(day, { bytes, ...r }) {
      const stats = getDay(day);
      const key = crawlerKey(r);
      const row = stats.crawlers.get(key) ?? { ...r, count: 0, bytes: 0 };
      row.count += 1;
      row.bytes += bytes ?? 0;
      stats.crawlers.set(key, row);
      stats.dirty = true;
    },
    /** @param {string} day @param {string} ua */
    unknownBot(day, ua) {
      const stats = getDay(day);
      const key = ua.slice(0, 200);
      stats.unknownBots.set(key, (stats.unknownBots.get(key) ?? 0) + 1);
      stats.dirty = true;
    },
    /** @param {string} day @param {{ source: string | null, path: string, utm: string | null }} r */
    referral(day, r) {
      const stats = getDay(day);
      const key = referralKey(r);
      const row = stats.referrals.get(key) ?? { ...r, count: 0 };
      row.count += 1;
      stats.referrals.set(key, row);
      stats.dirty = true;
    },
    /** @param {string} day */
    pageview(day) {
      const stats = getDay(day);
      stats.pageviews += 1;
      stats.dirty = true;
    },
    /** Write every changed day (atomically: temp file + rename). */
    flush() {
      for (const stats of days.values()) {
        if (!stats.dirty) continue;
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${stats.day}.json`);
        const data = {
          day: stats.day,
          pageviews: stats.pageviews,
          crawlers: [...stats.crawlers.values()],
          unknownBots: [...stats.unknownBots].map(([ua, count]) => ({ ua, count })),
          referrals: [...stats.referrals.values()]
        };
        writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1));
        renameSync(`${file}.tmp`, file);
        stats.dirty = false;
      }
    }
  };
}

/** Responses worth counting: pages, robots.txt, sitemap.xml. */
const COUNTED_TYPES = /^(text\/html|text\/plain|application\/xml|text\/xml)/;

/**
 * @param {{ dir: string, verifier: { verify: (urls: string[], ip: string | null) => boolean | null }, store?: ReturnType<typeof createStatsStore> }} opts
 */
export function createCrawlerStatsHandle({ dir, verifier, store = createStatsStore({ dir }) }) {
  /** @type {import('@sveltejs/kit').Handle} */
  const handle = async ({ event, resolve }) => {
    const response = await resolve(event);
    try {
      const { pathname, searchParams, hostname } = event.url;
      if (event.request.method !== 'GET' || pathname.startsWith('/api/')) return response;
      if (!COUNTED_TYPES.test(response.headers.get('content-type') ?? '')) return response;

      const day = new Date().toISOString().slice(0, 10);
      const ua = event.request.headers.get('user-agent');
      const bot = classifyUserAgent(ua);
      if (bot) {
        const ip = clientIp(event.request.headers, event.getClientAddress);
        const length = Number(response.headers.get('content-length'));
        store.crawler(day, {
          family: bot.family,
          verified: verifier.verify(bot.ranges, ip),
          path: pathname,
          status: response.status,
          bytes: Number.isFinite(length) ? length : null
        });
        if (bot.family === 'other-bot' && ua) store.unknownBot(day, ua);
        return response;
      }

      if (!/^text\/html/.test(response.headers.get('content-type') ?? '')) return response;
      // Error pages are no visits: scanners probing /.env or /wp-login.php
      // get the HTML 404 page and would count as page views and referrals.
      if (response.status >= 400) return response;
      store.pageview(day);
      const source = classifyReferrer(event.request.headers.get('referer'), hostname);
      const utm = safeUtm(searchParams.get('utm_source'));
      if (source || utm) store.referral(day, { source, path: pathname, utm });
    } catch {
      // measurement must never break a page
    }
    return response;
  };
  return { handle, store };
}

const FLUSH_INTERVAL = 5 * 60 * 1000;
const RANGES_TTL = 24 * 60 * 60 * 1000;

/** @type {ReturnType<typeof createCrawlerStatsHandle> | null} */
let instance = null;

/** @param {string} dir */
function start(dir) {
  const verifier = createRangeVerifier({
    fetchJson: async (url) => (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json(),
    ttlMs: RANGES_TTL
  });
  verifier.prime(CRAWLERS.flatMap((c) => c.ranges));
  const stats = createCrawlerStatsHandle({ dir, verifier });
  const flush = () => {
    try {
      stats.store.flush();
    } catch {
      // disk full / unwritable: keep counting in memory
    }
  };
  setInterval(flush, FLUSH_INTERVAL).unref();
  // Synchronous writes are allowed in 'exit' — covers adapter-node's graceful shutdown.
  process.once('exit', flush);
  return stats;
}

/**
 * SvelteKit handle: counts when GEO_STATS_DIR is set, otherwise a pass-through.
 * @type {import('@sveltejs/kit').Handle}
 */
export async function geoStatsHandle({ event, resolve }) {
  const dir = env.GEO_STATS_DIR;
  if (!dir) return resolve(event);
  instance ??= start(dir);
  return instance.handle({ event, resolve });
}
