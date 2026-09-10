/**
 * Fill-empty-only merge of fetched metadata into the publication form.
 *
 * Shared by the URL prefill (citation_* tags) and the DOI prefill (Crossref):
 * whatever the source, a field the author already filled is never overwritten.
 * Language is the one exception — it follows the source — and therefore never
 * counts as "applied" on its own.
 */

/** @typedef {import('./crossref.js').DoiPrefill} DoiPrefill */

/**
 * @typedef {Object} PublicationFormSnapshot
 * @property {string} title
 * @property {any[]} creators
 * @property {string} doi
 * @property {string} datePublished
 * @property {string} journal
 * @property {string} abstract
 * @property {string[]} keywords
 * @property {string} inLanguage
 * @property {string} url
 * @property {string} license
 * @property {string} fileUrl
 * @property {boolean} hasUploads
 */

/**
 * @param {PublicationFormSnapshot} current
 * @param {DoiPrefill} prefill
 * @returns {{ patch: Partial<PublicationFormSnapshot> & { file?: any }, applied: boolean }}
 */
export function mergePublicationPrefill(current, prefill) {
  /** @type {any} */
  const patch = {};
  const blank = (/** @type {string} */ s) => !s || !s.trim();

  if (prefill.title && blank(current.title)) patch.title = prefill.title;
  if (prefill.creators?.length && !current.creators?.length) patch.creators = prefill.creators;
  if (prefill.doi && blank(current.doi)) patch.doi = prefill.doi;
  if (prefill.datePublished && !current.datePublished) patch.datePublished = prefill.datePublished;
  if (prefill.journal && blank(current.journal)) patch.journal = prefill.journal;
  if (prefill.abstract && blank(current.abstract)) patch.abstract = prefill.abstract;
  if (prefill.keywords?.length && !current.keywords?.length) patch.keywords = prefill.keywords;
  if (prefill.url && blank(current.url)) patch.url = prefill.url;
  if (prefill.license && blank(current.license)) patch.license = prefill.license;
  if (prefill.file && blank(current.fileUrl) && !current.hasUploads) patch.file = prefill.file;
  const applied = Object.keys(patch).length > 0;
  if (prefill.inLanguage) patch.inLanguage = prefill.inLanguage;
  return { patch, applied };
}
