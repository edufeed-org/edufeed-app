<script>
  /**
   * Generic "+ Custom Entry → freetext input" affordance for vocab fields that
   * want to allow an open-ended companion value. Stateless: the parent owns
   * the value and the visibility derives from it (non-empty value = input
   * visible; empty = button visible). A short-lived `expanded` flag handles
   * the "user clicked button but hasn't typed yet" case.
   *
   * @type {{
   *   value: string,
   *   label: string,
   *   buttonLabel: string,
   *   placeholder?: string,
   *   readonly?: boolean,
   *   onchange: (v: string) => void
   * }}
   */
  let { value, label, buttonLabel, placeholder = '', readonly = false, onchange } = $props();

  let expanded = $state(false);
  const showInput = $derived(expanded || (typeof value === 'string' && value.length > 0));

  function reveal() {
    expanded = true;
  }

  function clear() {
    expanded = false;
    onchange('');
  }
</script>

{#if showInput}
  <div class="form-control mt-2">
    <label class="label py-1" for="custom-value-input">
      <span class="label-text-alt">{label}</span>
    </label>
    <div class="flex gap-2">
      <input
        id="custom-value-input"
        type="text"
        class="input-bordered input flex-1"
        {placeholder}
        disabled={readonly}
        value={value ?? ''}
        oninput={(e) => onchange(/** @type {HTMLInputElement} */ (e.currentTarget).value)}
      />
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        aria-label="Clear custom entry"
        disabled={readonly}
        onclick={clear}>×</button
      >
    </div>
  </div>
{:else}
  <button type="button" class="btn mt-2 btn-outline btn-sm" disabled={readonly} onclick={reveal}
    >{buttonLabel}</button
  >
{/if}
