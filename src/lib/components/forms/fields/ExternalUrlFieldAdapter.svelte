<script>
  import ExternalUrlInput from '$lib/components/educational/ExternalUrlInput.svelte';
  import { unique } from '$lib/helpers/unique.js';

  /** Registry-contract adapter around ExternalUrlInput (value = string[]).
   *  FieldsRenderer renders the field label/required marker and the error
   *  generically (wrapping this component), so the adapter must NOT render
   *  its own — it passes label="" to suppress ExternalUrlInput's heading, and
   *  omits any error block. `error` is accepted per the registry contract but
   *  unused. */
  /**
   * @type {{
   *   field?: any,
   *   value?: any,
   *   error?: any,
   *   readonly?: boolean,
   *   onchange: (v: string[]) => void
   * }}
   */
  let { field: _field, value = [], error: _error = null, readonly = false, onchange } = $props();

  // Read-only render mirror of the external value. FormRenderer seeds a
  // non-vocab field with the string default (''), so coerce non-arrays to [].
  // The ONLY outbound path is ExternalUrlInput's own onchange (user add/remove)
  // — never sync from an effect: `[] !== ''` would fire a spurious onchange on
  // mount (mutating values[field] ''→[] with no user action).
  let urls = $derived(Array.isArray(value) ? value : []);

  // Readonly list renders a keyed {#each} over the same URLs — dedupe first:
  // r-tags come straight off the event (rTagEmitter.parse), and a malformed
  // event can repeat a tag, which would otherwise crash the keyed block.
  let readonlyUrls = $derived(unique(urls));
</script>

{#if !readonly}
  <ExternalUrlInput
    bind:urls
    label=""
    helpText={_field?.options?.helpText || ''}
    onchange={(u) => onchange(u)}
  />
{:else}
  <!-- Static, non-interactive view (preview route renders FormRenderer readonly). -->
  <ul class="space-y-1">
    {#each readonlyUrls as url (url)}
      <li class="text-sm">
        <!-- eslint-disable svelte/no-navigation-without-resolve -- external: user-provided URL -->
        <a href={url} target="_blank" rel="noopener noreferrer" class="link link-primary">
          {url}
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      </li>
    {/each}
  </ul>
{/if}
