/**
 * AMB (Allgemeines Metadatenprofil für Bildungsressourcen) Transformation Library
 *
 * This module provides core transformation functions for converting between:
 * - AMB metadata (nested JSON structure)
 * - Nostr events (flattened tag structure using kind 30142)
 *
 * These functions are designed to be library-ready and framework-agnostic.
 *
 * @see https://dini-ag-kim.github.io/amb/latest/ - AMB Specification
 */

import { extractLabelFromUri } from './skosLoader.js';

/**
 * Converts flattened Nostr tags (from kind 30142 event) back to nested AMB metadata structure
 *
 * @param {Array<Array<string>>} tags - Array of Nostr tags
 * @returns {Object} Reconstructed AMB metadata object
 *
 * @example
 * const tags = [
 *   ["d", "resource-123"],
 *   ["name", "Physics Course"],
 *   ["creator:name", "Dr. Smith"],
 *   ["creator:affiliation:name", "MIT"],
 *   ["t", "Physics"],
 *   ["t", "Education"]
 * ];
 * const amb = unflattenNostrTagsToAMB(tags);
 * // Result: { id: "resource-123", name: "Physics Course", creator: {...}, keywords: [...] }
 */
export function unflattenNostrTagsToAMB(tags) {
  /** @type {Record<string, any>} */
  const result = {};

  // Group tags by their key
  /** @type {Record<string, Array<string[]>>} */
  const tagGroups = {};
  /** @type {Array<{pubkey: string, relay: string, marker: string}>} */
  const pTags = []; // Collect p tags separately (Nostr-native creator references)
  /** @type {Array<{coordinate: string, relay: string, marker: string}>} */
  const aTags = []; // Collect a tags separately (Nostr-native resource references)

  tags.forEach(([key, ...values]) => {
    // Special case: 'd' tag maps to 'id'
    if (key === 'd') {
      result.id = values[0];
      return;
    }

    // Special case: 'p' tags with markers map to creator/contributor
    if (key === 'p') {
      const [pubkey, relay, marker] = values;
      if (marker === 'creator' || marker === 'contributor') {
        pTags.push({ pubkey, relay, marker });
      }
      return;
    }

    // Special case: 'a' tags with markers map to relations (isBasedOn, isPartOf, hasPart)
    if (key === 'a') {
      const [coordinate, relay, marker] = values;
      if (['isBasedOn', 'isPartOf', 'hasPart'].includes(marker)) {
        aTags.push({ coordinate, relay, marker });
      }
      return;
    }

    // Special case: 't' tags map to 'keywords' array
    if (key === 't') {
      if (!result.keywords) {
        result.keywords = [];
      }
      result.keywords.push(values[0]);
      return;
    }

    if (!tagGroups[key]) {
      tagGroups[key] = [];
    }
    tagGroups[key].push(values);
  });

  // Process p tags (Nostr-native creator/contributor references)
  if (pTags.length > 0) {
    const creatorTags = pTags.filter((t) => t.marker === 'creator');
    const contributorTags = pTags.filter((t) => t.marker === 'contributor');

    if (creatorTags.length > 0) {
      if (!result.creator) result.creator = [];
      creatorTags.forEach(({ pubkey }) => {
        result.creator.push({ id: pubkey, type: 'Person' });
      });
    }

    if (contributorTags.length > 0) {
      if (!result.contributor) result.contributor = [];
      contributorTags.forEach(({ pubkey }) => {
        result.contributor.push({ id: pubkey, type: 'Person' });
      });
    }
  }

  // Process a tags (Nostr-native resource references)
  if (aTags.length > 0) {
    aTags.forEach(({ coordinate, marker }) => {
      if (!result[marker]) result[marker] = [];
      result[marker].push({ id: coordinate });
    });
  }

  // Process each tag group
  for (const [key, valuesList] of /** @type {[string, Array<string[]>][]} */ (
    Object.entries(tagGroups)
  )) {
    const parts = key.split(':');

    // Determine if this is an array property (multiple occurrences)
    if (valuesList.length > 1) {
      // Check if this is an array of objects (has nested properties)
      const hasNestedProps = Object.keys(tagGroups).some((k) => k.startsWith(key + ':'));

      if (hasNestedProps) {
        // Array of objects - group by instance
        const instances = groupArrayInstances(key, tagGroups);
        setNestedValue(result, parts, instances);
      } else {
        // Simple array of values
        setNestedValue(
          result,
          parts,
          valuesList.map((/** @type {string[]} */ v) => v[0])
        );
      }
    } else {
      // Single occurrence
      setNestedValue(result, parts, valuesList[0][0]);
    }
  }

  return result;
}

/**
 * Groups tags that belong to the same array instance
 * Handles nested object arrays like creator[], publisher[], etc.
 *
 * @private
 * @param {string} baseKey - The base key (e.g., "creator")
 * @param {Record<string, Array<string[]>>} tagGroups - All tag groups
 * @returns {Array<Record<string, any>>} Array of reconstructed objects
 */
function groupArrayInstances(baseKey, tagGroups) {
  /** @type {Array<Record<string, any>>} */
  const instances = [];
  const relevantKeys = Object.keys(tagGroups)
    .filter((k) => k === baseKey || k.startsWith(baseKey + ':'))
    .sort();

  // Get the maximum number of instances
  const maxInstances = Math.max(...relevantKeys.map((k) => tagGroups[k].length));

  // Reconstruct each instance
  for (let i = 0; i < maxInstances; i++) {
    /** @type {Record<string, any>} */
    const instance = {};

    relevantKeys.forEach((key) => {
      if (tagGroups[key][i]) {
        const parts = key.split(':').slice(1); // Remove base key
        if (parts.length === 0) {
          // This is the base key itself (simple value)
          Object.assign(instance, { value: tagGroups[key][i][0] });
        } else {
          setNestedValue(instance, parts, tagGroups[key][i][0]);
        }
      }
    });

    if (Object.keys(instance).length > 0) {
      instances.push(instance);
    }
  }

  return instances;
}

/**
 * Sets a nested value in an object using an array of property path parts
 *
 * @private
 * @param {Record<string, any>} obj - Target object
 * @param {string[]} parts - Property path parts (e.g., ["creator", "affiliation", "name"])
 * @param {any} value - Value to set
 */
function setNestedValue(obj, parts, value) {
  const lastPart = parts[parts.length - 1];
  /** @type {Record<string, any>} */
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }

  current[lastPart] = value;
}

/**
 * Converts AMB metadata to flattened Nostr tags for kind 30142 event
 *
 * @param {Object} ambData - AMB metadata object
 * @returns {Array<Array<string>>} Array of Nostr tags
 *
 * @example
 * const ambData = {
 *   id: "resource-123",
 *   name: "Physics Course",
 *   creator: { name: "Dr. Smith", affiliation: { name: "MIT" } },
 *   keywords: ["Physics", "Education"]
 * };
 * const tags = flattenAMBToNostrTags(ambData);
 * // Result: [["d", "resource-123"], ["name", "Physics Course"], ...]
 */
export function flattenAMBToNostrTags(ambData) {
  /** @type {Array<string[]>} */
  const tags = [];

  /**
   * @param {string} key
   * @param {any} value
   */
  function addTag(key, value) {
    if (value !== null && value !== undefined && value !== '') {
      tags.push([key, String(value)]);
    }
  }

  /**
   * @param {any} obj
   * @param {string} prefix
   */
  function flattenObject(obj, prefix = '') {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}:${key}` : key;

      // Special case: id maps to 'd' tag
      if (key === 'id' && !prefix) {
        addTag('d', value);
        continue;
      }

      // Special case: keywords map to 't' tags (Nostr-native)
      if (key === 'keywords' && !prefix && Array.isArray(value)) {
        value.forEach((keyword) => {
          addTag('t', keyword);
        });
        continue;
      }

      if (Array.isArray(value)) {
        // Arrays: repeat the same key for each element
        value.forEach((item) => {
          if (typeof item === 'object' && item !== null) {
            flattenObject(item, fullKey);
          } else {
            addTag(fullKey, item);
          }
        });
      } else if (typeof value === 'object' && value !== null) {
        // Nested objects: flatten recursively
        flattenObject(value, fullKey);
      } else {
        // Simple values
        addTag(fullKey, value);
      }
    }
  }

  flattenObject(ambData);
  return tags;
}

/**
 * Extracts a simple tag value from Nostr tags
 *
 * @param {Array<Array<string>>} tags - Array of Nostr tags
 * @param {string} tagName - Tag name to find
 * @returns {string|null} Tag value or null if not found
 */
export function getTagValue(tags, tagName) {
  const tag = tags.find((t) => t[0] === tagName);
  return tag ? tag[1] : null;
}

/**
 * Extracts all values for a given tag name (for tags that can repeat)
 *
 * @param {Array<Array<string>>} tags - Array of Nostr tags
 * @param {string} tagName - Tag name to find
 * @returns {string[]} Array of tag values
 */
export function getTagValues(tags, tagName) {
  return tags.filter((t) => t[0] === tagName).map((t) => t[1]);
}

/**
 * Extracts values for a nested tag (using colon delimiter)
 *
 * @param {Array<Array<string>>} tags - Array of Nostr tags
 * @param {string} tagPath - Tag path (e.g., "creator:name" or "about:prefLabel")
 * @returns {string[]} Array of matching tag values
 */
export function getNestedTagValues(tags, tagPath) {
  return tags.filter((t) => t[0] === tagPath).map((t) => t[1]);
}

/**
 * Gets all tags matching a prefix (useful for grouped properties)
 *
 * @param {Array<Array<string>>} tags - Array of Nostr tags
 * @param {string} prefix - Prefix to match (e.g., "creator:" or "about:")
 * @returns {Array<Array<string>>} Array of matching tags
 */
export function getTagsByPrefix(tags, prefix) {
  return tags.filter((t) => t[0].startsWith(prefix));
}

/**
 * Gets a prefLabel value with language fallback logic.
 * Implements the language preference: userLang → 'en' → null
 *
 * @param {Array<Array<string>>} tags - Array of Nostr tags
 * @param {string} prefix - The tag prefix (e.g., 'about', 'learningResourceType', 'educationalLevel')
 * @param {string} [userLang='en'] - User's preferred language code (e.g., 'de', 'en')
 * @returns {string|null} - The label in preferred language, or null if not found
 *
 * @example
 * // Tags: [["about:prefLabel:de", "Mathematik"], ["about:prefLabel:en", "Mathematics"]]
 * getPrefLabelWithFallback(tags, 'about', 'de') // Returns "Mathematik"
 * getPrefLabelWithFallback(tags, 'about', 'fr') // Returns "Mathematics" (English fallback)
 * getPrefLabelWithFallback(tags, 'about', 'fr') // Returns null if no English either
 */
export function getPrefLabelWithFallback(tags, prefix, userLang = 'en') {
  // Try user's preferred language first
  const userLangTag = `${prefix}:prefLabel:${userLang}`;
  const userLangLabel = getTagValue(tags, userLangTag);
  if (userLangLabel) {
    return userLangLabel;
  }

  // Fallback to English if user's language not available
  if (userLang !== 'en') {
    const enTag = `${prefix}:prefLabel:en`;
    const enLabel = getTagValue(tags, enTag);
    if (enLabel) {
      return enLabel;
    }
  }

  // Return null - caller should use ID as final fallback
  return null;
}

/**
 * Returns a human-readable language name for a language code using Intl.DisplayNames.
 *
 * @param {string} langCode - ISO 639-1 language code (e.g., 'de', 'en')
 * @param {string} [displayLocale='en'] - Locale for the display name (e.g., 'en' → "German", 'de' → "Deutsch")
 * @returns {string} Human-readable language name, or the code itself on failure
 */
export function getLanguageDisplayName(langCode, displayLocale = 'en') {
  try {
    const names = new Intl.DisplayNames([displayLocale], { type: 'language' });
    return names.of(langCode) || langCode;
  } catch {
    return langCode;
  }
}

/**
 * Gets all prefLabel values for a given prefix, grouped by index position.
 * This is useful for properties that can have multiple instances (like multiple subjects).
 *
 * When a label is resolved from a language other than the user's preferred language,
 * the returned object includes a `fallbackLang` property indicating the source language.
 *
 * @param {Array<Array<string>>} tags - Array of Nostr tags
 * @param {string} prefix - The tag prefix (e.g., 'about', 'learningResourceType')
 * @param {string} [userLang='en'] - User's preferred language code
 * @param {import('$lib/helpers/educational/skosLoader.js').SKOSConcept[] | null} [concepts=null] - Optional SKOS concepts for URI resolution
 * @returns {Array<{id: string, label: string, fallbackLang?: string}>} Array of objects with id, language-aware label, and optional fallback language indicator
 *
 * @example
 * // Tags with only German labels, userLang='en':
 * // ["about:id", "http://example.org/math"], ["about:prefLabel:de", "Mathematik"]
 * getLabelsWithFallback(tags, 'about', 'en')
 * // Returns [{id: "...", label: "Mathematik", fallbackLang: "de"}]
 */
export function getLabelsWithFallback(tags, prefix, userLang = 'en', concepts = null) {
  const idTagName = `${prefix}:id`;
  const userLangTagName = `${prefix}:prefLabel:${userLang}`;
  const enTagName = `${prefix}:prefLabel:en`;
  const prefLabelPrefix = `${prefix}:prefLabel:`;

  // Get all IDs (deduplicated, keeping first occurrence index for positional label matching)
  const allIds = getTagValues(tags, idTagName);
  const seenIds = new Set();
  const ids = [];
  /** @type {number[]} */
  const idIndexes = [];
  for (let i = 0; i < allIds.length; i++) {
    if (!seenIds.has(allIds[i])) {
      seenIds.add(allIds[i]);
      ids.push(allIds[i]);
      idIndexes.push(i);
    }
  }

  // Get all labels in user's language
  const userLangLabels = getTagValues(tags, userLangTagName);

  // Get all English labels as fallback
  const enLabels = userLang !== 'en' ? getTagValues(tags, enTagName) : [];

  // Discover all other available languages from tags
  /** @type {Record<string, string[]>} */
  const otherLangLabels = {};
  const seenLangs = new Set();
  for (const tag of tags) {
    if (tag[0].startsWith(prefLabelPrefix)) {
      const lang = tag[0].slice(prefLabelPrefix.length);
      if (lang !== userLang && lang !== 'en' && !seenLangs.has(lang)) {
        seenLangs.add(lang);
        otherLangLabels[lang] = getTagValues(tags, `${prefix}:prefLabel:${lang}`);
      }
    }
  }

  return ids.map((id, index) => {
    // Map back to original positional index for label array lookups
    const origIndex = idIndexes[index];

    // Helper: some publishers write the URI into prefLabel tags — treat as missing
    const isUri = (/** @type {string | undefined} */ v) =>
      v?.startsWith('http://') || v?.startsWith('https://');

    // Try user's language first
    let label = isUri(userLangLabels[origIndex]) ? undefined : userLangLabels[origIndex];
    /** @type {string | undefined} */
    let fallbackLang;

    // Fallback to English
    if (!label && userLang !== 'en') {
      label = isUri(enLabels[origIndex]) ? undefined : enLabels[origIndex];
      if (label) fallbackLang = 'en';
    }

    // Fallback to any other available language from tags
    if (!label) {
      for (const [lang, labels] of Object.entries(otherLangLabels)) {
        if (labels[origIndex] && !isUri(labels[origIndex])) {
          label = labels[origIndex];
          fallbackLang = lang;
          break;
        }
      }
    }

    // Fallback to SKOS concept lookup
    if (!label && concepts) {
      const concept = concepts.find((c) => c.id === id);
      if (concept) {
        if (concept.labels[userLang]) {
          label = concept.labels[userLang];
        } else if (concept.labels.en) {
          label = concept.labels.en;
          fallbackLang = 'en';
        } else if (concept.labels.de) {
          label = concept.labels.de;
          fallbackLang = 'de';
        } else {
          const firstLang = Object.keys(concept.labels)[0];
          if (firstLang) {
            label = concept.labels[firstLang];
            fallbackLang = firstLang;
          }
        }
      }
    }

    // Fallback to extracting readable label from URI (no meaningful language)
    if (!label) {
      label = extractLabelFromUri(id);
      fallbackLang = undefined;
    }

    /** @type {{id: string, label: string, fallbackLang?: string}} */
    const result = { id, label };
    if (fallbackLang) result.fallbackLang = fallbackLang;
    return result;
  });
}
