/**
 * Render a human-friendly label for a license URL.
 *
 * The wizard's static `licenseOptions` only covers the most common CC 4.0
 * variants + CC0 + MIT, but the LLM enrichment path can emit any URL the
 * source page mentions — including older CC versions and German jurisdiction
 * URLs (e.g. `https://creativecommons.org/licenses/by-nc-sa/3.0/de/`).
 *
 * For URLs that don't match a static option the picker dynamically appends
 * a synthetic option using this function so:
 *   1. the dropdown shows a readable label instead of the URL,
 *   2. the bound value still matches an `<option>` so Svelte's `<select>`
 *      doesn't snap back to the first option (which was the source of the
 *      "CC BY 4.0 even when source says CC BY-NC-SA 3.0/de" bug).
 */

/**
 * @param {string} url
 * @returns {string}
 */
export function formatLicenseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.replace(/\/+$/, '');

  // CC0 public domain
  if (/creativecommons\.org\/publicdomain\/zero\/1\.0/i.test(trimmed)) {
    return 'CC0 (Public Domain)';
  }

  // MIT
  if (/opensource\.org\/licenses\/MIT/i.test(trimmed)) {
    return 'MIT License';
  }

  // CC license: /licenses/{suffix}/{version}[/{jurisdiction}]
  const ccMatch = trimmed.match(
    /creativecommons\.org\/licenses\/([a-z-]+)\/(\d+\.\d+)(?:\/([a-z]{2,3}))?/i
  );
  if (ccMatch) {
    const [, suffix, version, jurisdiction] = ccMatch;
    const upperSuffix = suffix.toUpperCase(); // by-nc-sa → BY-NC-SA
    const base = `CC ${upperSuffix} ${version}`;
    return jurisdiction ? `${base} ${jurisdiction.toUpperCase()}` : base;
  }

  return url;
}
