<!--
  Test stub for PdfInlineViewer — used by EncodingPreview.test.js to assert
  the parent passes the right `src` and `name` without booting pdf.js (which
  needs a real Web Worker + canvas, neither available in jsdom).
-->
<script>
  /** @type {{ src: string, name?: string }} */
  let { src, name = '' } = $props();
</script>

<div data-testid="pdf-viewer-stub" data-src={src} data-name={name}></div>
