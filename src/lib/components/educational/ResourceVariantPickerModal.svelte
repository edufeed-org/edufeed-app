<!--
  ResourceVariantPickerModal Component

  Step-0 modal shown when the user clicks "Lernressource teilen" on a
  deployment that enables more than one metadata-form variant. Renders one
  card per enabled variant; clicking a card invokes `onSelect(variantId)`.

  Single-variant deployments skip this modal entirely — the FAB navigates
  straight to `/create/resource/<defaultVariantId>`.
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { getEnabledVariants } from '$lib/config/resource-form-variants.js';
  import { CloseIcon } from '$lib/components/icons';

  /**
   * @type {{
   *   open: boolean,
   *   onSelect: (variantId: string) => void,
   *   onClose: () => void
   * }}
   */
  let { open, onSelect, onClose } = $props();

  const variants = $derived(getEnabledVariants());

  /**
   * Resolve a Paraglide message key to its rendered string.
   * We import the messages module as a namespace and look up keys
   * dynamically so new variants can be added without touching this file.
   *
   * @param {string} key
   * @returns {string}
   */
  function tr(key) {
    const fn = /** @type {any} */ (m)[key];
    return typeof fn === 'function' ? fn() : key;
  }
</script>

{#if open}
  <dialog class="modal-open modal">
    <div class="modal-box max-w-lg">
      <div class="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 class="text-lg font-bold">{tr('resource_variant_picker_title')}</h3>
          <p class="mt-1 text-sm text-base-content/70">
            {tr('resource_variant_picker_description')}
          </p>
        </div>
        <button class="btn btn-circle btn-ghost btn-sm" onclick={onClose} aria-label="Close">
          <CloseIcon class_="w-5 h-5" />
        </button>
      </div>

      <div class="grid gap-3">
        {#each variants as variant (variant.id)}
          <button
            type="button"
            data-variant-id={variant.id}
            class="card cursor-pointer border border-base-300 bg-base-100 text-left transition-colors hover:border-primary hover:bg-base-200"
            onclick={() => onSelect(variant.id)}
          >
            <div class="card-body p-4">
              <h4 class="card-title text-base">{tr(variant.labelKey)}</h4>
              <p class="text-sm text-base-content/70">{tr(variant.descriptionKey)}</p>
            </div>
          </button>
        {/each}
      </div>

      <div class="modal-action">
        <button type="button" class="btn" onclick={onClose}>
          {tr('resource_variant_picker_cancel')}
        </button>
      </div>
    </div>
    <button class="modal-backdrop" onclick={onClose} aria-label="Close">close</button>
  </dialog>
{/if}
