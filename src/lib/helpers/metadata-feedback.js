/**
 * Metadata feedback helpers.
 * Pure function that renders the human-readable NIP-17 DM body sent to a
 * resource author when a viewer flags wrong metadata on a kind 30142 event.
 */

/**
 * Build the templated metadata-feedback message body.
 * @param {{ title: string, url: string, fieldLabel: string, comment: string }} params
 * @returns {string}
 */
export function buildMetadataFeedbackMessage({ title, url, fieldLabel, comment }) {
  const resource = title ? `${title} — ${url}` : url;
  return (
    '[Metadata feedback via edufeed]\n' +
    `Resource: ${resource}\n` +
    `Field flagged: ${fieldLabel}\n` +
    `Comment: ${comment.trim()}`
  );
}
