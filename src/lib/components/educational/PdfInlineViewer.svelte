<!--
  PdfInlineViewer
  Renders a PDF inline using pdf.js (pdfjs-dist), so PDFs preview on every
  platform — including mobile Safari and Android Chrome where the native
  <object type="application/pdf"> embed renders blank.

  - Lazy-imports pdfjs-dist on the first visibility hit, so non-PDF pages
    pay zero bundle cost AND so duplicate-mounted hidden subtrees (e.g.,
    responsive layouts that render both the mobile and desktop variant
    of the same page) never load anything.
  - One <canvas> per page in a vertically scrolling 80vh-max container.
  - Loading and error states render inside a frame that grows up to 80vh
    so the layout doesn't shift while the document loads.
-->

<script>
  import PdfPage from './PdfPage.svelte';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * @typedef {Object} Props
   * @property {string} src       Direct URL to the PDF (must already be https)
   * @property {string} [name]    Filename, used as the container's aria-label
   */

  /** @type {Props} */
  let { src, name = '' } = $props();

  /** @type {'idle' | 'loading' | 'ready' | 'error'} */
  let status = $state('idle');
  let errorMessage = $state('');
  let pageCount = $state(0);
  /** @type {any} */
  let pdfDoc = $state(null);

  /** @type {HTMLDivElement | undefined} */
  let rootEl;

  $effect(() => {
    const url = src;
    if (!rootEl) return;
    let cancelled = false;
    /** @type {any} */
    let doc = null;
    let started = false;

    status = 'idle';
    errorMessage = '';
    pageCount = 0;
    pdfDoc = null;

    async function loadPdf() {
      status = 'loading';
      try {
        const pdfjsLib = await import('pdfjs-dist');
        const workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

        if (cancelled) return;

        const loadingTask = pdfjsLib.getDocument({ url });
        doc = await loadingTask.promise;

        if (cancelled) {
          doc?.destroy?.();
          return;
        }

        pdfDoc = doc;
        pageCount = doc.numPages;
        status = 'ready';
      } catch (e) {
        if (cancelled) return;
        errorMessage = /** @type {any} */ (e)?.message ?? 'Failed to load PDF';
        status = 'error';
      }
    }

    // Lazy-load on first visibility — skips hidden subtrees AND defers
    // off-screen PDFs until the user scrolls them into view.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started) {
            started = true;
            io.disconnect();
            loadPdf();
            break;
          }
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(rootEl);

    return () => {
      cancelled = true;
      io.disconnect();
      doc?.destroy?.();
      pdfDoc = null;
    };
  });

  const pageNumbers = $derived(
    pageCount > 0 ? Array.from({ length: pageCount }, (_, i) => i + 1) : []
  );
</script>

<div bind:this={rootEl} class="w-full">
  {#if status === 'idle' || status === 'loading'}
    <div
      class="flex h-[40vh] w-full items-center justify-center rounded-lg border border-base-300 bg-base-200/30"
      aria-live="polite"
      aria-busy={status === 'loading'}
    >
      {#if status === 'loading'}
        <span class="loading loading-lg loading-spinner text-primary"></span>
      {/if}
    </div>
  {:else if status === 'error'}
    <div
      class="flex flex-col items-start gap-2 rounded-lg border border-base-300 bg-base-200/30 p-4 text-sm"
    >
      <span class="font-medium text-base-content">{name}</span>
      <span class="text-base-content/70">{errorMessage}</span>
      <!-- eslint-disable svelte/no-navigation-without-resolve -- external: Blossom file URL -->
      <a href={src} target="_blank" rel="noopener noreferrer" class="link link-primary">
        {m.amb_resource_open_pdf_inline_fallback()}
      </a>
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    </div>
  {:else}
    <div
      class="max-h-[80vh] w-full overflow-y-auto rounded-lg border border-base-300 bg-base-200/30 p-2"
      aria-label={name ? `PDF: ${name}` : 'PDF'}
      data-pdf-viewer-src={src}
    >
      {#each pageNumbers as pageNum (pageNum)}
        <PdfPage {pdfDoc} {pageNum} />
      {/each}
    </div>
  {/if}
</div>
