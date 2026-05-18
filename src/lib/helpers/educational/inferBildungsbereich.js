import {
  BILDUNGSBEREICH_KEYS,
  inferBildungsbereichFromEducationalLevels
} from './bildungsbereich.js';
import { BILDUNGSBEREICH_NAMESPACE_IRI } from './bildungsbereichNamespace.js';

/**
 * Infer a Bildungsbereich key from an existing kind-30142 event.
 *
 * Priority:
 *   1. NIP-32 `l` tag with namespace = BILDUNGSBEREICH_NAMESPACE_IRI (Spec B+)
 *   2. educationalLevel URI inference (legacy events without the `l` tag)
 *   3. undefined
 *
 * @param {{ tags: string[][] }} event
 * @returns {string | undefined}
 */
export function inferBildungsbereich(event) {
  const tags = event?.tags || [];

  for (const t of tags) {
    if (t[0] === 'l' && t[2] === BILDUNGSBEREICH_NAMESPACE_IRI && t[1]) {
      if (BILDUNGSBEREICH_KEYS.includes(/** @type any */ (t[1]))) {
        return t[1];
      }
    }
  }

  const levels = tags.filter((t) => t[0] === 'educationalLevel:id').map((t) => t[1]);
  return inferBildungsbereichFromEducationalLevels(levels);
}
