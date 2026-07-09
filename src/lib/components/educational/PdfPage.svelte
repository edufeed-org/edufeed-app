<!--
  PdfPage
  Renders a single PDF page to a <canvas>, sized to fit the parent's width,
  plus a pdf.js text layer so page text is selectable (enables NIP-84
  highlighting and copy/paste). Re-renders on container resize so the page
  reflows when the viewport changes (e.g., mobile rotation, sidebar
  collapse). Skips rendering when the parent is not in layout yet
  (clientWidth ≤ 0) — the ResizeObserver picks it up once layout settles.

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
  /** @type {HTMLDivElement | undefined} */
  let textLayerEl;

  $effect(() => {
    if (!pdfDoc || !canvasEl) return;
    const doc = pdfDoc;
    const num = pageNum;
    const canvas = canvasEl;
    let cancelled = false;
    /** @type {any} */
    let renderTask;
    /** @type {any} */
    let textLayerTask;

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

        // Selectable text layer over the canvas. pdf.js v4 positions the
        // spans via the container's --scale-factor CSS variable.
        if (cancelled || !textLayerEl) return;
        const { TextLayer } = await import('pdfjs-dist');
        if (cancelled) return;
        // eslint-disable-next-line svelte/no-dom-manipulating -- container is rendered empty by Svelte and owned exclusively by pdf.js
        textLayerEl.replaceChildren();
        textLayerEl.style.setProperty('--scale-factor', String(scale));
        textLayerTask?.cancel?.();
        textLayerTask = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textLayerEl,
          viewport
        });
        await textLayerTask.render();
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
      textLayerTask?.cancel?.();
      ro.disconnect();
    };
  });
</script>

<div class="pdf-page relative mb-2">
  <canvas bind:this={canvasEl} class="block w-full bg-base-100 shadow" aria-label="Page {pageNum}"
  ></canvas>
  <div bind:this={textLayerEl} class="pdf-text-layer" aria-hidden="false"></div>
</div>

<style>
  /* Minimal pdf.js text-layer styles (subset of pdf_viewer.css): transparent
     glyphs absolutely positioned over the canvas; selection stays visible. */
  .pdf-text-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    line-height: 1;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    caret-color: transparent;
  }

  .pdf-text-layer :global(span),
  .pdf-text-layer :global(br) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
  }

  .pdf-text-layer :global(::selection) {
    background: oklch(65% 0.15 250 / 0.35);
  }
</style>
