/**
 * Form data → AMB object conversion.
 *
 * Pure, side-effect free. Extracted from `stores/educational-actions.svelte.js`
 * so the serialization path can be exercised in node-env tests without having
 * to import the Svelte-runes store module.
 */

import { extractLabelFromUri } from './skosLoader.js';

/**
 * @typedef {import('$lib/stores/educational-actions.svelte').EducationalFormData} EducationalFormData
 */

/**
 * Generate a random 8-character identifier.
 * @returns {string}
 */
function generateRandomId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Convert form data to an AMB metadata object ready for serialization.
 * @param {EducationalFormData} formData
 * @returns {Record<string, any>}
 */
export function convertFormDataToAMB(formData) {
  const identifier = formData.slug?.trim() || generateRandomId();

  const lang = formData.inLanguage || 'en';

  /** @type {Record<string, any>} */
  const amb = {
    id: identifier,
    type: ['LearningResource'],
    name: formData.name,
    description: formData.description,
    inLanguage: formData.inLanguage ? [formData.inLanguage] : [],
    license: { id: formData.license }
  };

  if (formData.learningResourceType) {
    amb.learningResourceType = [
      {
        id: formData.learningResourceType,
        prefLabel: {
          [lang]:
            formData.learningResourceTypeLabel || extractLabelFromUri(formData.learningResourceType)
        }
      }
    ];
  }

  if (formData.about && formData.about.length > 0) {
    amb.about = formData.about.map((uri, index) => ({
      id: uri,
      prefLabel: {
        [lang]: formData.aboutLabels?.[index]?.label || extractLabelFromUri(uri)
      }
    }));
  }

  if (formData.educationalLevels && formData.educationalLevels.length > 0) {
    amb.educationalLevel = formData.educationalLevels.map((uri, index) => ({
      id: uri,
      prefLabel: {
        [lang]: formData.educationalLevelLabels?.[index]?.label || extractLabelFromUri(uri)
      }
    }));
  } else if (formData.educationalLevel) {
    amb.educationalLevel = [
      {
        id: formData.educationalLevel,
        prefLabel: {
          [lang]: formData.educationalLevelLabel || extractLabelFromUri(formData.educationalLevel)
        }
      }
    ];
  }

  if (formData.keywords && formData.keywords.length > 0) {
    amb.keywords = formData.keywords;
  }

  if (formData.creators && formData.creators.length > 0) {
    amb.creator = formData.creators.map((creator) => {
      /** @type {Record<string, any>} */
      const creatorObj = {
        type: creator.type,
        name: creator.name
      };
      if (creator.honorificPrefix) {
        creatorObj.honorificPrefix = creator.honorificPrefix;
      }
      if (creator.affiliationName) {
        creatorObj.affiliation = { name: creator.affiliationName };
      }
      return creatorObj;
    });
  }

  if (formData.files && formData.files.length > 0) {
    amb.encoding = formData.files.map((file) => ({
      contentUrl: file.url,
      encodingFormat: file.mimeType,
      contentSize: file.size,
      sha256: file.sha256
    }));
  }

  if (formData.isAccessibleForFree !== undefined) {
    amb.isAccessibleForFree = formData.isAccessibleForFree;
  }

  // schema.org/AMB dates. Emitted as flat `["datePublished", ...]` /
  // `["dateCreated", ...]` tags by ambToNostr so the relay can index them.
  if (formData.datePublished?.trim()) {
    amb.datePublished = formData.datePublished.trim();
  }
  if (formData.dateCreated?.trim()) {
    amb.dateCreated = formData.dateCreated.trim();
  }

  // Pedagogical Concept fields. Each is an array of SKOS Concept objects
  // emitted by the curriculum picker; we round-trip the picker's compact
  // shape (`id`, `type: 'Concept'`, `prefLabel: { <lang>: label }`) verbatim.
  for (const key of /** @type {const} */ (['teaches', 'assesses', 'competencyRequired'])) {
    const concepts = formData[key];
    if (Array.isArray(concepts) && concepts.length > 0) {
      amb[key] = concepts.map((c) => ({
        id: c.id,
        type: 'Concept',
        prefLabel: c.prefLabel ?? { [lang]: extractLabelFromUri(c.id) }
      }));
    }
  }

  // AMB relation references. formData carries `{coordinate, pubkey, dTag, ...}`
  // entries; `ambToNostr` expects AMB-shape `{id: <coordinate>}` and consults
  // `relatedEvents[coordinate]` for the `["a", coord, relay, marker]` tag.
  if (formData.hasPart && formData.hasPart.length > 0) {
    amb.hasPart = formData.hasPart.map((ref) => ({ id: ref.coordinate }));
  }
  if (formData.isPartOf && formData.isPartOf.length > 0) {
    amb.isPartOf = formData.isPartOf.map((ref) => ({ id: ref.coordinate }));
  }

  return amb;
}
