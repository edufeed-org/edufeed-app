/**
 * Client-side gate for app-derived PDF thumbnails (issue #24).
 *
 * Thumbnails are an app concern (rendered + cached by /api/pdf-thumbnail),
 * never stored on the user's event. The gate implements the rights policy:
 * derive a preview only when the resource's license affirmatively allows it
 * (open license) or the file is an attested Blossom upload (the uploader
 * declared a license via the kind-1063 flow when uploading the full file).
 */

/** License URL prefixes considered open enough for derived previews. */
const OPEN_LICENSE_PATTERNS = [
  'https://creativecommons.org/licenses/',
  'https://creativecommons.org/publicdomain/',
  'http://creativecommons.org/licenses/',
  'http://creativecommons.org/publicdomain/'
];

/**
 * @param {string | undefined | null} licenseUrl
 * @returns {boolean}
 */
export function isOpenLicense(licenseUrl) {
  if (!licenseUrl) return false;
  return OPEN_LICENSE_PATTERNS.some((prefix) => licenseUrl.startsWith(prefix));
}

/**
 * First PDF encoding url from the flattened encoding:* tags, or null.
 * PDF detection: matching encodingFormat (positional pairing, same as
 * getAMBEncodings) or a .pdf url extension.
 *
 * @param {string[][] | undefined} tags
 * @returns {string | null}
 */
export function getThumbnailSourceUrl(tags) {
  const urls = (tags ?? []).filter((t) => t[0] === 'encoding:contentUrl').map((t) => t[1]);
  const formats = (tags ?? []).filter((t) => t[0] === 'encoding:encodingFormat').map((t) => t[1]);
  for (let i = 0; i < urls.length; i++) {
    const isPdf = formats[i] === 'application/pdf' || /\.pdf(\?|#|$)/i.test(urls[i] ?? '');
    if (isPdf && urls[i]) return urls[i];
  }
  return null;
}

/**
 * Whether the app may derive a page-1 thumbnail for this resource.
 *
 * @param {string[][] | undefined} tags - event tags (kind 30142 / 30040)
 * @returns {boolean}
 */
export function canDeriveThumbnail(tags) {
  const url = getThumbnailSourceUrl(tags);
  if (!url) return false;
  const license = (tags ?? []).find((t) => t[0] === 'license:id')?.[1];
  if (isOpenLicense(license)) return true;
  // Attested Blossom upload: the encoding carries a sha256 from the upload flow
  const hasSha = (tags ?? []).some((t) => t[0] === 'encoding:sha256' && t[1]);
  return hasSha;
}

/**
 * Endpoint URL for the app-side thumbnail of a PDF.
 * @param {string} pdfUrl
 * @returns {string}
 */
export function pdfThumbnailEndpoint(pdfUrl) {
  return `/api/pdf-thumbnail?url=${encodeURIComponent(pdfUrl)}`;
}

/**
 * Endpoint URL for the app-side page count of a PDF (#57).
 *
 * Gated by the same `canDeriveThumbnail` policy: reading the page count means
 * fetching the file, which is the same act the thumbnail gate exists to
 * authorise.
 *
 * @param {string} pdfUrl
 * @returns {string}
 */
export function pdfInfoEndpoint(pdfUrl) {
  return `/api/pdf-info?url=${encodeURIComponent(pdfUrl)}`;
}
