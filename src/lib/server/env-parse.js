/**
 * Parsers for environment-variable values, shared by the /api/config and
 * /api/agent-config endpoints. They live here because a `+server.js` file may
 * only export route handlers (see route-server-exports.test.js).
 */

/**
 * Parse comma-separated string into array
 * @param {string | undefined} value
 * @param {string[]} defaultValue
 * @returns {string[]}
 */
export function parseArray(value, defaultValue = []) {
  if (!value) return defaultValue;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse boolean with default
 * @param {string | undefined} value
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
export function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return value === 'true' || value === '1';
}

/**
 * Resolve curated mode config for a specific category.
 * If either category-specific env var is set, use ONLY category vars (complete replacement).
 * Otherwise fall back to global vars.
 * @param {Record<string, string|undefined>} env
 * @param {string} suffix - Category suffix, e.g. 'CALENDAR'
 * @returns {{ sets: string[], direct: string[] }}
 */
export function resolveCuratedConfig(env, suffix) {
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
export function resolveWotConfig(env, suffix) {
  const catAnchors = env[`WOT_ANCHOR_PUBKEYS_${suffix}`];
  if (catAnchors !== undefined && catAnchors.trim() !== '') {
    return { anchors: parseArray(catAnchors) };
  }
  return { anchors: parseArray(env.WOT_ANCHOR_PUBKEYS) };
}
