<!--
  CoverColorPicker — choose the hue for the generated typographic cover.
  `hue` is a bindable: null = auto (hash-derived), number 0–359 = override.
  Only meaningful when the resource has no uploaded image.
-->
<script>
  import { COVER_HUE_PRESETS, clampHue } from '$lib/helpers/educational/coverColor.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ hue: number | null }} */
  let { hue = $bindable(null) } = $props();

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

<div class="form-control">
  <label class="label" for="cover-color-slider">
    <span class="label-text font-medium">{m.amb_form_label_cover_color?.() ?? 'Cover color'}</span>
  </label>

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="btn btn-sm"
      class:btn-primary={isAuto}
      class:btn-outline={!isAuto}
      aria-pressed={isAuto}
      data-testid="cover-color-auto"
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
    class="mt-3 h-3 w-full cursor-pointer appearance-none rounded-full"
    style="background: linear-gradient(to right, oklch(60% 0.18 0), oklch(60% 0.18 60), oklch(60% 0.18 120), oklch(60% 0.18 180), oklch(60% 0.18 240), oklch(60% 0.18 300), oklch(60% 0.18 360));"
    oninput={onSlider}
  />
</div>
