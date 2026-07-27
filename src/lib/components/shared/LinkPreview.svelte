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
    {@const title = metadata.title?.trim()}
    {@const description = metadata.description}

    <!-- Horizontal card: thumbnail left, domain → title → description right -->
    <a
      data-testid="link-preview-card"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      class="my-2 flex w-full overflow-hidden rounded-xl border border-base-300 bg-base-100 no-underline transition-colors hover:border-base-content/25"
    >
      {#if hasImage}
        <div data-testid="link-preview-thumb" class="w-[150px] shrink-0 bg-base-200">
          <img
            src={metadata.image}
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            onerror={() => (imageFailed = true)}
            class="h-full w-full object-cover"
          />
        </div>
      {/if}
      <div class="flex min-w-0 flex-1 flex-col justify-center px-4 py-3">
        <span data-testid="link-preview-domain" class="font-mono text-[11px] text-base-content/60"
          >{hostname()}</span
        >
        {#if title}
          <span
            data-testid="link-preview-title"
            class="mt-1 line-clamp-2 text-sm font-semibold text-base-content">{title}</span
          >
        {/if}
        {#if description}
          <span
            data-testid="link-preview-description"
            class="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-base-content/60"
            >{description}</span
          >
        {/if}
      </div>
    </a>
  {/if}
{/if}
