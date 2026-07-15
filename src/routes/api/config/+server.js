/**
 * Public Configuration API Endpoint
 * This endpoint serves runtime configuration to the client.
 * Only non-sensitive configuration should be exposed here.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/**
 * Parse comma-separated string into array
 * @param {string | undefined} value
 * @param {string[]} defaultValue
 * @returns {string[]}
 */
function parseArray(value, defaultValue = []) {
  if (!value) return defaultValue;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse integer with default
 * @param {string | undefined} value
 * @param {number} defaultValue
 * @returns {number}
 */
function parseInt(value, defaultValue) {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse boolean with default
 * @param {string | undefined} value
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return value === 'true' || value === '1';
}

/**
 * Parse JSON string with default
 * @template T
 * @param {string | undefined} value
 * @param {T} defaultValue
 * @returns {T}
 */
function parseJSON(value, defaultValue) {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}

/**
 * Parse funding config with backward compatibility.
 * New format: IMPRINT_FUNDING as JSON array of {image, text}.
 * Old format: IMPRINT_FUNDING_IMAGE + IMPRINT_FUNDING_TEXT as single entry.
 * @param {Record<string, string|undefined>} env
 * @returns {Array<{image: string, text: string}>}
 */
function parseFunding(env) {
  if (env.IMPRINT_FUNDING) {
    return parseJSON(env.IMPRINT_FUNDING, []);
  }
  // Backward compat: wrap old single-entry vars into an array
  if (env.IMPRINT_FUNDING_IMAGE || env.IMPRINT_FUNDING_TEXT) {
    return [{ image: env.IMPRINT_FUNDING_IMAGE || '', text: env.IMPRINT_FUNDING_TEXT || '' }];
  }
  return [];
}

/**
 * Parse theme value
 * @param {string | undefined} value
 * @param {'light' | 'dark' | 'stil' | 'stil-dark' | 'rpi' | 'rpi-dark'} defaultValue
 * @returns {'light' | 'dark' | 'stil' | 'stil-dark' | 'rpi' | 'rpi-dark'}
 */
function parseTheme(value, defaultValue) {
  if (!value) return defaultValue;
  const normalized = value.toLowerCase();
  if (
    normalized === 'light' ||
    normalized === 'dark' ||
    normalized === 'stil' ||
    normalized === 'stil-dark' ||
    normalized === 'rpi' ||
    normalized === 'rpi-dark'
  ) {
    return normalized;
  }
  return defaultValue;
}

/**
 * Resolve curated mode config for a specific category.
 * If either category-specific env var is set, use ONLY category vars (complete replacement).
 * Otherwise fall back to global vars.
 * @param {Record<string, string|undefined>} env
 * @param {string} suffix - Category suffix, e.g. 'CALENDAR'
 * @returns {{ sets: string[], direct: string[] }}
 */
function resolveCuratedConfig(env, suffix) {
  const catSets = env[`CURATED_PUBKEYS_SETS_${suffix}`];
  const catDirect = env[`CURATED_PUBKEYS_${suffix}`];

  // If either category-specific var is defined and non-empty, use category vars exclusively
  const hasCategorySets = catSets !== undefined && catSets.trim() !== '';
  const hasCategoryDirect = catDirect !== undefined && catDirect.trim() !== '';
  if (hasCategorySets || hasCategoryDirect) {
    return {
      sets: parseArray(catSets),
      direct: parseArray(catDirect)
    };
  }

  // Fall back to global vars
  return {
    sets: parseArray(env.CURATED_PUBKEYS_SETS),
    direct: parseArray(env.CURATED_PUBKEYS)
  };
}

/**
 * Resolve WoT anchor config for a specific category.
 * Category-specific var overrides global; falls back to global WOT_ANCHOR_PUBKEYS.
 * @param {Record<string, string|undefined>} env
 * @param {string} suffix - Category suffix, e.g. 'EDUCATIONAL'
 * @returns {{ anchors: string[] }}
 */
function resolveWotConfig(env, suffix) {
  const catAnchors = env[`WOT_ANCHOR_PUBKEYS_${suffix}`];
  if (catAnchors !== undefined && catAnchors.trim() !== '') {
    return { anchors: parseArray(catAnchors) };
  }
  return { anchors: parseArray(env.WOT_ANCHOR_PUBKEYS) };
}

/**
 * GET /api/config
 * Returns public configuration that can be safely exposed to the browser
 */
export function GET() {
  const config = {
    // App branding
    appName: env.APP_NAME || 'Edufeed',
    appLogo:
      env.APP_LOGO ||
      'https://blossom.edufeed.org/f22e1410f09a9130757704b6dcd4c34774d2926b9cfd6cf2e4c4675c64d4333b.webp',
    gitRepo: env.APP_GIT_REPO || 'https://github.com/edufeed-org/edufeed-app',
    clientName: env.CLIENT_NAME || env.APP_NAME || 'Edufeed',

    // Relays - Fallback for users without kind 10002
    fallbackRelays: parseArray(env.FALLBACK_RELAYS),

    // NIP-17 DM relays (kind 10050) published as a default for new users
    dmRelays: parseArray(env.DM_RELAYS),

    // App-specific relays (content goes here IN ADDITION to user's outbox)
    calendarRelays: parseArray(env.CALENDAR_RELAYS),
    communikeyRelays: parseArray(env.COMMUNIKEY_RELAYS),
    ambRelays: parseArray(env.AMB_RELAYS),
    longformContentRelays: parseArray(env.LONGFORM_CONTENT_RELAY),
    kanbanRelays: parseArray(env.KANBAN_RELAYS),

    // Dashboard relay feed picker (see relay-feed-options.svelte.js).
    // relaySources tokens: config | custom | nip65 | community
    feed: {
      relays: parseArray(env.FEED_RELAYS),
      relaySources: parseArray(env.FEED_RELAY_SOURCES, ['config', 'custom'])
    },

    // Gated mode configuration
    gatedMode: {
      default: parseBool(env.GATED_MODE_DEFAULT, false),
      force: parseBool(env.GATED_MODE_FORCE, false)
    },

    // Curated mode: per-category author filtering with global fallback
    curatedMode: {
      calendar: resolveCuratedConfig(env, 'CALENDAR'),
      communikey: resolveCuratedConfig(env, 'COMMUNIKEY'),
      educational: resolveCuratedConfig(env, 'EDUCATIONAL'),
      longform: resolveCuratedConfig(env, 'LONGFORM'),
      kanban: resolveCuratedConfig(env, 'KANBAN')
    },

    // WoT mode: include follows of anchor pubkeys as allowed authors
    wotMode: {
      enabled: parseBool(env.WOT_ENABLED, false),
      includeUserFollows: parseBool(env.WOT_INCLUDE_USER_FOLLOWS, true),
      calendar: resolveWotConfig(env, 'CALENDAR'),
      communikey: resolveWotConfig(env, 'COMMUNIKEY'),
      educational: resolveWotConfig(env, 'EDUCATIONAL'),
      longform: resolveWotConfig(env, 'LONGFORM'),
      kanban: resolveWotConfig(env, 'KANBAN')
    },

    // NIP-65 relay list discovery
    relayListLookupRelays: parseArray(env.RELAY_LIST_LOOKUP_RELAYS),

    // Profile indexer relays for bulk profile lookups
    indexerRelays: parseArray(env.INDEXER_RELAYS),

    // Default Blossom servers
    defaultBlossomServers: parseArray(env.DEFAULT_BLOSSOM_SERVERS, [
      'https://blossom.primal.net',
      'https://cdn.satellite.earth'
    ]),

    // Calendar
    calendar: {
      weekStartDay: parseInt(env.CALENDAR_WEEK_START_DAY, 1),
      locale: env.CALENDAR_LOCALE || 'de-DE',
      timeFormat: env.CALENDAR_TIME_FORMAT || '24h',
      featuredAuthors: parseArray(env.CALENDAR_FEATURED_AUTHORS)
    },

    // Signup
    signup: {
      // Communities (npub or hex) pre-checked in the signup step-3 community picker.
      // Users can untick or skip; empty = no defaults. See SignupModal.
      suggestedCommunities: parseArray(env.SIGNUP_SUGGESTED_COMMUNITIES)
    },

    // Blossom (media uploads)
    blossom: {
      maxFileSize: parseInt(env.BLOSSOM_MAX_FILE_SIZE, 5 * 1024 * 1024) // 5MB default
    },

    // Geocoding (public settings only - API key stays on server)
    geocoding: {
      // Note: API key is NOT exposed here - it stays server-side
      cacheDurationDays: parseInt(env.GEOCODING_CACHE_DURATION_DAYS, 30),
      validation: {
        minAddressLength: parseInt(env.GEOCODING_MIN_ADDRESS_LENGTH, 10),
        minConfidenceScore: parseInt(env.GEOCODING_MIN_CONFIDENCE_SCORE, 5),
        requireAddressComponents: parseBool(env.GEOCODING_REQUIRE_ADDRESS_COMPONENTS, false),
        acceptedComponentTypes: parseArray(env.GEOCODING_ACCEPTED_COMPONENT_TYPES, [
          'road',
          'house',
          'building',
          'retail',
          'commercial',
          'industrial',
          'residential',
          'address',
          'postcode',
          'street',
          'neighbourhood',
          'city',
          'town',
          'village',
          'municipality',
          'county',
          'state',
          'country',
          'amenity',
          'venue',
          'place',
          'locality',
          'university'
        ])
      }
    },

    // Imprint
    imprint: {
      enabled: parseBool(env.IMPRINT_ENABLED, true),
      organization: env.IMPRINT_ORGANIZATION || 'ComCal GbR',
      address: {
        street: env.IMPRINT_ADDRESS_STREET || '',
        postalCode: env.IMPRINT_ADDRESS_POSTAL_CODE || '',
        city: env.IMPRINT_ADDRESS_CITY || '',
        country: env.IMPRINT_ADDRESS_COUNTRY || ''
      },
      contact: {
        email: env.IMPRINT_CONTACT_EMAIL || 'mail@comcal.net',
        phone: env.IMPRINT_CONTACT_PHONE || ''
      },
      representative: env.IMPRINT_REPRESENTATIVE || '',
      registrationNumber: env.IMPRINT_REGISTRATION_NUMBER || '',
      vatId: env.IMPRINT_VAT_ID || '',
      responsibleForContent: env.IMPRINT_RESPONSIBLE_FOR_CONTENT || '',
      funding: parseFunding(env)
    },

    // Footer
    footer: {
      fundingText: env.FOOTER_FUNDING_TEXT || 'gefördert vom BMBFSFJ (FKZ01PZ24007)'
    },

    // Educational content
    educational: {
      searchDebounceMs: parseInt(env.EDUCATIONAL_SEARCH_DEBOUNCE_MS, 300),
      vocabularies: {
        learningResourceType: env.EDUCATIONAL_VOCAB_LEARNING_RESOURCE_TYPE || 'hcrt',
        about: env.EDUCATIONAL_VOCAB_ABOUT || 'hochschulfaechersystematik',
        audience: env.EDUCATIONAL_VOCAB_AUDIENCE || 'intendedEndUserRole'
      },
      // naddr references to kind 39737 ConceptScheme events. Keys match the
      // `SCHEME_NADDR_<UPPER_SNAKE>` env var slugs and are consumed by the
      // AMB wizard's vocab resolver (see `helpers/educational/vocabResolver.js`).
      schemeNaddrs: {
        schulfaecher: env.SCHEME_NADDR_SCHULFAECHER || '',
        hochschulfaecher: env.SCHEME_NADDR_HOCHSCHULFAECHER || '',
        educationalLevel: env.SCHEME_NADDR_EDUCATIONAL_LEVEL || '',
        hcrt: env.SCHEME_NADDR_HCRT || '',
        newLrt: env.SCHEME_NADDR_NEW_LRT || '',
        lrmiAudience: env.SCHEME_NADDR_LRMI_AUDIENCE || '',
        interactivityType: env.SCHEME_NADDR_INTERACTIVITY_TYPE || '',
        conditionsOfAccess: env.SCHEME_NADDR_CONDITIONS_OF_ACCESS || '',
        // EKW vocabularies (kind 39737) — surfaced for the EKW resource form variant.
        klassenstufen: env.SCHEME_NADDR_KLASSENSTUFEN || '',
        schulart: env.SCHEME_NADDR_SCHULART || '',
        ekwFach: env.SCHEME_NADDR_EKW_FACH || '',
        ekwLrt: env.SCHEME_NADDR_EKW_LRT || '',
        didaktischesKonzept: env.SCHEME_NADDR_DIDAKTISCHES_KONZEPT || '',
        methode: env.SCHEME_NADDR_METHODE || '',
        ekwKeywords: env.SCHEME_NADDR_EKW_KEYWORDS || '',
        // Konfi-Arbeit vocabularies (Spec A) — surfaced for the EKW Konfi-Bildungsbereich path.
        landeskirchen: env.SCHEME_NADDR_LANDESKIRCHEN || '',
        konfiZielgruppen: env.SCHEME_NADDR_KONFI_ZIELGRUPPEN || '',
        konfiLernformat: env.SCHEME_NADDR_KONFI_LERNFORMAT || '',
        konfiZeitstruktur: env.SCHEME_NADDR_KONFI_ZEITSTRUKTUR || '',
        konfiBeteiligte: env.SCHEME_NADDR_KONFI_BETEILIGTE || '',
        konfiMethode: env.SCHEME_NADDR_KONFI_METHODE || '',
        konfiMaterialaufwand: env.SCHEME_NADDR_KONFI_MATERIALAUFWAND || '',
        konfiTechnikbedarf: env.SCHEME_NADDR_KONFI_TECHNIKBEDARF || '',
        konfiThemen: env.SCHEME_NADDR_KONFI_THEMEN || '',
        konfiDimensionen: env.SCHEME_NADDR_KONFI_DIMENSIONEN || '',
        konfiLernorte: env.SCHEME_NADDR_KONFI_LERNORTE || ''
      }
    },

    // Resource form variants (AMB vs EKW, etc.)
    // Order in the env var determines picker display order + default variant.
    resourceFormVariants: {
      enabled: parseArray(env.RESOURCE_FORM_VARIANTS, ['amb'])
    },

    // UI settings
    ui: {
      defaultLightTheme: parseTheme(env.THEME_DEFAULT_LIGHT, 'light'),
      defaultDarkTheme: parseTheme(env.THEME_DEFAULT_DARK, 'dark'),
      landingHeroImage: env.LANDING_HERO_IMAGE || '',
      discoverHeroImage: env.DISCOVER_HERO_IMAGE || ''
    },

    // Favicon configuration (allows whitelabel override)
    favicon: {
      ico: env.FAVICON_ICO || '/favicon.ico',
      svg: env.FAVICON_SVG || '/favicon.svg',
      png32: env.FAVICON_32 || '/favicon-32x32.png',
      png16: env.FAVICON_16 || '/favicon-16x16.png'
    },

    // Membership application (NIP-05 handle request flow)
    // All public — the actual NIP-05 service is provisioned manually in v1.
    membership: {
      enabled: parseBool(env.MEMBERSHIP_ENABLED, false),
      handleDomain: env.NIP05_HANDLE_DOMAIN || '',
      formAddress: env.MEMBERSHIP_FORM_ADDRESS || '',
      adminPubkeys: parseArray(env.MEMBERSHIP_ADMIN_PUBKEYS)
    },

    // OER media-library search (proxied via the homelab oer-finder-plugin).
    // Only exposes whether it's enabled — the proxy URL stays server-side.
    oer: {
      enabled: Boolean(env.OER_PROXY_URL)
    },

    // Metadata cleaner (inspect/strip file metadata, compress PDFs before
    // upload). Only exposes whether it's enabled — the URL stays server-side.
    metadataCleaner: {
      enabled: Boolean(env.METADATA_CLEANER_URL)
    }
  };

  return json(config);
}
