/**
 * Filename classification for interactive (webxdc) upload candidates.
 * Dependency-free on purpose: LicensedFileInput imports this statically to
 * decide whether to dynamically load the heavy pipeline in
 * `interactive-upload.js` (fflate, h5p wrapper).
 */

/**
 * Classify a filename for interactive handling.
 * @param {string} fileName
 * @returns {'package' | 'html' | null} 'package' auto-triggers the pipeline,
 *   'html' needs user confirmation first, null is not a candidate.
 */
export function isInteractiveCandidate(fileName) {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.h5p') || lower.endsWith('.xdc')) return 'package';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return null;
}
