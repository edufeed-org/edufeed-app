/**
 * Pixel dimensions of an image file as the NIP-94 `dim` string ("WxH"),
 * for the imeta tag written next to an uploaded body image. Resolves to
 * undefined for anything the browser cannot decode (non-images, SSR).
 * @param {Blob | File} file
 * @returns {Promise<string | undefined>}
 */
export async function readImageDimensions(file) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return undefined;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const dim = `${bitmap.width}x${bitmap.height}`;
      bitmap.close?.();
      return bitmap.width && bitmap.height ? dim : undefined;
    } catch {
      // fall through to the <img> decode below
    }
  }
  if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') return undefined;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(
        img.naturalWidth && img.naturalHeight
          ? `${img.naturalWidth}x${img.naturalHeight}`
          : undefined
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    img.src = url;
  });
}
