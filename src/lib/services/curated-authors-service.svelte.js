/**
 * Curated Authors Service
 *
 * Restricts primary content (calendar events, AMB resources, articles, community definitions,
 * kanban boards) to specific authors, with per-content-type granularity.
 *
 * Two author sources are unioned per category:
 * 1. **Curated** — Direct pubkeys and follow set naddrs (kind 30000)
 * 2. **WoT (Web of Trust)** — Anchor pubkeys + their kind 3 follows + optional user follows
 *
 * Configured via per-category env vars with global fallback:
 * - CURATED_PUBKEYS_SETS / CURATED_PUBKEYS: global defaults
 * - CURATED_PUBKEYS_SETS_CALENDAR / CURATED_PUBKEYS_CALENDAR: category override (replaces global)
 * - WOT_ENABLED / WOT_ANCHOR_PUBKEYS: global WoT config
 * - WOT_ANCHOR_PUBKEYS_EDUCATIONAL: category-specific WoT anchors
 * - Same pattern for COMMUNIKEY, EDUCATIONAL, LONGFORM, KANBAN
 *
 * If a category has its own env vars, they completely replace the global config for that category.
 * Both sets and direct pubkeys are unioned per category.
 * When not configured for a category, functions return null (no filtering applied).
 */
import { browser } from '$app/environment';
import { nip19 } from 'nostr-tools';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { kindToAppRelayCategory } from '$lib/services/app-relay-service.svelte.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { lastValueFrom, toArray } from 'rxjs';

/** @typedef {'calendar' | 'communikey' | 'educational' | 'longform' | 'kanban'} CuratedCategory */

// --- localStorage cache for curated/WoT author lists ---

const CURATED_CACHE_KEY = 'curated-authors-cache';
const CACHE_VERSION = 1;
export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @typedef {Object} CachedAuthorsData
 * @property {Record<string, string[]>} curated
 * @property {Record<string, string[]>} wot
 */

/**
 * Load cached curated/WoT author lists from localStorage.
 * Returns null if no cache, expired, or invalid.
 * @returns {CachedAuthorsData | null}
 */
export function loadCachedAuthors() {
  try {
    const raw = localStorage.getItem(CURATED_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== CACHE_VERSION) return null;
    if (Date.now() - data.timestamp > CACHE_TTL_MS) return null;
    return { curated: data.curated || {}, wot: data.wot || {} };
  } catch {
    return null;
  }
}

/**
 * Save curated/WoT author lists to localStorage.
 * @param {Map<string, string[] | null>} curated
 * @param {Map<string, string[]>} wot
 */
export function saveCachedAuthors(curated, wot) {
  try {
    /** @type {Record<string, string[]>} */
    const curatedObj = {};
    for (const [key, val] of curated) {
      if (val) curatedObj[key] = val;
    }
    /** @type {Record<string, string[]>} */
    const wotObj = {};
    for (const [key, val] of wot) {
      wotObj[key] = val;
    }
    localStorage.setItem(
      CURATED_CACHE_KEY,
      JSON.stringify({
        version: CACHE_VERSION,
        timestamp: Date.now(),
        curated: curatedObj,
        wot: wotObj
      })
    );
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/**
 * Clear the cached author lists.
 */
export function clearCachedAuthors() {
  try {
    localStorage.removeItem(CURATED_CACHE_KEY);
  } catch {
    // ignore
  }
}

const ALL_CATEGORIES = /** @type {const} */ ([
  'calendar',
  'communikey',
  'educational',
  'longform',
  'kanban'
]);

/**
 * Per-category cache of curated author pubkeys.
 * null = not configured (no filtering), string[] = allowed pubkeys
 * @type {Map<string, string[] | null>}
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-level cache, not reactive state
const curatedAuthorsCache = new Map();

/** Categories whose direct pubkeys have been lazily parsed */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-level cache, not reactive state
const directPubkeysInitialized = new Set();

/** Categories whose follow sets have been fully initialized */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-level cache, not reactive state
const followSetsInitialized = new Set();

// --- WoT (Web of Trust) state ---

/**
 * Per-category cache of WoT author pubkeys (anchor pubkeys + their follows).
 * @type {Map<string, string[]>}
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-level cache, not reactive state
const wotAuthorsCache = new Map();

/** Categories whose WoT anchors have been fetched */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-level cache, not reactive state
const wotInitialized = new Set();

/** Logged-in user's follow pubkeys (set on login, cleared on logout) */
let userFollowPubkeys = /** @type {string[]} */ ([]);

/** Logged-in user's own pubkey (always included in curated filter when set) */
let activeUserPubkey = '';

/**
 * Reactive version counter — increments on every cache mutation.
 * Components call getCuratedCacheVersion() in $derived to re-evaluate
 * when the cache changes asynchronously.
 */
let curatedCacheVersion = $state(0);

/**
 * Get the current cache version. Read this inside $derived to establish
 * a reactive dependency on cache mutations.
 * @returns {number}
 */
export function getCuratedCacheVersion() {
  return curatedCacheVersion;
}

/**
 * Get the curated mode config for a category from runtime config.
 * @param {string} category
 * @returns {{ sets: string[], direct: string[] }}
 */
function getCategoryConfig(category) {
  const cfg = /** @type {Record<string, {sets: string[], direct: string[]}>} */ (
    runtimeConfig.curatedMode
  )?.[category];
  return {
    sets: Array.isArray(cfg?.sets) ? cfg.sets : [],
    direct: Array.isArray(cfg?.direct) ? cfg.direct : []
  };
}

/**
 * Parse direct pubkeys from config on first access for a category (lazy, synchronous).
 * @param {string} category
 */
function ensureDirectPubkeysInitialized(category) {
  if (directPubkeysInitialized.has(category)) return;
  directPubkeysInitialized.add(category);

  const { direct } = getCategoryConfig(category);
  if (direct.length > 0) {
    const parsed = parseDirectPubkeys(direct);
    if (parsed.length > 0 && !curatedAuthorsCache.has(category)) {
      curatedAuthorsCache.set(category, parsed);
      curatedCacheVersion++;
    }
  }
}

/**
 * Parse direct pubkey entries (hex or npub) into hex pubkeys.
 * Skips invalid entries with a warning.
 * @param {string[]} entries
 * @returns {string[]}
 */
export function parseDirectPubkeys(entries) {
  /** @type {string[]} */
  const pubkeys = [];

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(trimmed);
        if (decoded.type === 'npub') {
          pubkeys.push(/** @type {string} */ (decoded.data));
        } else {
          console.warn('Curated authors: Expected npub, got', decoded.type, 'for', trimmed);
        }
      } catch (err) {
        console.warn('Curated authors: Failed to decode npub:', trimmed, err);
      }
    } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      pubkeys.push(trimmed.toLowerCase());
    } else {
      console.warn('Curated authors: Invalid pubkey entry (not hex or npub):', trimmed);
    }
  }

  return pubkeys;
}

/**
 * Check if curated mode is configured for a category (either source has entries)
 * @param {string} category
 * @returns {boolean}
 */
export function isCuratedModeConfigured(category) {
  const { sets, direct } = getCategoryConfig(category);
  return sets.length > 0 || direct.length > 0;
}

/**
 * Check if curated mode is active for a category (configured AND loaded with >0 pubkeys)
 * @param {string} category
 * @returns {boolean}
 */
export function isCuratedModeActive(category) {
  const authors = curatedAuthorsCache.get(category);
  return authors !== undefined && authors !== null && authors.length > 0;
}

/**
 * Get the combined author pubkeys for a specific category.
 * Unions curated authors + WoT anchor follows + user follows (if enabled).
 * Returns null when no author source is configured for the category (no filtering).
 * Returns string[] when active (add as `authors` filter).
 * @param {string} category
 * @returns {string[] | null}
 */
export function getCuratedAuthors(category) {
  ensureDirectPubkeysInitialized(category);
  const curated = curatedAuthorsCache.get(category) ?? null;
  const wot = wotAuthorsCache.get(category) ?? null;
  const includeUser = runtimeConfig.wotMode?.includeUserFollows && userFollowPubkeys.length > 0;

  if (!curated && !wot && !includeUser) return null;

  const combined = [
    ...(curated || []),
    ...(wot || []),
    ...(includeUser ? userFollowPubkeys : []),
    ...(activeUserPubkey ? [activeUserPubkey] : [])
  ];
  if (combined.length === 0) return null;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- dedup only, not reactive state
  return [...new Set(combined)];
}

/**
 * Apply curated author filtering to a Nostr filter object.
 * Derives the category automatically from filter.kinds using kindToAppRelayCategory().
 * Returns a new filter with `authors` set if curated mode is active for the category.
 *
 * Does NOT override explicit author filtering (when filter.authors already has entries).
 *
 * @param {import('nostr-tools').Filter} filter
 * @returns {import('nostr-tools').Filter}
 */
export function applyCuratedFilter(filter) {
  // Don't override explicit author filtering
  if (filter.authors && filter.authors.length > 0) return filter;

  const kind = filter.kinds?.[0];
  if (kind === undefined) return filter;

  const category = kindToAppRelayCategory(kind);
  if (!category) return filter;

  const authors = getCuratedAuthors(category);
  if (!authors) return filter;

  return { ...filter, authors };
}

/**
 * Check if a pubkey is in the curated authors list for a category.
 * Returns true if curated mode is not active for the category (all authors allowed).
 * @param {string} category
 * @param {string} pubkey
 * @returns {boolean}
 */
export function isAllowedAuthor(category, pubkey) {
  const authors = getCuratedAuthors(category);
  if (!authors) return true;
  return authors.includes(pubkey);
}

/**
 * Decode naddr identifiers into address pointers.
 * Skips invalid identifiers with a warning.
 * @param {string[]} naddrs
 * @returns {Array<{pubkey: string, identifier: string, relays: string[]}>}
 */
export function decodeNaddrs(naddrs) {
  /** @type {Array<{pubkey: string, identifier: string, relays: string[]}>} */
  const pointers = [];

  for (const naddr of naddrs) {
    try {
      const decoded = nip19.decode(naddr.trim());
      if (decoded.type !== 'naddr') {
        console.warn('Curated authors: Expected naddr, got', decoded.type, 'for', naddr);
        continue;
      }
      const data = /** @type {import('nostr-tools/nip19').AddressPointer} */ (decoded.data);
      if (data.kind !== 30000) {
        console.warn('Curated authors: Expected kind 30000, got', data.kind, 'for', naddr);
        continue;
      }
      pointers.push({
        pubkey: data.pubkey,
        identifier: data.identifier,
        relays: data.relays || []
      });
    } catch (err) {
      console.warn('Curated authors: Failed to decode naddr:', naddr, err);
    }
  }

  return pointers;
}

/**
 * Extract unique p-tag pubkeys from kind 30000 events.
 * @param {import('nostr-tools').Event[]} events
 * @returns {string[]}
 */
export function extractPubkeysFromFollowSets(events) {
  /** @type {string[]} */
  const pubkeys = [];
  for (const event of events) {
    for (const tag of event.tags) {
      if (tag[0] === 'p' && tag[1] && !pubkeys.includes(tag[1])) {
        pubkeys.push(tag[1]);
      }
    }
  }
  return pubkeys;
}

/**
 * Initialize curated authors for a specific category.
 * Parses direct pubkeys and fetches follow sets from network.
 * Safe to call multiple times — subsequent calls are no-ops.
 * @param {string} category
 */
export async function initializeCuratedAuthors(category) {
  if (followSetsInitialized.has(category)) return;
  if (!isCuratedModeConfigured(category)) return;

  followSetsInitialized.add(category);

  // Step 1: Ensure direct pubkeys are parsed
  ensureDirectPubkeysInitialized(category);
  const directPubkeys = curatedAuthorsCache.get(category) ?? [];

  // Step 2: Fetch follow sets
  const { sets } = getCategoryConfig(category);
  const pointers = decodeNaddrs(sets);

  if (pointers.length === 0) {
    if (directPubkeys.length === 0) {
      console.warn(`Curated authors [${category}]: No valid entries found`);
    }
    return;
  }

  try {
    const fallbackRelays = getAllLookupRelays();
    /** @type {import('nostr-tools').Event[]} */
    const allEvents = [];

    for (const pointer of pointers) {
      const relays = pointer.relays.length > 0 ? pointer.relays : fallbackRelays;
      const filter = {
        kinds: [30000],
        authors: [pointer.pubkey],
        '#d': [pointer.identifier]
      };

      try {
        const events = await lastValueFrom(
          pool.request(relays, filter, /** @type {any} */ ({ timeout: 5000 })).pipe(toArray())
        );
        allEvents.push(...events);
      } catch (err) {
        console.warn(
          `Curated authors [${category}]: Failed to fetch follow set for`,
          pointer.identifier,
          err
        );
      }
    }

    const followSetPubkeys = extractPubkeysFromFollowSets(allEvents);

    // Union direct + follow set pubkeys (deduplicated)
    const allPubkeys = [...directPubkeys, ...followSetPubkeys].filter(
      (pk, i, arr) => arr.indexOf(pk) === i
    );

    if (allPubkeys.length > 0) {
      curatedAuthorsCache.set(category, allPubkeys);
      curatedCacheVersion++;
    } else {
      console.warn(`Curated authors [${category}]: No pubkeys found, curated mode inactive`);
    }
  } catch (err) {
    console.error(`Curated authors [${category}]: Initialization failed`, err);
  }
}

/**
 * Read cache once and share between curated + WoT init (avoid double JSON.parse).
 * @type {CachedAuthorsData | null | undefined} undefined = not yet read
 */
let _sharedCachedData;

/**
 * Get the shared cached data (reads localStorage at most once per session).
 * @returns {CachedAuthorsData | null}
 */
function getSharedCachedData() {
  if (_sharedCachedData === undefined) {
    _sharedCachedData = browser ? loadCachedAuthors() : null;
  }
  return _sharedCachedData;
}

/**
 * Initialize curated authors for all categories in parallel.
 * Uses localStorage cache for instant startup on repeat visits,
 * then refreshes from relays in the background.
 */
export async function initializeAllCuratedAuthors() {
  const cached = getSharedCachedData();
  if (cached && Object.keys(cached.curated).length > 0) {
    // Populate in-memory caches from localStorage (instant)
    for (const [cat, pubkeys] of Object.entries(cached.curated)) {
      if (!curatedAuthorsCache.has(cat) && pubkeys.length > 0) {
        curatedAuthorsCache.set(cat, pubkeys);
        directPubkeysInitialized.add(cat);
        followSetsInitialized.add(cat);
      }
    }
    curatedCacheVersion++;
    // Background refresh — don't await, just fire
    _refreshAllCuratedAuthors();
    return;
  }
  await Promise.all(ALL_CATEGORIES.map((cat) => initializeCuratedAuthors(cat)));
  if (browser) saveCachedAuthors(curatedAuthorsCache, wotAuthorsCache);
}

/**
 * Background refresh: re-fetch from relays and update cache.
 * Resets initialization guards so categories are re-fetched.
 */
async function _refreshAllCuratedAuthors() {
  for (const cat of ALL_CATEGORIES) {
    directPubkeysInitialized.delete(cat);
    followSetsInitialized.delete(cat);
  }
  await Promise.all(ALL_CATEGORIES.map((cat) => initializeCuratedAuthors(cat)));
  if (browser) saveCachedAuthors(curatedAuthorsCache, wotAuthorsCache);
}

// --- WoT initialization ---

/**
 * Get the WoT config for a category from runtime config.
 * @param {string} category
 * @returns {{ anchors: string[] }}
 */
function getWotCategoryConfig(category) {
  const cfg = /** @type {Record<string, {anchors: string[]}>} */ (
    /** @type {unknown} */ (runtimeConfig.wotMode)
  )?.[category];
  return {
    anchors: Array.isArray(cfg?.anchors) ? cfg.anchors : []
  };
}

/**
 * Initialize WoT authors for a specific category.
 * Fetches kind 3 (contact list) events for anchor pubkeys and extracts their follows.
 * Safe to call multiple times — subsequent calls are no-ops.
 * @param {string} category
 */
export async function initializeWotAuthors(category) {
  if (wotInitialized.has(category)) return;
  if (!runtimeConfig.wotMode?.enabled) return;

  const { anchors: rawAnchors } = getWotCategoryConfig(category);
  if (rawAnchors.length === 0) return;

  wotInitialized.add(category);

  const anchorPubkeys = parseDirectPubkeys(rawAnchors);
  if (anchorPubkeys.length === 0) return;

  try {
    const relays = getAllLookupRelays();
    const filter = { kinds: [3], authors: anchorPubkeys };

    const events = await lastValueFrom(
      pool.request(relays, filter, /** @type {any} */ ({ timeout: 5000 })).pipe(toArray())
    );

    // Extract p-tags from kind 3 events (reuse existing function)
    const followPubkeys = extractPubkeysFromFollowSets(events);

    // Union anchor pubkeys + their follows (deduplicated)
    const allPubkeys = [...anchorPubkeys, ...followPubkeys].filter(
      (pk, i, arr) => arr.indexOf(pk) === i
    );

    if (allPubkeys.length > 0) {
      wotAuthorsCache.set(category, allPubkeys);
      curatedCacheVersion++;
    }
  } catch (err) {
    console.error(`WoT authors [${category}]: Initialization failed`, err);
  }
}

/**
 * Initialize WoT authors for all categories in parallel.
 * Uses localStorage cache for instant startup, refreshes in background.
 */
export async function initializeAllWotAuthors() {
  if (!runtimeConfig.wotMode?.enabled) return;

  const cached = getSharedCachedData();
  if (cached && Object.keys(cached.wot).length > 0) {
    for (const [cat, pubkeys] of Object.entries(cached.wot)) {
      if (!wotAuthorsCache.has(cat) && pubkeys.length > 0) {
        wotAuthorsCache.set(cat, pubkeys);
        wotInitialized.add(cat);
      }
    }
    curatedCacheVersion++;
    // Background refresh
    _refreshAllWotAuthors();
    return;
  }
  await Promise.all(ALL_CATEGORIES.map((cat) => initializeWotAuthors(cat)));
  if (browser) saveCachedAuthors(curatedAuthorsCache, wotAuthorsCache);
}

/**
 * Background refresh for WoT authors.
 */
async function _refreshAllWotAuthors() {
  for (const cat of ALL_CATEGORIES) {
    wotInitialized.delete(cat);
  }
  await Promise.all(ALL_CATEGORIES.map((cat) => initializeWotAuthors(cat)));
  if (browser) saveCachedAuthors(curatedAuthorsCache, wotAuthorsCache);
}

/**
 * Set the logged-in user's follow pubkeys (called on login).
 * These are included in the author union when wotMode.includeUserFollows is true.
 * @param {string[]} pubkeys - Hex pubkeys from user's kind 3 contact list
 */
export function setUserFollows(pubkeys) {
  userFollowPubkeys = pubkeys;
  curatedCacheVersion++;
}

/**
 * Clear user follows (called on logout).
 */
export function clearUserFollows() {
  userFollowPubkeys = [];
  curatedCacheVersion++;
}

/**
 * Set the active user's pubkey (called on login).
 * Always included in curated author filters regardless of WoT config.
 * @param {string} pubkey - Hex pubkey of the logged-in user
 */
export function setActiveUserPubkey(pubkey) {
  activeUserPubkey = pubkey;
  curatedCacheVersion++;
}

/**
 * Clear the active user's pubkey (called on logout).
 */
export function clearActiveUserPubkey() {
  activeUserPubkey = '';
  curatedCacheVersion++;
}

/**
 * Reset curated authors state (for testing).
 * @param {string} [category] - If provided, reset only that category. Otherwise reset all.
 */
export function _resetForTesting(category) {
  if (category) {
    curatedAuthorsCache.delete(category);
    directPubkeysInitialized.delete(category);
    followSetsInitialized.delete(category);
    wotAuthorsCache.delete(category);
    wotInitialized.delete(category);
    curatedCacheVersion++;
  } else {
    curatedAuthorsCache.clear();
    directPubkeysInitialized.clear();
    followSetsInitialized.clear();
    wotAuthorsCache.clear();
    wotInitialized.clear();
    userFollowPubkeys = [];
    activeUserPubkey = '';
    _sharedCachedData = undefined;
    curatedCacheVersion = 0;
  }
}
