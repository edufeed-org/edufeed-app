/**
 * Educational Helpers - Main Export
 *
 * Exports both library-ready transformation functions and app-specific helpers.
 */

// Library-ready transformation functions (can be extracted to npm package)
export {
  unflattenNostrTagsToAMB,
  flattenAMBToNostrTags,
  getTagValue,
  getTagValues,
  getNestedTagValues,
  getTagsByPrefix
} from './ambTransform.js';

// App-specific helper functions
export {
  getAMBName,
  getAMBDescription,
  getAMBImage,
  getAMBTypes,
  getAMBLearningResourceTypes,
  getAMBSubjects,
  getAMBEducationalLevels,
  getAMBLicense,
  isAMBFree,
  getAMBKeywords,
  getAMBLanguages,
  getAMBPublishedDate,
  getAMBCreatorNames,
  getAMBResourceURLs,
  getAMBPrimaryURL,
  getAMBIdentifier,
  getAMBExternalUrl,
  getAMBHasPart,
  getAMBIsPartOf,
  formatAMBResource
} from './ambHelpers.js';

// JSON-LD builder for SEO/structured data
export { buildAMBJsonLd } from './ambJsonLd.js';
