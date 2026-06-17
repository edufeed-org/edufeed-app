/**
 * Cover-color persistence for AMB (kind 30142) resources.
 *
 * The generated typographic cover (TypoCover) derives its hue from the
 * resource identifier by default. When a user picks a hue in the wizard we
 * persist it as a single `cover_color` tag and read it back here. Only the
 * hue (0–359) is stored — the cover gradient fixes chroma + lightness.
 */
import { getTagValue } from 'applesauce-core/helpers';

/** Tag name carrying the user-chosen cover hue. */
export const COVER_COLOR_TAG = 'cover_color';

/** Preset hues offered as swatches, spread across the wheel. */
export const COVER_HUE_PRESETS = [10, 45, 90, 150, 190, 230, 280, 320];

/**
 * Parse a value into an integer hue in [0, 359], or null if invalid.
 * @param {unknown} value
 * @returns {number | null}
 */
export function clampHue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 359) return null;
  return n;
}

/**
 * Read the cover hue from an event/resource, or null when unset/invalid.
 * @param {{ kind: number, tags: string[][], content: string } | null | undefined} event
 * @returns {number | null}
 */
export function getCoverHue(event) {
  if (!event || !Array.isArray(event.tags)) return null;
  return clampHue(getTagValue(event, COVER_COLOR_TAG));
}

/**
 * Push a `["cover_color", "<hue>"]` tag when the hue is valid. Mutates `tags`.
 * @param {string[][]} tags
 * @param {number | null | undefined} coverHue
 * @returns {void}
 */
export function appendCoverColorTag(tags, coverHue) {
  const hue = clampHue(coverHue);
  if (hue !== null) tags.push([COVER_COLOR_TAG, String(hue)]);
}
