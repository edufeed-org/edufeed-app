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
  let phase = $state('loading');

  /** @type {{ title?: string, description?: string, image?: string, siteName?: string } | null} */
  let metadata = $state(null);

  /** Flips to true when the OG image fails to load, forcing the Compact fallback. */
  let imageFailed = $state(false);

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

  /**
   * Normalize the tagged-union response from extractMetadataFromHtml into a flat
   * shape the template consumes. Returns null if no usable metadata.
   *
   * @param {any} raw
   * @returns {{ title?: string, description?: string, image?: string, siteName?: string } | null}
   */
  function normalizeMetadata(raw) {
    if (!raw || typeof raw !== 'object') return null;

    // Open Graph / Twitter (most common)
    if (raw.source === 'opengraph' && raw.og) {
      const og = raw.og;
      return {
        title: og.title,
        description: og.description,
        image: og.image,
        siteName: og.siteName
      };
    }

    // AMB JSON-LD (educational content). Fields can be strings or {en, de} maps.
    if (raw.source === 'amb-jsonld' && raw.amb) {
      /** @param {any} v */
      const pickLang = (v) => {
        if (!v) return undefined;
        if (typeof v === 'string') return v;
        if (Array.isArray(v)) return pickLang(v[0]);
        if (typeof v === 'object') {
          return v.en || v.de || /** @type {any} */ (Object.values(v)[0]);
        }
        return undefined;
      };
      const amb = raw.amb;
      const image =
        typeof amb.image === 'string'
          ? amb.image
          : amb.image?.['@id'] || amb.image?.url || amb.image?.contentUrl;
      return {
        title: pickLang(amb.name) || pickLang(amb.headline),
        description: pickLang(amb.description),
        image,
        siteName: pickLang(amb.publisher?.name)
      };
    }

    return null;
  }

  $effect(() => {
    if (!appSettings.linkPreviewsEnabled) {
      phase = 'error';
      return;
    }
    if (!isSafeHttpUrl(url)) {
      phase = 'error';
      return;
    }
    let cancelled = false;
    phase = 'loading';
    metadata = null;
    imageFailed = false;
    fetch(`/api/reader?mode=metadata&url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body && body.success && body.metadata) {
          const normalized = normalizeMetadata(body.metadata);
          if (
            normalized &&
            (normalized.title || normalized.image || normalized.description || normalized.siteName)
          ) {
            metadata = normalized;
            phase = 'ok';
          } else {
            phase = 'error';
          }
        } else {
          phase = 'error';
        }
      })
      .catch(() => {
        if (!cancelled) phase = 'error';
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
  {#if phase === 'loading'}
    <div
      data-testid="link-preview-skeleton"
      class="my-2 h-[88px] w-full animate-pulse rounded-lg border border-base-300 bg-base-200"
    ></div>
  {:else if phase === 'ok' && metadata}
    {@const hasImage = isSafeHttpUrl(metadata.image) && !imageFailed}
    {@const title = metadata.title}
    {@const description = metadata.description}
    {@const displayTitle = metadata.title?.trim() || hostname()}
    {@const displaySiteName = metadata.siteName?.trim() || null}
    {@const cardSiteName = displaySiteName || hostname()}

    {#if hasImage}
      <a
        data-testid="link-preview-card"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="my-2 flex w-full flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 no-underline hover:bg-base-200/50"
      >
        <div class="w-full overflow-hidden bg-base-200">
          <img
            src={metadata.image}
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            onerror={() => (imageFailed = true)}
            class="aspect-[1.91/1] max-h-60 w-full object-cover"
          />
        </div>
        <div class="min-w-0 flex-1 p-3">
          {#if title}
            <div class="line-clamp-2 text-sm font-semibold text-base-content">{title}</div>
          {/if}
          {#if description}
            <div class="mt-0.5 line-clamp-2 text-xs text-base-content/70">{description}</div>
          {/if}
          <div class="mt-1 flex items-center gap-1 text-xs text-base-content/50">
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
        <span class="truncate">{displayTitle}</span>
        {#if displaySiteName && displaySiteName !== displayTitle}
          <span class="shrink-0 text-base-content/40">— {displaySiteName}</span>
        {/if}
      </a>
    {/if}
  {/if}
{/if}
