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

  // CC Public Domain Mark (emitted by Openverse/Wikimedia for PD works)
  if (/creativecommons\.org\/publicdomain\/mark\/1\.0/i.test(trimmed)) {
    return 'Public Domain';
  }

  // Unsplash
  if (/unsplash\.com\/license/i.test(trimmed)) {
    return 'Unsplash License';
  }

  // Pixabay
  if (/pixabay\.com\/service\/license/i.test(trimmed)) {
    return 'Pixabay License';
  }

  // Canva
  if (/canva\.com\/policies\/content-license/i.test(trimmed)) {
    return 'Canva Content License';
  }

  // Urheberrechtlich geschützt (all rights reserved / German copyright)
  if (/wikipedia\.org\/wiki\/Urheberrecht/i.test(trimmed)) {
    return 'Urheberrechtlich geschützt';
  }

  // MIT (legacy — kept for back-compat with previously-published events)
  if (/opensource\.org\/licenses?\/MIT/i.test(trimmed)) {
    return 'MIT License';
  }

  // DINI AG KIM license-type concept (a single term; see formatLicenseIds for
  // the composition of several license:id tags).
  if (parseKimTerm(trimmed)) {
    return composeKimLabel([trimmed]) ?? url;
  }

  const free = formatFreeLicense(trimmed);
  if (free) return free;

  // CC license: /licenses/{suffix}/{version}[/{jurisdiction}]
  const ccMatch = trimmed.match(
    /creativecommons\.org\/licenses\/([a-z-]+)\/(\d+\.\d+)(?:\/([a-z]{2,3}))?(?:\/|$)/i
  );
  if (ccMatch) {
    const [, suffix, version, jurisdiction] = ccMatch;
    const upperSuffix = suffix.toUpperCase(); // by-nc-sa → BY-NC-SA
    const base = `CC ${upperSuffix} ${version}`;
    return jurisdiction ? `${base} ${jurisdiction.toUpperCase()}` : base;
  }

  return url;
}

/** DINI AG KIM license-type vocabulary (https://w3id.org/kim/license/). */
const KIM_TERMS = Object.freeze({
  publicdomain: 'publicDomain',
  attribution: 'attribution',
  sharealike: 'shareAlike',
  noderivatives: 'noDerivatives',
  noncommercial: 'nonCommercial',
  'noncommercial-noderivatives': 'nonCommercial-noDerivatives',
  nolicense: 'noLicense'
});

/**
 * Canonical KIM term of a license URI, or null when it is not a known KIM
 * license-type concept (terms compared case-insensitively).
 * @param {string} url
 * @returns {string | null}
 */
export function parseKimTerm(url) {
  const m = String(url ?? '')
    .trim()
    .match(/^https?:\/\/w3id\.org\/kim\/license\/([A-Za-z-]+)\/?$/i);
  if (!m) return null;
  return KIM_TERMS[/** @type {keyof typeof KIM_TERMS} */ (m[1].toLowerCase())] ?? null;
}

/**
 * Label for a set of KIM license-type concepts (classification contract rule
 * 2): attribution is implied (CC ≥ 4.0 is always BY); nc/nd/sa compose the CC
 * variant. KIM types carry no version, so neither does the label.
 * Returns null for a contradictory set (sa + nd, publicDomain mixed with
 * anything else) or when no value is a KIM concept.
 *
 * @param {string[]} urls
 * @returns {string | null}
 */
export function composeKimLabel(urls) {
  const terms = new Set(urls.map(parseKimTerm).filter(Boolean));
  if (terms.size === 0) return null;
  if (terms.has('noLicense')) return 'Keine Lizenz';
  if (terms.has('publicDomain')) return terms.size === 1 ? 'Public Domain (KIM)' : null;
  const nc = terms.has('nonCommercial') || terms.has('nonCommercial-noDerivatives');
  const nd = terms.has('noDerivatives') || terms.has('nonCommercial-noDerivatives');
  const sa = terms.has('shareAlike');
  if (sa && nd) return null;
  return `CC BY${nc ? '-NC' : ''}${sa ? '-SA' : ''}${nd ? '-ND' : ''} (KIM)`;
}

/**
 * Free software / documentation licences (classification contract rule 3).
 * @param {string} url - already stripped of trailing slashes
 * @returns {string | null}
 */
function formatFreeLicense(url) {
  const u = url
    .replace(/(-standalone)?\.(html|txt)$/i, '')
    .replace(/\/+$/, '')
    .replace(/\/(legalcode|deed)[^/]*$/i, '');
  const gnu = u.match(
    /^https?:\/\/(?:www\.)?gnu\.org\/licenses\/(gpl|lgpl|agpl|fdl)-(\d+(?:\.\d+)*)$/i
  );
  if (gnu) {
    const family = gnu[1].toLowerCase() === 'fdl' ? 'GFDL' : gnu[1].toUpperCase();
    return `${family}-${gnu[2]}`;
  }
  if (/^https?:\/\/(?:www\.)?apache\.org\/licenses\/license-2\.0$/i.test(u)) return 'Apache-2.0';
  const bsd = u.match(/^https?:\/\/(?:www\.)?opensource\.org\/licenses?\/bsd-([23])-clause$/i);
  if (bsd) return `BSD-${bsd[1]}-Clause`;
  const spdx = u.match(/^https?:\/\/(?:www\.)?spdx\.org\/licenses\/([A-Za-z0-9.+-]+)$/);
  if (spdx && /^(A?GPL-|LGPL-|GFDL-|MIT$|Apache-2\.0$|BSD-[23]-Clause$)/i.test(spdx[1])) {
    return spdx[1];
  }
  return null;
}

/** @param {string} url */
function isCcUri(url) {
  return /^https?:\/\/(?:www\.)?creativecommons\.org\/(licenses|publicdomain)\//i.test(url.trim());
}

/**
 * Classify ALL `license:id` values of a resource (tag order) into the one
 * license the UI shows — same rules as the search backend's classification
 * contract:
 *   1. the first Creative Commons / Public Domain URI decides;
 *   2. else the KIM license-type concepts compose a CC variant
 *      ("CC BY-SA (KIM)"); contradictory sets fall back to the raw first URI;
 *   3. else the first value with a known label, else the raw first value.
 * `id` is the URI the UI links to: the deciding value (for KIM, the first
 * KIM concept — the app links license URIs as given, never CC deeds).
 *
 * @param {string[]} urls
 * @returns {{ id: string, label: string } | null}
 */
export function formatLicenseIds(urls) {
  const ids = (urls ?? []).map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean);
  if (ids.length === 0) return null;

  const cc = ids.find(isCcUri);
  if (cc) return { id: cc, label: formatLicenseUrl(cc) };

  const kim = ids.find((u) => parseKimTerm(u));
  if (kim) return { id: kim, label: composeKimLabel(ids) ?? kim };

  const known = ids.find((u) => formatLicenseUrl(u) !== u);
  const id = known ?? ids[0];
  return { id, label: formatLicenseUrl(id) };
}
