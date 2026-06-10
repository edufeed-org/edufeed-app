<!--
  MarkdownRenderer Component
  Safely renders markdown content with XSS protection.
  Converts bare nostr: mentions to app links and renders nostr: protocol hrefs.
  Mounts a per-image BodyImageLicense badge for every <img> in the output.
-->

<script>
  import { mount, unmount } from 'svelte';
  import { renderMarkdown } from '$lib/helpers/markdown.js';
  import BodyImageLicense from './BodyImageLicense.svelte';

  let { content = '', class: className = 'prose prose-lg max-w-none' } = $props();

  let html = $derived(renderMarkdown(content));

  /**
   * Svelte action: walks the rendered DOM for <img> tags, wraps each in a
   * <figure>, and mounts a BodyImageLicense component that looks up the
   * license event by SHA-256 (derived from the URL) and renders a watermark
   * + figcaption attribution. Re-runs on content change via MutationObserver.
   *
   * @param {HTMLElement} node
   */
  function bodyImageLicenseAction(node) {
    /** @type {Array<{ instance: any, slot: HTMLElement }>} */
    let mounted = [];

    function teardown() {
      for (const { instance } of mounted) {
        try {
          unmount(instance);
        } catch {
          /* component already torn down */
        }
      }
      mounted = [];
    }

    function wire() {
      const imgs = node.querySelectorAll('img:not([data-body-license-wired])');
      for (const img of imgs) {
        const el = /** @type {HTMLImageElement} */ (img);
        el.dataset.bodyLicenseWired = 'true';

        // Wrap the <img> in a <figure> so the watermark anchors via position: relative
        // and the <figcaption> from BodyImageLicense is a direct child of figure.
        const figure = document.createElement('figure');
        figure.className = 'relative';
        const parent = el.parentNode;
        if (!parent) continue;
        parent.insertBefore(figure, el);
        figure.appendChild(el);

        // Mount the component directly into figure so its watermark span +
        // figcaption become immediate children (figcaption parent semantics).
        const instance = mount(BodyImageLicense, {
          target: figure,
          props: { src: el.src }
        });
        mounted.push({ instance, slot: figure });
      }
    }

    wire();

    // Re-wire when content changes (e.g., write/preview toggle in the editor).
    // We must exclude DOM mutations caused by the action itself (insertion of
    // <figure>, plus the watermark + figcaption mounted reactively by
    // BodyImageLicense). Easiest signal: any node inside a wired <figure>
    // — or the figure itself — is ours.
    const observer = new MutationObserver((mutations) => {
      const meaningful = mutations.some((mu) =>
        Array.from(mu.addedNodes).some((n) => {
          if (n.nodeType !== 1) return false;
          const elNode = /** @type {Element} */ (n);
          if (elNode.tagName === 'FIGURE') return false;
          // Reject anything mounted inside (or as a sibling of) a wired figure.
          if (elNode.closest?.('figure > [data-body-license-wired]')) return false;
          if (elNode.parentElement?.matches?.('figure')) return false;
          return true;
        })
      );
      if (meaningful) wire();
    });
    observer.observe(node, { childList: true, subtree: true });

    return {
      destroy() {
        observer.disconnect();
        teardown();
      }
    };
  }
</script>

<div class={className} use:bodyImageLicenseAction>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: sanitized with DOMPurify -->
  {@html html}
</div>
