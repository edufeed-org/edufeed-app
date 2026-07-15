/**
 * Browser-side wrappers over the /api/metaclean proxy (metadata-cleaner
 * service). `fetch` is injected (defaults to global) so these unit-test
 * without a running server — same pattern as helpers/oer/searchOer.js.
 *
 * @typedef {Object} MetaField
 * @property {string} id - field id used in ops, e.g. "pdf.docinfo./Producer"
 * @property {string} store - "DocInfo" | "XMP" | "EXIF" | "IPTC" | "PNG" | "Other"
 * @property {string} key
 * @property {string} label
 * @property {string} value
 * @property {boolean} sensitive
 *
 * @typedef {{ type: 'delete', fieldId: string } | { type: 'set', fieldId: string, value: string } | { type: 'add', store: string, key: string, value: string }} Op
 *
 * @typedef {Object} ApplyResult
 * @property {MetaField[]} before
 * @property {MetaField[]} after
 * @property {string[]} leaks
 * @property {string[]} [warnings]
 * @property {number} sizeBefore
 * @property {number} sizeAfter
 * @property {{ processed: number, skipped: number, bytesBefore: number, bytesAfter: number }} [compression]
 */

const SUPPORTED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp'
]);
const SUPPORTED_EXT = /\.(pdf|jpe?g|png|tiff?|webp)$/i;
const PDF_EXT = /\.pdf$/i;

/**
 * Whether the metadata cleaner supports this file type.
 * @param {File} file
 */
export function isSupportedFile(file) {
  if (file.type) return SUPPORTED_MIME.has(file.type);
  return SUPPORTED_EXT.test(file.name);
}

/**
 * Whether this file is a PDF (the only type supporting compression).
 * @param {File} file
 */
export function isPdfFile(file) {
  if (file.type) return file.type === 'application/pdf';
  return PDF_EXT.test(file.name);
}

/**
 * Extract the upstream error message from a failed proxy response.
 * @param {Response} res
 * @returns {Promise<Error>}
 */
async function toError(res) {
  try {
    const body = await res.json();
    if (body?.error) return new Error(body.error);
  } catch {
    // non-JSON error body — fall through to the generic message
  }
  return new Error(`Metadata cleaner request failed: HTTP ${res.status}`);
}

/**
 * Upload a file for inspection; creates a server-side session.
 * @param {File} file
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ sessionId: string, filename: string, fields: MetaField[] }>}
 */
export async function inspectFile(file, fetchImpl = fetch) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetchImpl('/api/metaclean/files', { method: 'POST', body: form });
  if (!res.ok) throw await toError(res);
  return res.json();
}

/**
 * Fetch the strip-provenance operations for the session's file.
 * @param {string} sessionId
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ops: Op[] }>}
 */
export async function getStripOps(sessionId, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/metaclean/files/${sessionId}/ops/strip`);
  if (!res.ok) throw await toError(res);
  return res.json();
}

/**
 * Apply operations (and optional PDF compression) to the session's file.
 * flatten + preserveDates are always sent true, matching the service's own UI.
 * @param {string} sessionId
 * @param {{ ops: Op[], compress?: 'off' | 'balanced' | 'strong' }} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<ApplyResult>}
 */
export async function applyOps(sessionId, { ops, compress }, fetchImpl = fetch) {
  /** @type {Record<string, unknown>} */
  const body = { ops, flatten: true, preserveDates: true };
  if (compress && compress !== 'off') body.compress = compress;
  const res = await fetchImpl(`/api/metaclean/files/${sessionId}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

/**
 * Download the cleaned copy as a File carrying the original name and type,
 * so it can replace the pending upload transparently.
 * @param {string} sessionId
 * @param {string} filename
 * @param {string} type
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<File>}
 */
export async function downloadCleaned(sessionId, filename, type, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/metaclean/files/${sessionId}/download`);
  if (!res.ok) throw await toError(res);
  const blob = await res.blob();
  return new File([blob], filename, { type });
}

/**
 * Group fields by store, preserving first-seen store order.
 * @param {MetaField[]} fields
 * @returns {Array<{ store: string, fields: MetaField[] }>}
 */
export function groupFieldsByStore(fields) {
  /** @type {Map<string, MetaField[]>} */
  const byStore = new Map();
  for (const field of fields) {
    const bucket = byStore.get(field.store);
    if (bucket) bucket.push(field);
    else byStore.set(field.store, [field]);
  }
  return [...byStore.entries()].map(([store, storeFields]) => ({ store, fields: storeFields }));
}
