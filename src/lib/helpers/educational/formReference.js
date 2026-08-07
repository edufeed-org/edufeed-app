/**
 * Small pure helpers about the form↔resource seam: resolving the `d` tag for
 * a kind-30142 resource published from a template-form submission, and
 * reading back the informative form back-reference from a resource event.
 */

/**
 * @typedef {Object} SelectedConcept
 * @property {string} id - external URI of the concept
 * @property {string} nostrCoord - addressable Concept coordinate "<kind>:<pubkey>:<d>" (kind 39738 under NIP-VOCAB v0.2)
 * @property {string} relay
 * @property {Record<string, string>} labels - { [lang]: label }
 */

/**
 * Resolve the identifier (`d` tag) for a kind-30142 resource being published
 * from a template-form submission. The AMB→Nostr conversion may emit its own
 * `['d', …]` tag (e.g. an `amb:id`-mapped `url` field) — the caller must NOT
 * blindly overwrite it with a fresh UUID, or the user-entered identifier is
 * silently dropped (lands on no tag at all).
 *
 * - Edit mode: keep the resource's existing `d` tag for addressable
 *   stability, ignoring any emitted `d` (the url field isn't the identity
 *   source once a resource already exists).
 * - Create mode: use the emitted `d` tag when the form produced one, else
 *   generate a fresh identifier.
 *
 * @param {Object} args
 * @param {boolean} args.isEditMode
 * @param {string} [args.existingDTag] - resource's current `d` tag (edit mode)
 * @param {string} [args.emittedD] - `d` tag value emitted by the converter (create mode)
 * @param {() => string} [args.generateId] - defaults to crypto.randomUUID
 * @returns {string}
 */
export function resolveResourceDTag({
  isEditMode,
  existingDTag,
  emittedD,
  generateId = () => crypto.randomUUID()
}) {
  if (isEditMode) return existingDTag || generateId();
  return emittedD || generateId();
}

/**
 * Extract the informative form back-reference from a resource event.
 *
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {{ address: string, relay: string } | null}
 */
export function getFormReferenceFromResource(event) {
  for (const t of event.tags) {
    if (t[0] === 'a' && t[3] === 'form' && t[1]?.startsWith('30168:')) {
      return { address: t[1], relay: t[2] || '' };
    }
  }
  return null;
}
