/** @type {Record<string, {w: number, h: number}>} */
const SIZE_PRESETS = {
  avatar_sm: { w: 64, h: 64 },
  avatar_md: { w: 96, h: 96 },
  avatar_lg: { w: 128, h: 128 },
  thumbnail: { w: 160, h: 160 },
  card: { w: 640, h: 320 },
  banner: { w: 1280, h: 720 },
  hero: { w: 1920, h: 1080 },
  emoji: { w: 48, h: 48 },
  content: { w: 960, h: 960 }
};

/**
 * Build a proxied image URL that routes through /api/image for resizing.
 * @param {string | undefined | null} src - Original image URL
 * @param {string | {w: number, h: number}} [size] - Preset name or custom dimensions
 * @param {number} [quality=80] - WebP quality (1-100)
 * @returns {string | undefined} Proxied URL, or original src if proxy is not applicable
 */
export function getProxiedImageUrl(src, size, quality = 80) {
  if (!src) return undefined;

  // Skip proxy for data URIs, SVGs, robohash (already small)
  if (src.startsWith('data:') || src.endsWith('.svg') || src.includes('robohash.org')) {
    return src;
  }

  // Only proxy http(s) URLs
  if (!src.startsWith('http://') && !src.startsWith('https://')) {
    return src;
  }

  if (!size) return src;

  const dims = typeof size === 'string' ? SIZE_PRESETS[size] : size;
  if (!dims) return src;

  const params = new URLSearchParams({
    url: src,
    w: String(dims.w),
    h: String(dims.h),
    q: String(quality)
  });

  return `/api/image?${params.toString()}`;
}
