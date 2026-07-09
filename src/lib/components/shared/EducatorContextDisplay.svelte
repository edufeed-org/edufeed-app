<!--
  EducatorContextDisplay — read-only edufeed block for the profile page:
  Bildungsbereich + subject badges (localized) and interest chips. Renders
  nothing when the edufeed object is empty.
-->
<script>
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { pickConceptLabel } from '$lib/helpers/educational/educatorProfile.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {import('$lib/helpers/educational/educatorProfile.js').EdufeedProfile} EdufeedProfile
   */

  /** @type {{ value: EdufeedProfile }} */
  let { value } = $props();

  const locale = $derived(getLocale());

  /** @param {import('$lib/helpers/educational/educatorProfile.js').ProfileConcept[]} concepts */
  function labels(concepts) {
    // Dedupe: the same label can come from several vocabs (e.g. "Latein" in
    // schulfaecher and hochschulfaechersystematik) and labels key the #each.
    return [...new Set(concepts.map((c) => pickConceptLabel(c.prefLabel, locale) || c.id))];
  }

  const levelLabels = $derived(labels(value.educationalLevels));
  const subjectLabels = $derived(labels(value.subjects));
  const interests = $derived([...new Set(value.interests)]);
  const places = $derived([...new Set((value.locations ?? []).map((p) => p.name))]);
  const hasContent = $derived(
    levelLabels.length > 0 || subjectLabels.length > 0 || interests.length > 0 || places.length > 0
  );
</script>

{#if hasContent}
  <div class="mt-3 space-y-2 text-sm">
    {#if levelLabels.length > 0}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-base-content/60">{m.profile_display_levels_label()}:</span>
        {#each levelLabels as label (label)}
          <span class="badge badge-outline badge-sm badge-primary">{label}</span>
        {/each}
      </div>
    {/if}

    {#if subjectLabels.length > 0}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-base-content/60">{m.educator_context_subjects_label()}:</span>
        {#each subjectLabels as label (label)}
          <span class="badge badge-outline badge-sm badge-secondary">{label}</span>
        {/each}
      </div>
    {/if}

    {#if interests.length > 0}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-base-content/60">{m.educator_context_interests_label()}:</span>
        {#each interests as interest (interest)}
          <span class="badge badge-ghost badge-sm">{interest}</span>
        {/each}
      </div>
    {/if}

    {#if places.length > 0}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-base-content/60">{m.educator_context_places_label()}:</span>
        {#each places as place (place)}
          <span class="badge badge-ghost badge-sm">📍 {place}</span>
        {/each}
      </div>
    {/if}
  </div>
{/if}
