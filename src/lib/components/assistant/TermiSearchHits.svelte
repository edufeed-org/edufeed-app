<script>
  // search_resources results as compact cards. Hit fields come from the model's
  // tool call (untrusted): plain text only, http(s) links only.
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {{ title?: string, description?: string, license?: string, creator?: string,
   *   publisher?: string, url?: string, sourcePage?: string }} TermiHit
   */
  /** @type {{ hits: TermiHit[], query: string }}
   */
  let { hits, query } = $props();

  const shown = $derived((Array.isArray(hits) ? hits : []).slice(0, 5));

  /** @param {unknown} value */
  function httpHref(value) {
    try {
      const u = new URL(String(value));
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
    } catch {
      return undefined;
    }
  }
</script>

<div class="mt-2 flex flex-col gap-2">
  {#each shown as hit, i (i)}
    {@const by = [hit.creator, hit.publisher].filter(Boolean).join(' · ')}
    {@const href = httpHref(hit.sourcePage) ?? httpHref(hit.url)}
    <svelte:element
      this={href ? 'a' : 'div'}
      data-testid="termi-hit"
      {href}
      target={href ? '_blank' : undefined}
      rel={href ? 'noopener noreferrer' : undefined}
      class="block rounded-xl border border-base-300 bg-base-100 px-3 py-2 hover:bg-base-200"
    >
      <div class="text-[13px] leading-snug font-semibold">{hit.title || '—'}</div>
      {#if hit.description}
        <div class="mt-0.5 line-clamp-2 text-xs text-base-content/70">{hit.description}</div>
      {/if}
      {#if hit.license || by}
        <div class="mt-1 text-[11px] text-base-content/60">
          {#if hit.license}<span class="badge badge-ghost badge-xs">{hit.license}</span>{/if}
          {by}
        </div>
      {/if}
    </svelte:element>
  {/each}
  <a
    href="/discover?type=learning&search={encodeURIComponent(query)}"
    class="btn self-start btn-ghost btn-sm"
  >
    {m.termi_search_all()}
  </a>
</div>
