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
