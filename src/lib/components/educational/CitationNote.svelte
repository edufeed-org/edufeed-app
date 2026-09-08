<!--
  CitationNote — "cite this resource" block for AMB resources.
  Shows the ready-made TULLU attribution (see helpers/educational/citation.js)
  with license + origin linked, and copies it as rich text (text/html) plus a
  plain-text fallback with the URLs written out.
-->

<script>
  import * as m from '$lib/paraglide/messages.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { TULLU_RULE_URL } from '$lib/helpers/educational/citation.js';
  import { CopyIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {import('$lib/helpers/educational/citation.js').Citation} citation
   */

  /** @type {Props} */
  let { citation } = $props();

  /** Rich copy (HTML + plain) where supported, plain text otherwise. */
  async function copyCitation() {
    try {
      let copied = false;
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': new Blob([citation.text], { type: 'text/plain' }),
              'text/html': new Blob([citation.html], { type: 'text/html' })
            })
          ]);
          copied = true;
        } catch {
          // e.g. text/html not accepted by this browser — fall through to plain text
        }
      }
      if (!copied) await navigator.clipboard.writeText(citation.text);
      showToast(m.amb_resource_citation_copied(), 'success');
    } catch (err) {
      console.error('Failed to copy citation:', err);
      showToast(m.amb_resource_citation_copy_failed(), 'error');
    }
  }
</script>

<div class="ed-cite" data-testid="citation-note">
  <h4 class="ed-cite-head">{m.amb_resource_citation_heading()}</h4>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: helper escapes every user-supplied value -->
  <p class="ed-cite-text">{@html citation.html}</p>
  <div class="ed-cite-actions">
    <button type="button" class="btn btn-sm btn-primary" onclick={copyCitation}>
      <CopyIcon class_="w-4 h-4" title="" />
      {m.amb_resource_citation_copy()}
    </button>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external: TULLU rule explainer -->
    <a class="ed-cite-hint" href={TULLU_RULE_URL} target="_blank" rel="noopener noreferrer">
      {m.amb_resource_citation_hint()}
    </a>
  </div>
</div>

<style>
  .ed-cite {
    align-self: stretch;
    margin-top: 6px;
    padding-top: 14px;
    border-top: 1px dashed color-mix(in oklch, var(--color-primary) 35%, transparent);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ed-cite-head {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--c-ink-soft);
  }
  .ed-cite-text {
    font-size: 14px;
    line-height: 1.5;
    color: var(--c-ink);
    overflow-wrap: anywhere;
  }
  .ed-cite-text :global(a) {
    color: var(--color-primary);
    font-weight: 600;
    text-decoration: underline;
    text-decoration-color: color-mix(in oklch, var(--color-primary) 40%, transparent);
  }
  .ed-cite-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }
  .ed-cite-hint {
    font-size: 12px;
    color: var(--c-ink-soft);
    text-decoration: underline;
  }
  .ed-cite-hint:hover {
    color: var(--color-primary);
  }
</style>
