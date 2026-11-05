/**
 * Server-side PDF page-1 → WebP thumbnail rendering, plus the page count.
 *
 * pdf.js (legacy Node build) + @napi-rs/canvas render the first page,
 * sharp encodes the WebP. Heavy imports are lazy so the module costs
 * nothing until the first thumbnail request.
 *
 * The page count comes back from the same parse (#57): the document is already
 * open, so `numPages` is free here and would otherwise cost a second fetch and
 * a second parse of the same file.
 */

/** Target thumbnail width in CSS pixels. */
export const THUMBNAIL_WIDTH = 400;

/** pdf.js parses and canvas renders are CPU- and memory-heavy: at most this many at once. */
const MAX_PDF_JOBS = 2;
let runningPdfJobs = 0;

/**
 * Claim one of the shared PDF job slots (`/api/pdf-thumbnail`, `/api/pdf-info`).
 *
 * @returns {(() => void) | null} a release function, or null when all slots are taken
 */
export function tryAcquirePdfSlot() {
  if (runningPdfJobs >= MAX_PDF_JOBS) return null;
  runningPdfJobs++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runningPdfJobs--;
  };
}

/** The answer while every PDF job slot is taken. */
export function pdfBusyResponse() {
  return new Response('PDF processing busy, retry shortly', {
    status: 503,
    headers: { 'retry-after': '5' }
  });
}

/**
 * Render the first page of a PDF to a WebP thumbnail buffer.
 *
 * @param {Uint8Array} data - the PDF bytes
 * @param {number} [width] - target width; height follows the page ratio
 * @returns {Promise<{ webp: Buffer, numPages: number }>}
 * @throws when the document cannot be parsed or rendered
 */
export async function renderPdfThumbnail(data, width = THUMBNAIL_WIDTH) {
  const [{ createCanvas }, pdfjs, { default: sharp }] = await Promise.all([
    import('@napi-rs/canvas'),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('sharp')
  ]);

  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const viewport = page.getViewport({ scale });

    // A page with an absurd aspect ratio must not allocate a giant canvas; the
    // top of the page is all a cover needs.
    const height = Math.min(Math.ceil(viewport.height), width * 4);
    const canvas = createCanvas(Math.ceil(viewport.width), height);
    const ctx = canvas.getContext('2d');
    // White page background — PDFs assume an opaque white canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: /** @type {any} */ (ctx), viewport }).promise;

    const png = canvas.toBuffer('image/png');
    const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
    return { webp, numPages: doc.numPages };
  } finally {
    doc.destroy().catch(() => {});
  }
}

/**
 * Read a PDF's page count without rendering anything.
 *
 * Only for the case where no thumbnail was ever rendered for this file — the
 * thumbnail path returns the count from its own parse. Skips canvas and sharp
 * entirely.
 *
 * @param {Uint8Array} data - the PDF bytes
 * @returns {Promise<number>}
 * @throws when the document cannot be parsed
 */
export async function readPdfPageCount(data) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  try {
    return doc.numPages;
  } finally {
    doc.destroy().catch(() => {});
  }
}
