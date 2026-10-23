/**
 * Client-side cleanup of the crawler-facing markup the server injects into
 * content pages (src/lib/server/og.js → buildPageEntry).
 */

/**
 * The server-rendered body is only for clients without JavaScript; the app
 * renders the same content itself.
 * @param {Document} doc
 */
export function removeServerBody(doc) {
  doc.getElementById('geo-content')?.remove();
}

/**
 * Canonical link and JSON-LD describe the page the server rendered. After a
 * client-side navigation they would describe the wrong page.
 * @param {Document} doc
 */
export function removeServerHeadExtras(doc) {
  doc.getElementById('geo-jsonld')?.remove();
  doc.head.querySelector('link[rel="canonical"]')?.remove();
}

/**
 * Whether a navigation left the page the server rendered. Same-path
 * navigations (a route's replaceState on load, hash changes) don't count.
 * @param {{ url: URL } | null | undefined} from
 * @param {{ url: URL } | null | undefined} to
 */
export function leftServerRenderedPage(from, to) {
  return !!from && !!to && from.url.pathname !== to.url.pathname;
}
