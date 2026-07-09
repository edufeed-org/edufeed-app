/**
 * Server-side PDF page-1 → WebP thumbnail rendering.
 *
 * pdf.js (legacy Node build) + @napi-rs/canvas render the first page,
 * sharp encodes the WebP. Heavy imports are lazy so the module costs
 * nothing until the first thumbnail request.
 */

/** Target thumbnail width in CSS pixels. */
export const THUMBNAIL_WIDTH = 400;

/**
 * Render the first page of a PDF to a WebP thumbnail buffer.
 *
 * @param {Uint8Array} data - the PDF bytes
 * @param {number} [width] - target width; height follows the page ratio
 * @returns {Promise<Buffer>} WebP bytes
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

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    // White page background — PDFs assume an opaque white canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: /** @type {any} */ (ctx), viewport }).promise;

    const png = canvas.toBuffer('image/png');
    return await sharp(png).webp({ quality: 80 }).toBuffer();
  } finally {
    doc.destroy().catch(() => {});
  }
}
