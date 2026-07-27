/**
 * AMB (Allgemeines Metadatenprofil für Bildungsressourcen) Tag Readers
 *
 * Low-level helpers for reading flattened AMB tags from kind 30142 events.
 *
 * Full AMB <-> Nostr conversion lives in the `amb-nostr-converter` library
 * (`ambToNostr` / `nostrToAmb`), which implements NIP-AMB including
 * Nostr-native creator `p` tags, `@context`, and `nostr:` URI ids. The
 * former local converters (`unflattenNostrTagsToAMB` / `flattenAMBToNostrTags`)
 * were removed in favor of the library.
 *
 * @see https://dini-ag-kim.github.io/amb/latest/ - AMB Specification
 * @see https://git.edufeed.org/edufeed/amb-nostr-converter
 */

import { extractLabelFromUri } from './skosLoader.js';

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
