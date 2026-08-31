<!--
  ExternalUrlInput Component
  Multi-entry input for managing external reference URLs (r-tags)
-->

<script>
  import { CloseIcon, PlusIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ urls?: string[], label?: string, helpText?: string, onchange?: (urls: string[]) => void }} */
  let { urls = $bindable([]), label = '', helpText = '', onchange = () => {} } = $props();

  let newUrl = $state('');

  /**
   * Check if URL is valid
   * @param {string} url
   * @returns {boolean}
   */
  function isValidUrl(url) {
    if (!url?.trim()) return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Add a new URL
   */
  function addUrl() {
    const trimmed = newUrl.trim();
    if (!isValidUrl(trimmed)) return;
    if (urls.includes(trimmed)) return; // No duplicates

    urls = [...urls, trimmed];
    newUrl = '';
    onchange(urls);
  }

  /**
   * Remove a URL
   * @param {number} index
   */
  function removeUrl(index) {
    urls = urls.filter((_, i) => i !== index);
    onchange(urls);
  }

  /**
   * Handle enter key in input
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addUrl();
    }
  }

  /**
   * Handle blur - auto-add valid URL when input loses focus
   */
  function handleBlur() {
    if (isValidUrl(newUrl)) {
      addUrl();
    }
  }

  const canAdd = $derived(isValidUrl(newUrl));
</script>

<div class="external-url-input form-control w-full">
  <!-- Label -->
  {#if label}
    <div class="label">
      <span class="label-text font-medium">{label}</span>
    </div>
  {/if}

  <!-- Existing URLs List -->
  {#if urls.length > 0}
    <div class="mb-3 space-y-2">
      {#each urls as url, index (index)}
        <div class="flex items-center gap-2 rounded-lg bg-base-200 p-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="h-4 w-4 shrink-0 text-base-content/60"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
            />
          </svg>
          <!-- eslint-disable svelte/no-navigation-without-resolve -- external: user-provided URL -->
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            class="flex-1 link truncate text-sm link-primary"
          >
            {url}
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
          <button
            type="button"
            class="btn text-error btn-ghost btn-xs"
            onclick={() => removeUrl(index)}
            aria-label={m.aria_remove_url()}
          >
            <CloseIcon class_="w-4 h-4" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Add URL Input -->
  <div class="flex gap-2">
    <input
      type="url"
      class="input-bordered input input-sm flex-1"
      bind:value={newUrl}
      onkeydown={handleKeydown}
      onblur={handleBlur}
      placeholder={m.external_url_placeholder()}
    />
    <button type="button" class="btn btn-outline btn-sm" onclick={addUrl} disabled={!canAdd}>
      <PlusIcon class_="w-4 h-4" />
      {m.external_url_add()}
    </button>
  </div>

  <!-- Help Text -->
  {#if helpText}
    <p class="mt-1 text-xs text-base-content/60">{helpText}</p>
  {/if}
</div>
