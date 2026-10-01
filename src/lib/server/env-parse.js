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
