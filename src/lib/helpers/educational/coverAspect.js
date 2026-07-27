/**
 * Adaptive cover-frame aspect for the resource detail view.
 *
 * The editorial hero presents the cover as a framed paper card. For
 * user-supplied images the frame adapts to the artwork's natural
 * orientation instead of cropping it (issue: 16:9 slides were center-cut
 * to 3:4). The ratio is clamped so extreme panoramas / strips can't
 * degenerate the layout — beyond the clamp, object-cover trims the rest.
 */

/** Tallest allowed frame — the classic typo-cover portrait. */
export const COVER_ASPECT_MIN = 3 / 4;

/** Widest allowed frame — presentation-slide landscape. */
export const COVER_ASPECT_MAX = 16 / 9;

/**
 * Clamp an image's natural dimensions to the allowed cover frame ratio.
 * Returns the CSS `aspect-ratio` number; portrait fallback when the
 * dimensions are unusable (not yet loaded, broken image, zero size).
 *
 * @param {number} [width]
 * @param {number} [height]
 * @returns {number}
 */
export function clampCoverAspect(width, height) {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) {
    return COVER_ASPECT_MIN;
  }
  return Math.min(COVER_ASPECT_MAX, Math.max(COVER_ASPECT_MIN, width / height));
}
