/**
 * EKW (Einfach Konkret Wirksam) namespace declaration.
 *
 * Used as the prefix for kind-30142 tag keys for facets that are EKW-specific
 * and have no AMB equivalent (e.g. `ext:ekw:gradeLevel`, `ext:ekw:schoolType`,
 * `ext:ekw:didacticConcept`, `ext:ekw:method`, `ext:ekw:methodOther`,
 * `ext:ekw:bibleReference`).
 *
 * The IRI is symbolic for v1 — no hosted JSON-LD context document is served.
 */

/** Namespace IRI used in JSON-LD contexts and documentation. */
export const EKW_NAMESPACE_IRI = 'https://edufeed.org/ns/ekw#';

/**
 * Tag-key prefix on kind-30142 events. Follows the NIP-AMB `ext:<ns>:` shape
 * for forward-compatible extension metadata. The legacy unprefixed `ekw:`
 * shape (pre-migration) is still recognized on read for backward compat.
 */
export const EKW_TAG_PREFIX = 'ext:ekw:';

/** Legacy unprefixed shape — read-only fallback during migration. */
export const EKW_LEGACY_TAG_PREFIX = 'ekw:';

/**
 * Reverse-DNS namespace for Konfi (confirmation-program) facets, used as the
 * `ns` segment of the NIP-AMB `ext:<ns>:<facet>[:sub]` grammar.
 *
 * The legacy hand-appended shape put `konfi` in the FACET slot instead
 * (`ext:ekw:konfi:<slug>:id`), which is an illegal 5-segment key — `ns` and
 * `facet` MUST NOT contain `:`. Lifting `konfi` into its own namespace fixes
 * the conformance bug: facets serialize as `ext:org.edufeed.ekw.konfi:<slug>:id`.
 */
export const EKW_KONFI_NS = 'org.edufeed.ekw.konfi';
