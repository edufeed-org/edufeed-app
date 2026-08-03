<script>
  import { parseFormTemplate } from '$lib/helpers/forms.js';
  import FormRenderer from './FormRenderer.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * Renders a kind-30168 template the way a respondent actually sees it —
   * interactively: section wizard, Next/Back, option→section routing,
   * show-if, and required-field validation all live. Submitting is caught
   * here and publishes nothing.
   *
   * Deliberately NOT `readonly`: that mode flattens every section into one
   * page with disabled inputs (FormRenderer's `readonly && hasSections`
   * branch), which cannot show routing, branching or validation — i.e. it
   * hides exactly what an author opens a preview to check.
   *
   * The event may be unsigned and unpublished (`builderStateToPreviewEvent`)
   * or a real one off a relay; `parseFormTemplate` reads only `.tags`, so
   * both render identically.
   *
   * @type {{ formEvent: import('nostr-tools').NostrEvent }}
   */
  let { formEvent } = $props();

  const parsed = $derived(formEvent ? parseFormTemplate(formEvent) : null);
  const hasFields = $derived((parsed?.fields?.length ?? 0) > 0);

  /**
   * FormRenderer seeds its `values` exactly once per instance (a plain
   * non-`$state` `initialized` latch), so an edited template reaching a live
   * instance would keep the stale seed: fields added later would never get
   * their default, and `text-array` would fall back to ['']. FieldsRenderer is
   * defensive enough that this degrades silently instead of throwing — a
   * preview quietly lying about defaults. Remounting on the tag signature is
   * the fix that stays local to the preview; the latch itself must NOT change,
   * because /respond relies on it to protect a respondent's in-progress
   * answers from a mid-fill template update.
   */
  const templateSignature = $derived(JSON.stringify(formEvent?.tags ?? []));

  let submittedValues = $state(/** @type {Record<string, any> | null} */ (null));

  // Reset the "submitted" panel whenever the template itself changes, so a
  // reopened/edited preview never starts on a stale confirmation screen.
  $effect(() => {
    templateSignature;
    submittedValues = null;
  });

  /** @param {Record<string, any>} values */
  function handlePreviewSubmit(values) {
    submittedValues = values;
  }
</script>

<div class="space-y-4">
  <div class="alert py-2 text-sm alert-info">
    <span>{m.form_preview_notice()}</span>
  </div>

  {#if !hasFields}
    <p class="py-8 text-center text-base-content/60">{m.form_preview_empty()}</p>
  {:else if submittedValues}
    <div class="alert alert-success">
      <span>{parsed?.confirmationMessage || m.forms_submit_success()}</span>
    </div>
    <p class="text-sm text-base-content/60">{m.form_preview_submitted_notice()}</p>
    <button
      class="btn btn-outline btn-sm"
      data-testid="preview-restart"
      onclick={() => (submittedValues = null)}
    >
      {m.form_preview_restart()}
    </button>
  {:else}
    {#key templateSignature}
      <FormRenderer {formEvent} onsubmit={handlePreviewSubmit} />
    {/key}
  {/if}
</div>
