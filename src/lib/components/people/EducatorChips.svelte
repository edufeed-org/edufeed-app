<!--
  EducatorChips — compact Bildungsbereich + subject chips from a person's
  edufeed profile fields (kind 0 `edufeed`, parseEdufeedProfile): one more
  way to tell two people of the same name apart in search results. Shows
  every level and up to MAX_SUBJECTS subjects; nothing when the profile has
  neither.
-->
<script>
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import {
    parseEdufeedProfile,
    pickConceptLabel
  } from '$lib/helpers/educational/educatorProfile.js';

  const MAX_SUBJECTS = 3;

  /** @type {{ pubkey: string }} */
  let { pubkey } = $props();

  const getProfile = useUserProfile(() => pubkey);
  const locale = $derived(getLocale());

  /** @param {import('$lib/helpers/educational/educatorProfile.js').ProfileConcept[]} concepts */
  function labels(concepts) {
    return [...new Set(concepts.map((c) => pickConceptLabel(c.prefLabel, locale) || c.id))];
  }

  const edufeed = $derived(parseEdufeedProfile(getProfile()));
  const levels = $derived(labels(edufeed.educationalLevels));
  const allSubjects = $derived(labels(edufeed.subjects));
  const subjects = $derived(allSubjects.slice(0, MAX_SUBJECTS));
  const moreSubjects = $derived(allSubjects.length - subjects.length);
</script>

{#if levels.length > 0 || subjects.length > 0}
  <div class="mt-1 flex flex-wrap gap-1" data-testid="educator-chips">
    {#each levels as label (label)}
      <span class="badge badge-outline badge-sm badge-primary">{label}</span>
    {/each}
    {#each subjects as label (label)}
      <span class="badge badge-ghost badge-sm">{label}</span>
    {/each}
    {#if moreSubjects > 0}
      <span class="badge badge-ghost badge-sm">+{moreSubjects}</span>
    {/if}
  </div>
{/if}
