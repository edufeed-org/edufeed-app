<!--
  LinkPreview — fetches OG/Twitter/AMB metadata for an HTTP(S) URL via
  /api/reader?mode=metadata and renders a Card or Compact preview card.

  Renders nothing when:
    - appSettings.linkPreviewsEnabled is false
    - the fetch fails or returns success: false
    - the response has no usable metadata
-->

<script>
  import { appSettings } from '$lib/stores/app-settings.svelte.js';

  /** @type {{ url: string }} */
  let { url } = $props();

  /** @type {'loading' | 'ok' | 'error'} */
  let state = $state('loading');

  /** @type {{ title?: string, description?: string, image?: string, siteName?: string, favicon?: string } | null} */
  let metadata = $state(null);

  /** @param {unknown} value */
  function isSafeHttpUrl(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  $effect(() => {
    if (!appSettings.linkPreviewsEnabled) {
      state = 'error';
      return;
    }
    if (!isSafeHttpUrl(url)) {
      state = 'error';
      return;
    }
    let cancelled = false;
    state = 'loading';
    metadata = null;
    fetch(`/api/reader?mode=metadata&url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body && body.success && body.metadata) {
          metadata = body.metadata;
          state = 'ok';
        } else {
          state = 'error';
        }
      })
      .catch(() => {
        if (!cancelled) state = 'error';
      });
    return () => {
      cancelled = true;
    };
  });

  /** @returns {string} */
  function hostname() {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }
</script>

{#if appSettings.linkPreviewsEnabled}
  {#if state === 'loading'}
    <div
      data-testid="link-preview-skeleton"
      class="my-2 h-[88px] w-full animate-pulse rounded-lg border border-base-300 bg-base-200"
    ></div>
  {:else if state === 'ok' && metadata}
    {@const hasImage = isSafeHttpUrl(metadata.image)}
    {@const title = metadata.title}
    {@const description = metadata.description}
    {@const favicon = metadata.favicon}
    {@const displayTitle = metadata.title?.trim() || hostname()}
    {@const displaySiteName = metadata.siteName?.trim() || null}
    {@const cardSiteName = displaySiteName || hostname()}

    {#if hasImage}
      <a
        data-testid="link-preview-card"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="my-2 flex w-full gap-3 overflow-hidden rounded-lg border border-base-300 bg-base-100 p-2 no-underline hover:bg-base-200/50"
      >
        <div class="h-[72px] w-[72px] shrink-0 overflow-hidden rounded bg-base-200">
          <img
            src={metadata.image}
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            class="h-full w-full object-cover"
          />
        </div>
        <div class="min-w-0 flex-1">
          {#if title}
            <div class="truncate text-sm font-semibold text-base-content">{title}</div>
          {/if}
          {#if description}
            <div class="line-clamp-2 text-xs text-base-content/70">{description}</div>
          {/if}
          <div class="mt-1 flex items-center gap-1 text-xs text-base-content/50">
            {#if isSafeHttpUrl(favicon)}
              <img src={favicon} alt="" loading="lazy" class="h-3 w-3" />
            {/if}
            <span class="truncate">{cardSiteName}</span>
          </div>
        </div>
      </a>
    {:else}
      <a
        data-testid="link-preview-compact"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="my-1 flex items-center gap-1.5 text-xs text-base-content/70 no-underline hover:text-base-content"
      >
        {#if isSafeHttpUrl(favicon)}
          <img src={favicon} alt="" loading="lazy" class="h-3.5 w-3.5 shrink-0" />
        {/if}
        <span class="truncate">{displayTitle}</span>
        {#if displaySiteName && displaySiteName !== displayTitle}
          <span class="shrink-0 text-base-content/40">— {displaySiteName}</span>
        {/if}
      </a>
    {/if}
  {/if}
{/if}
