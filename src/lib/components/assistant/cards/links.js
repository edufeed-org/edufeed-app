/**
 * Links for Termi's result cards. Item fields come from tool results
 * (untrusted): in-app paths ('/…', never protocol-relative '//host') stay in
 * the tab, http(s) URLs open in a new tab, everything else gives no link.
 */

/** @typedef {{ href: string, target?: string, rel?: string }} CardLink */

/** @param {unknown} u @returns {CardLink | undefined} */
export function externalLink(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u)
    ? { href: u, target: '_blank', rel: 'noopener noreferrer' }
    : undefined;
}

/**
 * The card's primary link: `href` if in-app, else the first external one of
 * `href`/`sourceUrl` (passages carry their external URL in `href`).
 * @param {{ href?: string, sourceUrl?: string }} item
 * @returns {CardLink | undefined}
 */
export function linkFor(item) {
  if (item.href?.startsWith('/') && !item.href.startsWith('//')) return { href: item.href };
  return externalLink(item.href) ?? externalLink(item.sourceUrl);
}
