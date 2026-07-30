/**
 * What is behind a resource card (issue #57).
 *
 * The hover badge on `AMBResourceCard` used to say only *how many* materials a
 * resource links. This module turns the `encoding:*` and `r` tags already on
 * the event into *what they are* — type and size — with no new data, no format
 * change and no network call.
 *
 * Type detection is mime-first with a filename-extension fallback, matching
 * `EncodingPreview.svelte` and `pdfThumbnailGate.js`. The extension fallback
 * matters more than it looks: the publish path emits
 * `encoding:encodingFormat` only when the uploader knew it, and defaults to
 * `application/octet-stream` when it did not.
 *
 * Page and slide counts are deliberately not here. AMB's `encoding:*` carries
 * no such field, so they cannot be read off the event — see issue #57 for the
 * server-side route.
 */

/**
 * @typedef {'pdf' | 'image' | 'video' | 'audio' | 'presentation' | 'spreadsheet'
 *   | 'document' | 'archive' | 'text' | 'link' | 'file'} MaterialType
 */

/**
 * @typedef {Object} LinkedMaterial
 * @property {'upload' | 'link'} source - an attached file vs. an external reference
 * @property {MaterialType} type
 * @property {number | null} size - bytes, or null when not known *for this item*
 */

/** Exact mime types worth naming. Prefix families are handled separately. */
const TYPE_BY_MIME = /** @type {Record<string, MaterialType>} */ ({
  'application/pdf': 'pdf',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'application/vnd.oasis.opendocument.presentation': 'presentation',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/rtf': 'document',
  'application/zip': 'archive',
  'application/x-7z-compressed': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/vnd.rar': 'archive',
  'application/x-tar': 'archive',
  'application/gzip': 'archive'
});

/** `image/*` and friends — checked after the exact table. */
const TYPE_BY_MIME_PREFIX = /** @type {Array<[string, MaterialType]>} */ ([
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
  ['text/', 'text']
]);

const TYPE_BY_EXTENSION = /** @type {Record<string, MaterialType>} */ ({
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  avif: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  mp3: 'audio',
  ogg: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
  doc: 'document',
  docx: 'document',
  odt: 'document',
  rtf: 'document',
  zip: 'archive',
  '7z': 'archive',
  rar: 'archive',
  tar: 'archive',
  gz: 'archive',
  txt: 'text',
  md: 'text'
});

/**
 * Map a mime type to a material type.
 *
 * Returns null — not `'file'` — for the unknown and for the deliberately
 * generic `application/octet-stream`, so callers can fall back to the filename
 * instead of asserting a type the event never claimed.
 *
 * @param {string | undefined | null} mime
 * @returns {MaterialType | null}
 */
export function materialTypeFromMime(mime) {
  if (!mime || typeof mime !== 'string') return null;
  const normalised = mime.split(';')[0].trim().toLowerCase();
  if (!normalised || normalised === 'application/octet-stream') return null;
  if (TYPE_BY_MIME[normalised]) return TYPE_BY_MIME[normalised];
  for (const [prefix, type] of TYPE_BY_MIME_PREFIX) {
    if (normalised.startsWith(prefix)) return type;
  }
  return null;
}

/**
 * Map a filename or URL to a material type by its extension.
 *
 * Query strings and fragments are stripped first: `?file=report.pdf` and
 * `#section.pdf` are not evidence about the resource being fetched. A dot in a
 * directory segment (`/v1.2/download`) is not an extension either, so only the
 * last path segment is considered.
 *
 * @param {string | undefined | null} nameOrUrl
 * @returns {MaterialType | null}
 */
export function materialTypeFromFilename(nameOrUrl) {
  if (!nameOrUrl || typeof nameOrUrl !== 'string') return null;
  const withoutQuery = nameOrUrl.split('#')[0].split('?')[0];
  const lastSegment = withoutQuery.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0 || dot === lastSegment.length - 1) return null;
  const extension = lastSegment.slice(dot + 1).toLowerCase();
  return TYPE_BY_EXTENSION[extension] ?? null;
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * Format a byte count for display, or null when there is nothing to show.
 *
 * Zero reads as unknown rather than as a real empty file: `getAMBEncodings`
 * and this module both get 0 from a `parseInt` of an absent
 * `encoding:contentSize`, and a card claiming "0 B" would be a lie about the
 * data rather than about the file.
 *
 * @param {number | undefined | null} bytes
 * @param {string} [locale] - BCP-47 tag; drives the decimal separator
 * @returns {string | null}
 */
export function formatMaterialSize(bytes, locale = 'de') {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Bytes and KB are whole numbers; MB and up get one decimal, minus a
  // pointless trailing .0.
  const fractionDigits = unit >= 2 ? 1 : 0;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  }).format(value);
  return `${formatted} ${SIZE_UNITS[unit]}`;
}

/** @param {Array<Array<string>>} tags @param {string} name */
function tagValues(tags, name) {
  return tags
    .filter((t) => Array.isArray(t) && t[0] === name && typeof t[1] === 'string' && t[1] !== '')
    .map((t) => t[1]);
}

/**
 * Describe the material linked from an AMB resource.
 *
 * Counts attached files (`encoding:contentUrl`) and external references (`r`)
 * together, as the badge always has.
 *
 * ## The positional pairing hazard
 *
 * `encoding:contentUrl`, `encoding:encodingFormat` and `encoding:contentSize`
 * are three independent tag lists aligned *by position*, and the optional two
 * are emitted only when known (`publicationTags.js:122-131`). So a resource
 * with two files where only one has a format has no recoverable mapping: index
 * 0 might be right or the format might belong to the second file. Rather than
 * pick, this drops the whole ambiguous list and falls back to the URL
 * extension, which is per-item and therefore cannot be mis-attributed. A
 * single file is never ambiguous, and equal-length lists are taken at face
 * value.
 *
 * @param {Array<Array<string>> | undefined | null} tags - the event's tags
 * @returns {{ count: number, items: LinkedMaterial[] }}
 */
export function describeLinkedMaterials(tags) {
  if (!Array.isArray(tags)) return { count: 0, items: [] };

  const urls = tagValues(tags, 'encoding:contentUrl');
  const formats = tagValues(tags, 'encoding:encodingFormat');
  const sizes = tagValues(tags, 'encoding:contentSize');
  const externals = tagValues(tags, 'r');

  const formatsUsable = formats.length === urls.length;
  const sizesUsable = sizes.length === urls.length;

  /** @type {LinkedMaterial[]} */
  const items = urls.map((url, index) => {
    const fromMime = formatsUsable ? materialTypeFromMime(formats[index]) : null;
    const type = fromMime ?? materialTypeFromFilename(url) ?? 'file';
    const parsedSize = sizesUsable ? Number.parseInt(sizes[index], 10) : NaN;
    const size = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : null;
    return { source: /** @type {const} */ ('upload'), type, size };
  });

  for (const url of externals) {
    // An `r` tag is a bare URL — no type, no size. The extension is the only
    // signal available without a network call, and often there is none.
    items.push({
      source: 'link',
      type: materialTypeFromFilename(url) ?? 'link',
      size: null
    });
  }

  return { count: items.length, items };
}
