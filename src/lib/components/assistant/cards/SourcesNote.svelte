<script>
  // "X war gerade nicht erreichbar." per failed source + one retry button.
  // Entries are tool names (tier 1/2) or relay names; anything unmapped → one generic line.
  import * as m from '$lib/paraglide/messages';

  /** @type {{ sources?: string[], onRetry?: () => void }} */
  let { sources = [], onRetry } = $props();

  /** @type {Record<string, () => string>} */
  const LINES = {
    search_events: m.termi_sources_events,
    search_content: m.termi_sources_content,
    search_resources: m.termi_sources_content,
    search_passages: m.termi_sources_passages,
    find_community: m.termi_sources_community,
    find_people: m.termi_sources_people
  };

  const lines = $derived([
    ...new Set(
      (Array.isArray(sources) ? sources : []).map((s) =>
        (Object.hasOwn(LINES, s) ? LINES[s] : m.termi_sources_generic)()
      )
    )
  ]);
</script>

{#if lines.length > 0}
  <div class="min-w-0 text-xs text-base-content/70" data-testid="termi-sources-note">
    {#each lines as line (line)}
      <p>{line}</p>
    {/each}
    {#if onRetry}
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <button type="button" class="btn btn-ghost btn-sm" onclick={onRetry}>
          {m.termi_sources_retry()}
        </button>
      </div>
    {/if}
  </div>
{/if}
