/**
 * QR decoding for the profile scanner (issue 9f7816e3).
 *
 * Two engines behind one `decode(imageData)`: the browser's BarcodeDetector
 * (Chrome/Edge on Android and desktop, Safari 17+) when it lists `qr_code`,
 * otherwise jsQR, loaded lazily so the ~250 KB decoder only ships to
 * browsers that need it and never enters a route's static graph.
 *
 * Everything here takes `ImageData`: the scanner draws the current video
 * frame (or a picked image) onto a canvas and hands the pixels over, which
 * is what jsQR needs anyway and what BarcodeDetector accepts as an
 * ImageBitmapSource.
 */

/**
 * @typedef {object} QrDecoder
 * @property {'native' | 'jsqr'} engine
 * @property {(frame: ImageData) => Promise<string | null>} decode
 */

/**
 * @param {object} [deps] test seams; the defaults read the browser globals
 * @param {any} [deps.BarcodeDetector] the global constructor, if any
 * @param {() => Promise<any>} [deps.loadJsQr] resolves to the jsQR function
 * @returns {Promise<QrDecoder>}
 */
export async function createQrDecoder(deps = {}) {
  const Detector =
    'BarcodeDetector' in deps
      ? deps.BarcodeDetector
      : typeof globalThis !== 'undefined'
        ? /** @type {any} */ (globalThis).BarcodeDetector
        : undefined;
  const loadJsQr = deps.loadJsQr ?? (() => import('jsqr').then((mod) => mod.default ?? mod));

  if (Detector && (await supportsQr(Detector))) {
    const detector = new Detector({ formats: ['qr_code'] });
    return {
      engine: 'native',
      async decode(frame) {
        try {
          const codes = await detector.detect(frame);
          return codes?.[0]?.rawValue ?? null;
        } catch {
          return null;
        }
      }
    };
  }

  const jsQR = await loadJsQr();
  return {
    engine: 'jsqr',
    async decode(frame) {
      const code = jsQR(frame.data, frame.width, frame.height, {
        inversionAttempts: 'dontInvert'
      });
      return code?.data ?? null;
    }
  };
}

/** @param {any} Detector */
async function supportsQr(Detector) {
  try {
    const formats = await Detector.getSupportedFormats?.();
    return Array.isArray(formats) && formats.includes('qr_code');
  } catch {
    return false;
  }
}

/**
 * Pixels of the video's current frame, scaled so the longer side is at most
 * `maxSide` — jsQR gets quadratically slower with size, and a 640 px frame
 * reads a phone-screen QR fine.
 *
 * @param {HTMLVideoElement} video
 * @param {HTMLCanvasElement} canvas scratch canvas owned by the caller
 * @param {number} [maxSide]
 * @returns {ImageData | null} null while the video has no frame yet
 */
export function grabVideoFrame(video, canvas, maxSide = 640) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  return drawToImageData(video, w, h, canvas, maxSide);
}

/**
 * Pixels of a picked image file (the "choose a picture" fallback).
 * @param {Blob} file
 * @param {HTMLCanvasElement} canvas
 * @param {number} [maxSide]
 * @returns {Promise<ImageData | null>}
 */
export async function imageFileToImageData(file, canvas, maxSide = 1024) {
  const bitmap = await createImageBitmap(file);
  try {
    return drawToImageData(bitmap, bitmap.width, bitmap.height, canvas, maxSide);
  } finally {
    bitmap.close?.();
  }
}

/**
 * @param {CanvasImageSource} source
 * @param {number} w
 * @param {number} h
 * @param {HTMLCanvasElement} canvas
 * @param {number} maxSide
 */
function drawToImageData(source, w, h, canvas, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
