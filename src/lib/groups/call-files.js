/**
 * Files shared in the call chat (LiveKit byte streams, livekit-connection
 * `sendCallFile` / the `edufeed.call.file` handler).
 *
 * A received file becomes a same-origin blob URL. The sender's declared MIME
 * type is untrusted: typed `text/html` or `image/svg+xml`, a blob opened as a
 * document would run script in the app's origin. So only a fixed allowlist
 * of raster images keeps its type (they are previewed inline through <img>,
 * which never executes anything); everything else is stored and offered as
 * an opaque download.
 */

/** Types that are previewed inline and keep their declared type. */
export const CALL_FILE_PREVIEW_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
]);

/** @param {unknown} mime */
export function isPreviewableCallFile(mime) {
  return typeof mime === 'string' && CALL_FILE_PREVIEW_TYPES.has(mime.toLowerCase());
}

/**
 * The type a received file's blob gets: the declared type for allowlisted
 * raster images, `application/octet-stream` for everything else (including
 * SVG, HTML, PDF and an empty or non-string declaration).
 * @param {unknown} mime
 */
export function safeCallFileType(mime) {
  return isPreviewableCallFile(mime)
    ? /** @type {string} */ (mime).toLowerCase()
    : 'application/octet-stream';
}
