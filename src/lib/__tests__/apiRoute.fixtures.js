/**
 * Shared fixtures for testing SvelteKit `+server.js` route handlers.
 *
 * Filename uses `.fixtures.js` (not `.test.js`) so vitest's include glob
 * `src/**\/*.test.js` doesn't pick it up as a test file.
 */

/**
 * Build a POST Request with a JSON body for the given route path.
 *
 * @param {string} path  Route path, e.g. `/api/curricula`.
 * @param {Record<string, unknown>} body
 */
export function postJson(path, body) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/**
 * Cast a partial RequestEvent for tests. SvelteKit's full type has many
 * runtime-only fields the route doesn't touch.
 *
 * @param {Request} request
 * @returns {any}
 */
export function ev(request) {
  return { request };
}
