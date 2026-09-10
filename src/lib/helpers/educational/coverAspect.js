/**
 * Adaptive cover-frame aspect ratios.
 *
 * Cover frames follow the artwork's natural orientation instead of
 * center-cropping it into a fixed box (issue: 16:9 slides were center-cut
 * to 3:4 on the detail page; a 1:1 illustration lost its top and bottom in
 * the 2:1 card frame). Each frame family clamps the ratio so extreme
 * panoramas / strips can't degenerate the layout — beyond the clamp,
 * object-cover trims the rest.
 *
 * Two families:
 * - detail view: the editorial paper card may go as tall as the classic
 *   3:4 typo-cover portrait.
 * - feed/grid cards: never taller than square, so a portrait cover cannot
 *   blow up a feed entry or a grid row.
 */

/** Tallest allowed detail frame — the classic typo-cover portrait. */
export const COVER_ASPECT_MIN = 3 / 4;

/** Widest allowed frame (both families) — presentation-slide landscape. */
export const COVER_ASPECT_MAX = 16 / 9;

/** Tallest allowed card frame — square. */
export const CARD_ASPECT_MIN = 1;

/** Widest allowed card frame — same landscape ceiling as the detail view. */
export const CARD_ASPECT_MAX = COVER_ASPECT_MAX;

/**
 * @param {number | undefined} width
 * @param {number | undefined} height
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampAspect(width, height, min, max, fallback) {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, width / height));
}

/**
 * Clamp an image's natural dimensions to the detail-view cover frame ratio.
 * Returns the CSS `aspect-ratio` number; portrait fallback when the
 * dimensions are unusable (not yet loaded, broken image, zero size).
 *
 * @param {number} [width]
 * @param {number} [height]
 * @returns {number}
 */
export function clampCoverAspect(width, height) {
  return clampAspect(width, height, COVER_ASPECT_MIN, COVER_ASPECT_MAX, COVER_ASPECT_MIN);
}

/**
 * Clamp an image's natural dimensions to the feed/grid card frame ratio.
 * Falls back to the widest frame — the closest match to the fixed banner the
 * cards used to render — when the dimensions are unusable.
 *
 * @param {number} [width]
 * @param {number} [height]
 * @returns {number}
 */
export function clampCardAspect(width, height) {
  return clampAspect(width, height, CARD_ASPECT_MIN, CARD_ASPECT_MAX, CARD_ASPECT_MAX);
}
