/**
 * Moves SvelteKit's modulepreload hints from the `Link` response header into
 * the HTML head.
 *
 * For SSR (non-prerendered) pages SvelteKit 2.x advertises every module of the
 * route's static import graph ONLY via the `Link` header — the
 * `<link rel="modulepreload">` head tags are emitted for prerendered pages
 * alone. On `/` that is ~290 entries / ~20KB, which exceeds Node's 16KB default
 * header limit (it broke the CI probe and the Docker healthcheck for a month)
 * and any other conservative HTTP client. Browsers do act on it, so simply
 * dropping the header would cost the parallel module fetch.
 *
 * This hook rewrites successful HTML responses: the modulepreload entries are
 * re-emitted as head tags (the form every modern browser honours, header
 * support being Chromium-only) and the header keeps just the handful of
 * stylesheet/font preloads. Same preloading, tiny header.
 */

/** Matches one `<url>; param; param` entry of a `Link` header. */
const LINK_ENTRY_RE = /<([^>]*)>([^<]*)/g;

/**
 * @param {string | null | undefined} value Raw `Link` header value.
 * @returns {{ modulePaths: string[], remaining: string | null }} Modulepreload
 *   URLs in header order, plus the header with those entries removed (null
 *   when nothing is left).
 */
export function splitModulepreloadLinks(value) {
  /** @type {string[]} */
  const modulePaths = [];
  /** @type {string[]} */
  const kept = [];
  for (const [, url, params] of (value ?? '').matchAll(LINK_ENTRY_RE)) {
    if (/rel="?modulepreload"?/i.test(params)) modulePaths.push(url);
    else kept.push(`<${url}>${params.replace(/,\s*$/, '').trimEnd()}`);
  }
  return { modulePaths, remaining: kept.length ? kept.join(', ') : null };
}

/** @param {string} value */
const escapeAttr = (value) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * @param {string[]} paths
 * @returns {string} `<link rel="modulepreload">` tags, one per path.
 */
export function renderModulepreloadTags(paths) {
  return paths.map((path) => `<link rel="modulepreload" href="${escapeAttr(path)}">`).join('');
}

/**
 * SvelteKit handle hook; see the module comment. Position in `sequence()` is
 * irrelevant — it only post-processes the resolved response.
 * @type {import('@sveltejs/kit').Handle}
 */
export async function preloadLinksHandle({ event, resolve }) {
  const response = await resolve(event);
  const link = response.headers.get('link');
  if (
    !link?.includes('modulepreload') ||
    response.status !== 200 ||
    !response.headers.get('content-type')?.startsWith('text/html')
  ) {
    return response;
  }

  const { modulePaths, remaining } = splitModulepreloadLinks(link);
  if (modulePaths.length === 0) return response;

  const tags = renderModulepreloadTags(modulePaths);
  const html = await response.text();
  const headers = new Headers(response.headers);
  // The body grows; let the adapter recompute the length.
  headers.delete('content-length');
  if (remaining === null) headers.delete('link');
  else headers.set('link', remaining);

  return new Response(
    // Replacer function, not a string: `$&`-style patterns in the tags would
    // otherwise be interpreted (see ogMetaHandle).
    html.replace('</head>', () => `${tags}</head>`),
    { status: response.status, statusText: response.statusText, headers }
  );
}
