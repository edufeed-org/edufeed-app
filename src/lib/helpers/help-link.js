/**
 * Anchor attributes for the configured help / user-guide link
 * (`runtimeConfig.help.url`, env `HELP_URL`).
 *
 * In-app paths (the default `/wiki/edufeed-erste-schritte`) stay same-tab
 * links; absolute URLs open in a new tab. `null` when no guide is configured
 * so callers can hide the link entirely.
 *
 * @param {string | null | undefined} url
 * @returns {{ href: string, target?: '_blank', rel?: string } | null}
 */
export function helpLinkAttrs(url) {
  if (!url) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return { href: url, target: '_blank', rel: 'noopener noreferrer' };
  }
  return { href: url };
}

/**
 * Like {@link helpLinkAttrs}, but pointing at one section of the guide: the
 * `anchor` (a heading id, e.g. `was-bedeutet-verifiziert`) replaces any
 * fragment the configured url already carries. A deployment with its own
 * guide may lack the section; the browser then simply opens the page top.
 *
 * @param {string | null | undefined} url
 * @param {string} anchor
 * @returns {{ href: string, target?: '_blank', rel?: string } | null}
 */
export function helpSectionLinkAttrs(url, anchor) {
  const attrs = helpLinkAttrs(url);
  if (!attrs) return null;
  return { ...attrs, href: `${attrs.href.split('#')[0]}#${anchor}` };
}
