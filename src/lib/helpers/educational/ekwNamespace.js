/**
 * EKW (Einfach Konkret Wirksam) namespace declaration.
 *
 * Used as the prefix for kind-30142 tag keys for facets that are EKW-specific
 * and have no AMB equivalent (e.g. `ekw:gradeLevel`, `ekw:schoolType`,
 * `ekw:didacticConcept`, `ekw:method`, `ekw:methodOther`,
 * `ekw:bibleReference`).
 *
 * The IRI is symbolic for v1 — no hosted JSON-LD context document is served.
 */

/** Namespace IRI used in JSON-LD contexts and documentation. */
export const EKW_NAMESPACE_IRI = 'https://edufeed.org/ns/ekw#';

/** Tag-key prefix on kind-30142 events. Matches the AMB convention (`amb:*`). */
export const EKW_TAG_PREFIX = 'ekw:';
