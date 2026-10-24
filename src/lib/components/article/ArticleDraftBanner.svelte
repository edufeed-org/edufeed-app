<!--
  ArticleDraftBanner — notice on a NIP-23 draft (kind 30024) preview page.
  Everyone with the link sees that this is unpublished; the author can
  publish it from here (publishDraft: same d-tag, kind 30023, draft retired).
-->

<script>
  import * as m from '$lib/paraglide/messages.js';

  /**
   * @typedef {Object} Props
   * @property {boolean} isAuthor
   * @property {() => void} onPublish
   * @property {boolean} [publishing]
   */

  /** @type {Props} */
  let { isAuthor, onPublish, publishing = false } = $props();
</script>

<div
  class="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-warning/60 bg-warning/10 px-4 py-3"
  role="status"
  data-testid="article-draft-banner"
>
  <span class="badge badge-warning">{m.article_draft_banner_title()}</span>
  <span class="flex-1 text-sm text-base-content/80">{m.article_draft_banner_text()}</span>
  {#if isAuthor}
    <button type="button" class="btn btn-sm btn-primary" onclick={onPublish} disabled={publishing}>
      {#if publishing}
        <span class="loading loading-xs loading-spinner"></span>
        {m.article_draft_publishing()}
      {:else}
        {m.article_draft_publish()}
      {/if}
    </button>
  {/if}
</div>
