import { formatLicenseUrl } from './licenseLabel.js';

/**
 * Canonical license picker options. Extracted from ResourceFormWizard so the
 * same list is reused by the image-license modal (and any future picker).
 *
 * @type {ReadonlyArray<{ id: string, label: string }>}
 */
export const STATIC_LICENSE_OPTIONS = Object.freeze([
  { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' },
  { id: 'https://creativecommons.org/licenses/by-sa/4.0/', label: 'CC BY-SA 4.0' },
  { id: 'https://creativecommons.org/licenses/by-nc/4.0/', label: 'CC BY-NC 4.0' },
  { id: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', label: 'CC BY-NC-SA 4.0' },
  { id: 'https://creativecommons.org/publicdomain/zero/1.0/', label: 'CC0 (Public Domain)' },
  { id: 'https://opensource.org/licenses/MIT', label: 'MIT License' }
]);

/**
 * Returns the picker options for a license URL. If the URL is outside the
 * static set (e.g. older CC versions, jurisdiction variants emitted by LLM
 * enrichment), appends a synthetic option so the bound value matches a
 * rendered <option>.
 *
 * @param {string} [currentUrl] - The currently-selected license URL.
 * @returns {Array<{ id: string, label: string }>}
 */
export function getLicenseOptions(currentUrl) {
  if (!currentUrl || STATIC_LICENSE_OPTIONS.some((o) => o.id === currentUrl)) {
    return [...STATIC_LICENSE_OPTIONS];
  }
  return [...STATIC_LICENSE_OPTIONS, { id: currentUrl, label: formatLicenseUrl(currentUrl) }];
}
