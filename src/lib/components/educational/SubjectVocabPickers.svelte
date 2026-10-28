<script>
  /**
   * Subject ("about") pickers on wizard step 4 — one FormConceptPicker per
   * Bildungsbereich subject vocab. Validation needs ONE subject across all of
   * them (validateWizardStep: `subjectsCount === 0`), so with several vocabs
   * the group carries a single required marker and a one-of hint; the vocab
   * captions (Schule / Hochschule) stay unmarked.
   */
  import FormConceptPicker from '$lib/components/forms/FormConceptPicker.svelte';
  import { getSubjectVocabLabel } from '$lib/helpers/educational/bildungsbereich.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {{ id: string, label: string }} CompactConcept
   * @typedef {import('$lib/helpers/educational/formReference.js').SelectedConcept} SelectedConcept
   * @typedef {{ key: string, field: import('$lib/helpers/forms.js').FormField }} VocabEntry
   */

  /**
   * @type {{
   *   fields: VocabEntry[],
   *   valuesByKey: Record<string, CompactConcept[]>,
   *   onchange: (key: string, rich: SelectedConcept[]) => void,
   *   error?: string
   * }}
   */
  let { fields, valuesByKey, onchange, error = undefined } = $props();

  const grouped = $derived(fields.length > 1);

  /**
   * @param {CompactConcept} c
   * @param {string} relay
   * @returns {SelectedConcept}
   */
  function toRich(c, relay) {
    const locale = getLocale();
    return { id: c.id, nostrCoord: '', relay, labels: c.label ? { [locale]: c.label } : {} };
  }
</script>

{#if fields.length === 0}
  <p class="text-sm text-base-content/60">{m.amb_form_help_subject_pick_bildungsbereich()}</p>
{:else}
  {#if grouped}
    <div class="label">
      <span class="label-text font-medium">
        {m.amb_form_label_subject()}
        <span class="text-error">*</span>
      </span>
    </div>
    <p class="-mt-1 mb-1 text-xs text-base-content/60">{m.amb_form_help_subject_one_of()}</p>
  {/if}
  {#each fields as entry (entry.key)}
    <div class="form-control">
      <div class="label">
        <span class="label-text font-medium">
          {#if grouped}
            {getSubjectVocabLabel(entry.key, getLocale())}
          {:else}
            {m.amb_form_label_subject()}
            <span class="text-error">*</span>
          {/if}
        </span>
      </div>
      <FormConceptPicker
        field={entry.field}
        multiple={true}
        value={(valuesByKey[entry.key] ?? []).map((c) => toRich(c, entry.field.vocab?.relay ?? ''))}
        onchange={(rich) => onchange(entry.key, rich)}
      />
    </div>
  {/each}
  {#if error}
    <p class="mt-1 text-xs text-error">{error}</p>
  {/if}
{/if}
