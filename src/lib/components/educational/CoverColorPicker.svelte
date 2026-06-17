<!--
  CoverColorPicker — choose the hue for the generated typographic cover.
  `hue` is a bindable: null = auto (hash-derived), number 0–359 = override.
  Only meaningful when the resource has no uploaded image.
-->
<script>
  import { COVER_HUE_PRESETS, clampHue } from '$lib/helpers/educational/coverColor.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ hue: number | null, disabled?: boolean }} */
  let { hue = $bindable(null), disabled = false } = $props();

  const isAuto = $derived(hue === null);
  const sliderValue = $derived(hue ?? 0);

  /** @param {number} h */
  const swatchStyle = (h) => `background: oklch(55% 0.10 ${h});`;

  function setAuto() {
    hue = null;
  }
  /** @param {number} h */
  function pick(h) {
    hue = clampHue(h);
  }
  /** @param {Event} e */
  function onSlider(e) {
    const t = /** @type {HTMLInputElement} */ (e.currentTarget);
    hue = clampHue(t.value);
  }
</script>

<div
  class="form-control transition-opacity"
  class:pointer-events-none={disabled}
  class:opacity-40={disabled}
  aria-disabled={disabled}
>
  <label class="label" for="cover-color-slider">
    <span class="label-text font-medium">{m.amb_form_label_cover_color?.() ?? 'Cover color'}</span>
  </label>
  <p class="mb-2 text-sm text-base-content/60">
    {m.amb_form_cover_color_hint?.() ??
      "No thumbnail? We'll generate a cover from the title in this color."}
  </p>

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="btn btn-sm"
      class:btn-primary={isAuto}
      class:btn-outline={!isAuto}
      aria-pressed={isAuto}
      data-testid="cover-color-auto"
      {disabled}
      onclick={setAuto}
    >
      {m.amb_form_cover_color_auto?.() ?? 'Auto'}
    </button>

    {#each COVER_HUE_PRESETS as h (h)}
      <button
        type="button"
        class="h-8 w-8 rounded-full border-2 transition"
        class:border-base-content={hue === h}
        class:border-transparent={hue !== h}
        style={swatchStyle(h)}
        aria-label={`hue ${h}`}
        aria-pressed={hue === h}
        data-testid="cover-color-swatch"
        {disabled}
        onclick={() => pick(h)}
      ></button>
    {/each}
  </div>

  <input
    id="cover-color-slider"
    type="range"
    min="0"
    max="359"
    value={sliderValue}
    data-testid="cover-color-slider"
    {disabled}
    class="mt-3 h-3 w-full cursor-pointer appearance-none rounded-full"
    style="background: linear-gradient(to right, oklch(60% 0.18 0), oklch(60% 0.18 60), oklch(60% 0.18 120), oklch(60% 0.18 180), oklch(60% 0.18 240), oklch(60% 0.18 300), oklch(60% 0.18 360));"
    oninput={onSlider}
  />
</div>
