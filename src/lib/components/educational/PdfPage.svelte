<!--
  PdfPage
  Renders a single PDF page to a <canvas>, sized to fit the parent's width.
  Re-renders on container resize so the page reflows when the viewport changes
  (e.g., mobile rotation, sidebar collapse). Skips rendering when the parent
  is not in layout yet (clientWidth ≤ 0) — the ResizeObserver picks it up
  once layout settles.

  The parent (PdfInlineViewer) is responsible for loading the document.
-->

<script>
  /**
   * @typedef {Object} Props
   * @property {any} pdfDoc      pdf.js PDFDocumentProxy
   * @property {number} pageNum  1-based page number
   */

  /** @type {Props} */
  let { pdfDoc, pageNum } = $props();

  /** @type {HTMLCanvasElement | undefined} */
  let canvasEl;

  $effect(() => {
    if (!pdfDoc || !canvasEl) return;
    const doc = pdfDoc;
    const num = pageNum;
    const canvas = canvasEl;
    let cancelled = false;
    /** @type {any} */
    let renderTask;

    async function doRender() {
      try {
        const containerWidth = canvas.parentElement?.clientWidth ?? 0;
        if (containerWidth <= 0) return; // not in layout yet; ResizeObserver will retrigger
        if (cancelled) return;

        const page = await doc.getPage(num);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.max(0.1, (containerWidth - 16) / baseViewport.width);
        const viewport = page.getViewport({ scale });

        if (Math.abs(canvas.width - viewport.width) < 1 && canvas.width > 0) {
          // Already at this size — skip the redundant render
          return;
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        renderTask?.cancel?.();
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
      } catch (e) {
        if (!cancelled && /** @type {any} */ (e)?.name !== 'RenderingCancelledException') {
          console.warn('PdfPage render failed', e);
        }
      }
    }

    doRender();

    // Re-render on container resize (mobile rotation, sidebar collapse, …)
    const ro = new ResizeObserver(() => {
      if (cancelled) return;
      doRender();
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
      ro.disconnect();
    };
  });
</script>

<canvas
  bind:this={canvasEl}
  class="mb-2 block w-full bg-base-100 shadow"
  aria-label="Page {pageNum}"
></canvas>
