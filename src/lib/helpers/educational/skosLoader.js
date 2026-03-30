/**
 * SKOS Vocabulary Loader
 * Fetches and caches SKOS vocabularies for dropdown fields
 * Supports language-aware label extraction and hierarchical structures
 */

// SKOS vocabulary URLs
export const SKOS_VOCABULARIES = {
  learningResourceType: 'https://w3id.org/kim/hcrt/scheme.json',
  about: 'https://w3id.org/kim/hochschulfaechersystematik/scheme.json',
  intendedEndUserRole: 'https://w3id.org/kim/intendedEndUserRole/scheme.json'
};

// Cache key prefix
const CACHE_PREFIX = 'skos_vocab_';
const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * @typedef {Object} SKOSConcept
 * @property {string} id - The concept URI
 * @property {Record<string, string>} labels - Labels by language code (e.g., { de: 'Video', en: 'Video' })
 * @property {string} [notation] - Optional notation/code
 * @property {number} [level] - Hierarchy level (0 = top, 1 = child, etc.)
 * @property {string} [parentId] - Parent concept ID (if nested)
 */

/**
 * @typedef {Object} CachedVocabulary
 * @property {number} timestamp - When the cache was created
 * @property {SKOSConcept[]} concepts - The cached concepts
 */

/**
 * Get a label for a concept in the preferred language with fallbacks
 * @param {SKOSConcept} concept - The concept
 * @param {string} preferredLang - Preferred language code
 * @returns {string} The label in the best available language
 */
export function getConceptLabel(concept, preferredLang = 'en') {
  // Try preferred language
  if (concept.labels[preferredLang]) {
    return concept.labels[preferredLang];
  }
  // Fallback to German (common in these educational vocabularies)
  if (concept.labels.de) {
    return concept.labels.de;
  }
  // Fallback to English
  if (concept.labels.en) {
    return concept.labels.en;
  }
  // Fallback to first available label
  const firstLabel = Object.values(concept.labels)[0];
  if (firstLabel) {
    return firstLabel;
  }
  // Final fallback: extract from URI
  return extractLabelFromUri(concept.id);
}

/**
 * Extract a readable label from a URI
 * @param {string} uri - The URI to extract from
 * @returns {string} A human-readable label
 */
export function extractLabelFromUri(uri) {
  try {
    const url = new URL(uri);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1] || url.hash.replace('#', '');
    // Convert camelCase/snake_case to spaces and capitalize
    return lastPart
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return uri;
  }
}

/**
 * Extract labels from a concept's prefLabel (language-keyed object)
 * @param {any} prefLabel - The prefLabel object (e.g., { de: "Video", en: "Video" })
 * @returns {Record<string, string>} Labels by language
 */
function extractLabelsFromPrefLabel(prefLabel) {
  /** @type {Record<string, string>} */
  const labels = {};

  if (!prefLabel) return labels;

  if (typeof prefLabel === 'string') {
    labels.en = prefLabel;
    return labels;
  }

  if (typeof prefLabel === 'object') {
    // Handle { de: "Label", en: "Label" } format
    for (const [lang, value] of Object.entries(prefLabel)) {
      if (typeof value === 'string' && lang.length <= 5) {
        labels[lang] = value;
      }
    }
  }

  return labels;
}

/**
 * Recursively extract concepts from a nested structure
 * @param {any[]} items - Array of concept items
 * @param {number} level - Current hierarchy level
 * @param {string} [parentId] - Parent concept ID
 * @returns {SKOSConcept[]} Flattened array of concepts with hierarchy info
 */
function extractConceptsRecursively(items, level = 0, parentId = undefined) {
  /** @type {SKOSConcept[]} */
  const concepts = [];

  if (!Array.isArray(items)) return concepts;

  for (const item of items) {
    if (!item || !item.id) continue;

    // Extract labels
    const labels = extractLabelsFromPrefLabel(item.prefLabel);
    if (Object.keys(labels).length === 0) {
      labels.en = extractLabelFromUri(item.id);
    }

    /** @type {SKOSConcept} */
    const concept = {
      id: item.id,
      labels,
      level
    };

    // Add notation if available
    if (item.notation) {
      concept.notation = Array.isArray(item.notation) ? item.notation[0] : item.notation;
    }

    // Add parent reference if available
    if (parentId) {
      concept.parentId = parentId;
    }

    concepts.push(concept);

    // Recursively process narrower concepts
    if (item.narrower && Array.isArray(item.narrower)) {
      const children = extractConceptsRecursively(item.narrower, level + 1, item.id);
      concepts.push(...children);
    }
  }

  return concepts;
}

/**
 * Parse SKOS JSON response into normalized concepts
 * Handles both flat (hasTopConcept) and nested (narrower) structures
 * @param {any} data - The JSON response
 * @returns {SKOSConcept[]} Parsed concepts with hierarchy info
 */
function parseSKOSResponse(data) {
  // The data is a ConceptScheme with hasTopConcept containing concepts
  // Some vocabularies have flat structures, others have nested narrower

  if (!data) {
    console.warn('📚 SKOS: Empty response data');
    return [];
  }

  // Check for hasTopConcept (the standard structure for these vocabularies)
  if (data.hasTopConcept && Array.isArray(data.hasTopConcept)) {
    return extractConceptsRecursively(data.hasTopConcept, 0);
  }

  // Fallback: Check for @graph structure (older JSON-LD format)
  if (data['@graph'] && Array.isArray(data['@graph'])) {
    const concepts = [];
    for (const item of data['@graph']) {
      const type = item['@type'] || item.type;
      if (type && (type.includes('Concept') || type === 'skos:Concept')) {
        const labels = extractLabelsFromPrefLabel(item.prefLabel || item['skos:prefLabel']);
        if (Object.keys(labels).length === 0 && item['@id']) {
          labels.en = extractLabelFromUri(item['@id']);
        }
        concepts.push({
          id: item['@id'] || item.id,
          labels,
          level: 0
        });
      }
    }
    return concepts;
  }

  // Final fallback: try to parse as array
  if (Array.isArray(data)) {
    return extractConceptsRecursively(data, 0);
  }

  console.warn('📚 SKOS: Unrecognized data structure', Object.keys(data));
  return [];
}

/**
 * Load vocabulary from cache
 * @param {string} vocabKey - The vocabulary key
 * @returns {SKOSConcept[] | null} Cached concepts or null if expired/missing
 */
function loadFromCache(vocabKey) {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + vocabKey);
    if (!cached) return null;

    /** @type {CachedVocabulary} */
    const data = JSON.parse(cached);

    // Check if cache is expired
    if (Date.now() - data.timestamp > CACHE_DURATION_MS) {
      localStorage.removeItem(CACHE_PREFIX + vocabKey);
      return null;
    }

    return data.concepts;
  } catch {
    return null;
  }
}

/**
 * Save vocabulary to cache
 * @param {string} vocabKey - The vocabulary key
 * @param {SKOSConcept[]} concepts - The concepts to cache
 */
function saveToCache(vocabKey, concepts) {
  try {
    /** @type {CachedVocabulary} */
    const data = {
      timestamp: Date.now(),
      concepts
    };
    localStorage.setItem(CACHE_PREFIX + vocabKey, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to cache SKOS vocabulary:', e);
  }
}

/**
 * Fetch a SKOS vocabulary
 * @param {keyof typeof SKOS_VOCABULARIES} vocabKey - The vocabulary key
 * @returns {Promise<SKOSConcept[]>} The concepts
 */
export async function fetchVocabulary(vocabKey) {
  // Try cache first
  const cached = loadFromCache(vocabKey);
  if (cached) {
    return cached;
  }

  const url = SKOS_VOCABULARIES[vocabKey];
  if (!url) {
    throw new Error(`Unknown vocabulary: ${vocabKey}`);
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, application/ld+json'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const concepts = parseSKOSResponse(data);

    // Cache the result
    if (concepts.length > 0) {
      saveToCache(vocabKey, concepts);
    }

    return concepts;
  } catch (error) {
    console.error(`📚 SKOS: Failed to fetch ${vocabKey}:`, error);
    throw error;
  }
}

/**
 * Clear cached vocabulary
 * @param {keyof typeof SKOS_VOCABULARIES} [vocabKey] - Specific vocabulary to clear, or all if omitted
 */
export function clearVocabularyCache(vocabKey) {
  if (vocabKey) {
    localStorage.removeItem(CACHE_PREFIX + vocabKey);
  } else {
    for (const key of Object.keys(SKOS_VOCABULARIES)) {
      localStorage.removeItem(CACHE_PREFIX + key);
    }
  }
}

/**
 * Get concepts sorted alphabetically by label in the preferred language
 * Optionally preserves hierarchy (parent concepts before children)
 * @param {SKOSConcept[]} concepts - The concepts to sort
 * @param {string} preferredLang - Preferred language for sorting
 * @param {boolean} [preserveHierarchy=true] - Whether to keep hierarchy order
 * @returns {SKOSConcept[]} Sorted concepts
 */
export function sortConceptsByLabel(concepts, preferredLang = 'en', preserveHierarchy = true) {
  if (preserveHierarchy) {
    // Keep original order (which preserves hierarchy from parsing)
    return [...concepts];
  }

  return [...concepts].sort((a, b) => {
    const labelA = getConceptLabel(a, preferredLang).toLowerCase();
    const labelB = getConceptLabel(b, preferredLang).toLowerCase();
    return labelA.localeCompare(labelB, preferredLang);
  });
}

/**
 * Filter concepts by search term
 * @param {SKOSConcept[]} concepts - The concepts to filter
 * @param {string} searchTerm - The search term
 * @param {string} preferredLang - Preferred language for searching
 * @returns {SKOSConcept[]} Filtered concepts
 */
export function filterConcepts(concepts, searchTerm, preferredLang = 'en') {
  if (!searchTerm.trim()) return concepts;

  const term = searchTerm.toLowerCase().trim();

  // Find matching concepts
  const matchingIds = new Set();
  const parentIds = new Set();

  for (const concept of concepts) {
    // Search in preferred language label
    const label = getConceptLabel(concept, preferredLang).toLowerCase();
    let matches = label.includes(term);

    // Search in all labels
    if (!matches) {
      for (const langLabel of Object.values(concept.labels)) {
        if (langLabel.toLowerCase().includes(term)) {
          matches = true;
          break;
        }
      }
    }

    // Search in notation
    if (!matches && concept.notation?.toLowerCase().includes(term)) {
      matches = true;
    }

    if (matches) {
      matchingIds.add(concept.id);
      // Also include parents to maintain hierarchy context
      if (concept.parentId) {
        parentIds.add(concept.parentId);
      }
    }
  }

  // Include parent concepts for context
  for (const concept of concepts) {
    if (parentIds.has(concept.id)) {
      matchingIds.add(concept.id);
      if (concept.parentId) {
        parentIds.add(concept.parentId);
      }
    }
  }

  return concepts.filter((c) => matchingIds.has(c.id) || parentIds.has(c.id));
}

/**
 * Get only top-level concepts (no parents)
 * @param {SKOSConcept[]} concepts - The concepts
 * @returns {SKOSConcept[]} Top-level concepts only
 */
export function getTopLevelConcepts(concepts) {
  return concepts.filter((c) => c.level === 0 || !c.parentId);
}
