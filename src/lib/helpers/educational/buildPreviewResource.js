// @ts-nocheck
/**
 * Build a preview-ready AMB `resource` from in-progress wizard form data.
 *
 * Used by `ResourceFormWizard.svelte` to render `AMBResourceCard` as a
 * live preview while the user is still filling fields. Tolerant of
 * incomplete data — never throws, returns `null` only when the form has
 * nothing displayable yet.
 *
 * Pure helper; safe to call in `$derived`.
 */

import { ambToNostr } from 'amb-nostr-converter';
import { convertFormDataToAMB } from './formDataToAmb.js';
import { formatAMBResource } from './ambHelpers.js';
import { getSha256FromURL } from 'applesauce-common/helpers';

const AMB_RESOURCE_KIND = 30142;
const PLACEHOLDER_PUBKEY = '0'.repeat(64);

/**
 * @param {any} formData
 * @returns {boolean}
 */
function hasDisplayableContent(formData) {
  if (!formData) return false;
  return Boolean(
    formData.name?.trim() ||
      formData.description?.trim() ||
      formData.image?.trim() ||
      (Array.isArray(formData.learningResourceType)
        ? formData.learningResourceType.length > 0
        : formData.learningResourceType) ||
      (formData.about && formData.about.length > 0)
  );
}

/**
 * Convert wizard form data into the same shape `AMBResourceCard` consumes
 * (the output of `formatAMBResource`). Returns `null` when the form has
 * nothing worth previewing yet.
 *
 * Accepts `any` for `formData` because the wizard's local form state
 * carries a slightly wider shape than `EducationalFormData` (e.g. `image`,
 * `urlInput`) and the production tag-builder normalises before reading.
 *
 * @param {any} formData
 * @param {string | undefined} pubkey - Active user pubkey, or undefined for anonymous preview
 * @param {string} [locale='en'] - Display locale for SKOS labels
 * @returns {any | null}
 */
export function buildPreviewResource(formData, pubkey, locale = 'en') {
  if (!hasDisplayableContent(formData)) return null;

  const previewPubkey = pubkey && pubkey.length === 64 ? pubkey : PLACEHOLDER_PUBKEY;
  const created_at = Math.floor(Date.now() / 1000);

  /** @type {Array<Array<string>>} */
  let tags = [];
  let content = '';

  try {
    // Wizard stores SKOS-picked fields as CompactConcept[] (array of {id,label}),
    // but convertFormDataToAMB expects either a plain string id (for
    // `learningResourceType`) or a string-id array with a separate
    // `*Labels` sidecar (for `about` and `educationalLevels`). Normalize all
    // three so the preview tags emit clean URIs/labels instead of
    // "[object Object]".
    const lrt = formData?.learningResourceType;
    const eduLevels = formData?.educationalLevels;
    const about = formData?.about;
    const isCompact = (/** @type {any} */ v) =>
      Array.isArray(v) && v.length > 0 && v.every((e) => e && typeof e === 'object' && 'id' in e);

    /** @type {any} */
    const normalised = { ...formData };

    // learningResourceType: object[] → string id + sidecar label
    if (Array.isArray(lrt)) {
      normalised.learningResourceType = lrt[0]?.id ?? '';
      normalised.learningResourceTypeLabel = lrt[0]?.label ?? '';
    }

    // educationalLevels: CompactConcept[] → string[] + label sidecar
    if (isCompact(eduLevels)) {
      normalised.educationalLevels = eduLevels.map((/** @type {any} */ c) => c.id);
      normalised.educationalLevelLabels = eduLevels.map((/** @type {any} */ c) => ({
        id: c.id,
        label: c.label
      }));
    }

    // about: CompactConcept[] → string[] + label sidecar
    if (isCompact(about)) {
      normalised.about = about.map((/** @type {any} */ c) => c.id);
      normalised.aboutLabels = about.map((/** @type {any} */ c) => ({
        id: c.id,
        label: c.label
      }));
    }

    const ambData = convertFormDataToAMB(/** @type {any} */ (normalised));
    const result = ambToNostr(/** @type {any} */ (ambData), {
      pubkey: previewPubkey,
      timestamp: created_at
    });
    if (result.success && result.data) {
      tags = result.data.tags ?? [];
      content = result.data.content ?? '';
    }
  } catch {
    // Converter rejected the partial form — fall through with empty tags;
    // we'll fill in minimal display tags below.
    tags = [];
    content = '';
  }

  // Supplement with bare display tags. Either the converter refused (tags
  // is empty) or the converter doesn't emit some fields the card reads
  // directly (e.g. `image`). Skip keys already present so we don't double
  // up. AMBResourceCard tolerates each of these being absent.
  const hasTag = (/** @type {string} */ key) => tags.some((t) => t[0] === key);
  if (formData) {
    if (formData.name?.trim() && !hasTag('name')) tags.push(['name', formData.name.trim()]);
    if (formData.description?.trim() && !hasTag('description'))
      tags.push(['description', formData.description.trim()]);
    if (formData.image?.trim() && !hasTag('image')) tags.push(['image', formData.image.trim()]);
    if (formData.inLanguage && !hasTag('inLanguage'))
      tags.push(['inLanguage', formData.inLanguage]);
    if (formData.slug?.trim() && !hasTag('d')) tags.push(['d', formData.slug.trim()]);
  }

  // x tag (NIP-94 hash cross-reference for thumbnail). Prefer the license
  // event's x tag; fall back to parsing the URL for Blossom-style sources.
  if (!hasTag('x') && formData) {
    const licenseEvent = formData.imageLicenseEvent;
    const fromLicense = licenseEvent?.tags?.find((t) => t[0] === 'x')?.[1];
    const fromUrl = formData.image ? getSha256FromURL(formData.image) : undefined;
    const hash = fromLicense ?? fromUrl;
    if (hash) tags.push(['x', hash]);
  }

  /** @type {any} */
  const event = {
    id: '',
    pubkey: previewPubkey,
    created_at,
    kind: AMB_RESOURCE_KIND,
    tags,
    content,
    sig: ''
  };

  return formatAMBResource(event, locale);
}
