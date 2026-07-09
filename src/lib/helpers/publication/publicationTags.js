/**
 * Scientific publication (kind 30040, NKBIP-01 "Curated Publications")
 * tag serialization and parsing.
 *
 * We index *external* scientific articles by metadata only, so events carry
 * the NKBIP-01 index tags (`title`, `author`, `i`, `published_on`,
 * `published_by`, `summary`, `type: academic`, `source`) plus AMB-style
 * flattened extension tags for the fields the NIP does not define
 * (structured creators with ORCID, DeStatis subject classification,
 * language, license) — the same extension approach used for kind 30142.
 *
 * Deviation from NKBIP-01: no `a` tags referencing kind 30041 content
 * sections are emitted, since the publication content lives outside Nostr
 * (see `source` / DOI).
 */

import { getAMBCreators } from '$lib/helpers/educational/ambHelpers.js';
import {
  getLabelsWithFallback,
  getTagValue,
  getTagValues
} from '$lib/helpers/educational/ambTransform.js';
import { normalizeOrcid } from '$lib/helpers/educational/orcid.js';
import { normalizeDoi } from './doi.js';

export const PUBLICATION_KIND = 30040;

/**
 * @typedef {import('$lib/stores/educational-actions.svelte.js').Creator} Creator
 *
 * @typedef {Object} PublicationFormData
 * @property {string} title
 * @property {Creator[]} creators
 * @property {string[]} keywords
 * @property {Array<{id: string, label: string}>} subjects - DeStatis Fachsystematik concepts
 * @property {string} [abstract]
 * @property {string} [doi] - bare DOI (`10.x/...`)
 * @property {string} [url] - where the article can be read
 * @property {string} [journal] - journal / publishing venue
 * @property {string} [datePublished] - ISO date (YYYY-MM-DD)
 * @property {string} [inLanguage] - ISO 639-1 code
 * @property {string} [license] - license URL
 * @property {string} [image] - cover/preview image URL
 * @property {PublicationFile} [file] - the actual article file (link or upload)
 */

/**
 * @typedef {Object} PublicationFile
 * @property {string} url
 * @property {string} [mimeType]
 * @property {number} [size]
 * @property {string} [sha256]
 */

/**
 * Generate a random 8-character identifier.
 * @returns {string}
 */
function generateRandomId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Build the kind 30040 tag list from publication form data.
 *
 * @param {PublicationFormData} formData
 * @param {string} [dTag] - existing identifier (edit mode)
 * @returns {string[][]}
 */
export function buildPublicationTags(formData, dTag) {
  /** @type {string[][]} */
  const tags = [
    ['d', dTag || generateRandomId()],
    ['title', formData.title],
    ['type', 'academic']
  ];

  // NKBIP-01 author tags (one per creator, plain names)
  for (const creator of formData.creators || []) {
    if (creator.name?.trim()) tags.push(['author', creator.name.trim()]);
  }

  if (formData.doi) tags.push(['i', `doi:${formData.doi}`]);
  if (formData.url?.trim()) tags.push(['source', formData.url.trim()]);
  if (formData.datePublished?.trim()) tags.push(['published_on', formData.datePublished.trim()]);
  if (formData.journal?.trim()) tags.push(['published_by', formData.journal.trim()]);
  if (formData.abstract?.trim()) tags.push(['summary', formData.abstract.trim()]);
  if (formData.image?.trim()) tags.push(['image', formData.image.trim()]);

  for (const keyword of formData.keywords || []) {
    if (keyword.trim()) tags.push(['t', keyword.trim()]);
  }

  // AMB-style structured creators; each creator's fields form one
  // consecutive run so `getAMBCreators` can regroup them losslessly.
  for (const creator of formData.creators || []) {
    if (!creator.name?.trim()) continue;
    tags.push(['creator:type', creator.type || 'Person']);
    tags.push(['creator:name', creator.name.trim()]);
    if (creator.honorificPrefix) tags.push(['creator:honorificPrefix', creator.honorificPrefix]);
    if (creator.affiliationName) tags.push(['creator:affiliation:name', creator.affiliationName]);
    if (creator.orcid) tags.push(['creator:id', creator.orcid]);
  }

  const lang = formData.inLanguage || 'de';
  for (const subject of formData.subjects || []) {
    if (!subject.id) continue;
    tags.push(['about:id', subject.id]);
    if (subject.label) tags.push([`about:prefLabel:${lang}`, subject.label]);
  }

  if (formData.inLanguage) tags.push(['inLanguage', formData.inLanguage]);
  if (formData.license) tags.push(['license:id', formData.license]);

  // The article file, AMB-encoding style. Single file by design — the
  // positional getAMBEncodings pairing can't disambiguate mixed link/upload
  // runs with heterogeneous optional fields.
  const file = formData.file;
  if (file?.url?.trim()) {
    tags.push(['encoding:contentUrl', file.url.trim()]);
    if (file.mimeType) tags.push(['encoding:encodingFormat', file.mimeType]);
    if (file.size) tags.push(['encoding:contentSize', String(file.size)]);
    if (file.sha256) tags.push(['encoding:sha256', file.sha256]);
  }

  return tags;
}

/**
 * Parse a kind 30040 publication event back into form data.
 *
 * @param {any} event
 * @returns {PublicationFormData}
 */
export function parsePublicationEvent(event) {
  const tags = event?.tags || [];

  // Structured creators from creator:* runs; fall back to plain author tags.
  /** @type {Creator[]} */
  let creators = getAMBCreators(event).map((c) => {
    /** @type {Creator} */
    const creator = {
      name: c.name || '',
      type: c.type === 'Organization' ? 'Organization' : 'Person'
    };
    if (c.honorificPrefix) creator.honorificPrefix = c.honorificPrefix;
    if (c.affiliationName) creator.affiliationName = c.affiliationName;
    const orcid = c.id ? normalizeOrcid(c.id) : null;
    if (orcid) creator.orcid = orcid;
    return creator;
  });
  if (creators.length === 0) {
    creators = getTagValues(tags, 'author').map((name) => ({
      name,
      type: /** @type {'Person'} */ ('Person')
    }));
  }

  const lang = getTagValue(tags, 'inLanguage') || '';

  // First i-tag carrying a DOI (events may list other identifier schemes)
  const doi =
    getTagValues(tags, 'i')
      .map((v) => normalizeDoi(v))
      .find(Boolean) || '';

  // Article file (first encoding run)
  const fileUrl = getTagValue(tags, 'encoding:contentUrl');
  /** @type {PublicationFile | undefined} */
  let file;
  if (fileUrl) {
    file = { url: fileUrl };
    const mimeType = getTagValue(tags, 'encoding:encodingFormat');
    if (mimeType) file.mimeType = mimeType;
    const size = Number(getTagValue(tags, 'encoding:contentSize'));
    if (Number.isFinite(size) && size > 0) file.size = size;
    const sha256 = getTagValue(tags, 'encoding:sha256');
    if (sha256) file.sha256 = sha256;
  }

  return {
    ...(file ? { file } : {}),
    title: getTagValue(tags, 'title') || '',
    abstract: getTagValue(tags, 'summary') || '',
    doi,
    url: getTagValue(tags, 'source') || '',
    journal: getTagValue(tags, 'published_by') || '',
    datePublished: getTagValue(tags, 'published_on') || '',
    inLanguage: lang,
    license: getTagValue(tags, 'license:id') || '',
    image: getTagValue(tags, 'image') || '',
    keywords: getTagValues(tags, 't'),
    subjects: getLabelsWithFallback(tags, 'about', lang || 'de'),
    creators
  };
}
