<!--
  /privacy — the deployment's Datenschutzerklärung, rendered from the Markdown
  file named by PRIVACY_POLICY_PATH (server-side, sanitized). Same card
  layout as /imprint; the text itself is operator content and not localized.
-->
<script>
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: { html: string } }} */
  let { data } = $props();
</script>

<svelte:head>
  <title>{m.privacy_title()} - {runtimeConfig.appName}</title>
</svelte:head>

<div class="bg-base-100 px-4 py-8">
  <div class="mx-auto max-w-3xl">
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <article
          data-testid="privacy-policy"
          class="prose-headings:font-display prose max-w-none prose-a:text-primary prose-table:text-sm"
        >
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized server-side (sanitizeServerHtml) -->
          {@html data.html}
        </article>
      </div>
    </div>
  </div>
</div>
