// Adaptive cover frame: a wrapper whose `aspect-ratio` follows the loaded
// image's natural orientation (clamped by the caller's policy) instead of
// center-cropping it into a fixed box. Used by the content cards and the
// resource detail hero — see `coverAspect.js` for the clamp families.
//
// Usage:
//   const cover = useAdaptiveAspect(clampCardAspect);
//   <div class="aspect-video ..." style:aspect-ratio={cover.ratio}>
//     <ImageWithFallback ... onload={cover.onload} />
//
// `ratio` is null until the image reports its size, so the wrapper's aspect
// class covers the loading window and the frame only changes once.

import { clampCardAspect } from '$lib/helpers/educational/coverAspect.js';

/**
 * @param {(width?: number, height?: number) => number} [clamp]
 * @returns {{ readonly ratio: number | null, onload: (event: Event) => void }}
 */
export function useAdaptiveAspect(clamp = clampCardAspect) {
  let ratio = $state(/** @type {number | null} */ (null));

  return {
    get ratio() {
      return ratio;
    },
    /** @param {Event} event */
    onload(event) {
      const img = /** @type {HTMLImageElement} */ (event.currentTarget);
      ratio = clamp(img.naturalWidth, img.naturalHeight);
    }
  };
}
