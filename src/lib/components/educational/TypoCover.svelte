<!--
  TypoCover — pure presentational typographic cover.

  3:4 portrait card with:
    - top: content-type pill (omitted when contentTypeLabel is null)
    - middle: leading words / one script-highlighted word / trailing words
    - bottom: 1px white hairline rule, metaLabel (left), edufeed credit (right)

  Knows nothing about resources. All inputs are already-extracted strings.
  Resource-aware wiring lives in ResourceCover.svelte.

  Per docs/superpowers/specs/2026-06-11-typo-cover-design.md.
-->
<script>
  import { splitTitle, stringColorHue } from '$lib/helpers/educational/typoCover.js';

  /**
   * @typedef {Object} Props
   * @property {string} title
   * @property {string | null} contentTypeLabel
   * @property {string | null} metaLabel
   * @property {string} paletteId
   * @property {'thumbnail' | 'full'} [size]
   * @property {string} [class]
   */

  /** @type {Props} */
  let {
    title,
    contentTypeLabel,
    metaLabel,
    paletteId,
    size = 'full',
    class: className = ''
  } = $props();

  const parts = $derived(splitTitle(title));
  const hue = $derived(stringColorHue(paletteId));

  // CSS custom properties set inline so each cover gets its own palette.
  // --cover-hue feeds the script-word color tint (see .typo-cover-title-script).
  // Dot-pattern opacity is theme-swapped via :where([data-theme="dark"]) below.
  const inlineStyle = $derived.by(() => {
    if (hue === null) {
      return '--c-hero: oklch(45% 0.01 250); --c-hero-2: oklch(40% 0.01 250); --cover-hue: 250;';
    }
    return `--c-hero: oklch(55% 0.10 ${hue}); --c-hero-2: oklch(48% 0.11 ${hue}); --cover-hue: ${hue};`;
  });
</script>

<div class="typo-cover {className}" style={inlineStyle} data-testid="typo-cover-frame">
  <div class="typo-cover-card aspect-[3/4]" data-testid="typo-cover-card">
    <div class="typo-cover-inner" class:is-thumb={size === 'thumbnail'}>
      {#if contentTypeLabel}
        <div class="typo-cover-pill" data-testid="typo-cover-pill">
          {contentTypeLabel}
        </div>
      {/if}

      {#if size === 'full'}
        <div class="typo-cover-title-stack" data-testid="typo-cover-title-stack">
          {#if parts.leading.length > 0}
            <div
              class="typo-cover-title-line typo-cover-title-leading"
              data-testid="typo-cover-title-leading"
            >
              {parts.leading.join(' ')}
            </div>
          {/if}
          {#if parts.script}
            <div
              class="typo-cover-title-line typo-cover-title-script"
              data-testid="typo-cover-title-script"
            >
              {parts.script}
            </div>
          {/if}
          {#if parts.trailing.length > 0}
            <div
              class="typo-cover-title-line typo-cover-title-trailing"
              data-testid="typo-cover-title-trailing"
            >
              {parts.trailing.join(' ')}
            </div>
          {/if}
        </div>

        <div class="typo-cover-footer" data-testid="typo-cover-footer">
          <hr class="typo-cover-rule" />
          <div class="typo-cover-footer-row">
            {#if metaLabel}
              <span class="typo-cover-meta" data-testid="typo-cover-meta">{metaLabel}</span>
            {:else}
              <span class="typo-cover-meta typo-cover-meta-empty" aria-hidden="true"></span>
            {/if}
            <span class="typo-cover-credit" data-testid="typo-cover-credit">
              edufeed / cc by 4.0
            </span>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .typo-cover {
    display: block;
    width: 100%;
  }

  .typo-cover-card {
    border-radius: 22px;
    background: white;
    padding: 14px;
    box-shadow: 0 8px 24px -8px oklch(0% 0 0 / 0.15);
    width: 100%;
  }

  .typo-cover-inner {
    position: relative;
    isolation: isolate;
    height: 100%;
    border-radius: 12px;
    padding: 8% 8%;
    overflow: hidden;
    background: linear-gradient(165deg, var(--c-hero) 0%, var(--c-hero-2) 100%);
    color: white;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    container-type: inline-size;
  }

  /* Dot-grid texture: two radial gradients, overlay-blended. */
  .typo-cover-inner::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle at 1px 1px, oklch(100% 0 0 / 0.18) 1px, transparent 0),
      radial-gradient(circle at 1px 1px, oklch(100% 0 0 / 0.18) 1px, transparent 0);
    background-size:
      14px 14px,
      14px 14px;
    background-position:
      0 0,
      7px 7px;
    mix-blend-mode: overlay;
    pointer-events: none;
    z-index: 0;
  }

  /* All real content sits above the texture. */
  .typo-cover-pill,
  .typo-cover-title-stack,
  .typo-cover-footer {
    position: relative;
    z-index: 1;
  }

  /* Pill: top-left. */
  .typo-cover-pill {
    align-self: flex-start;
    font-family: 'Outfit', system-ui, sans-serif;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: clamp(0.5rem, 2.6cqi, 0.8rem);
    padding: 0.35em 0.9em;
    border-radius: 999px;
    background: oklch(100% 0 0 / 0.18);
    border: 1px solid oklch(100% 0 0 / 0.25);
    backdrop-filter: blur(8px);
    color: white;
  }

  /* Title stack: vertically centered (auto margins). */
  .typo-cover-title-stack {
    margin: auto 0;
    display: flex;
    flex-direction: column;
    gap: 0.1em;
  }

  .typo-cover-title-line {
    overflow-wrap: anywhere;
    line-height: 0.95;
  }

  .typo-cover-title-leading,
  .typo-cover-title-trailing {
    font-family: 'Outfit', system-ui, sans-serif;
    font-weight: 800;
    font-size: clamp(1.4rem, 12cqi, 3rem);
    color: white;
  }

  .typo-cover-title-leading {
    text-align: left;
    padding-left: 8%;
  }

  .typo-cover-title-trailing {
    text-align: right;
    padding-right: 6%;
  }

  .typo-cover-title-script {
    font-family: 'Caveat', cursive;
    font-weight: 700;
    font-size: clamp(2.2rem, 19cqi, 5rem);
    color: oklch(96% 0.02 var(--cover-hue, 80));
    text-align: center;
    transform: rotate(-4deg);
    text-shadow: 0 2px 8px oklch(0% 0 0 / 0.15);
    line-height: 1;
  }

  /* Footer: hairline rule + meta + credit. */
  .typo-cover-footer {
    display: flex;
    flex-direction: column;
    gap: 0.4em;
  }

  .typo-cover-rule {
    border: none;
    border-top: 1px solid oklch(100% 0 0 / 0.4);
    margin: 0;
  }

  .typo-cover-footer-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5em;
  }

  .typo-cover-meta {
    font-family: 'Outfit', system-ui, sans-serif;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: clamp(0.55rem, 2.6cqi, 0.85rem);
    color: oklch(100% 0 0 / 0.92);
  }

  .typo-cover-meta-empty {
    /* keeps the row layout when no meta label is set */
    display: inline-block;
    min-width: 1px;
  }

  .typo-cover-credit {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: clamp(0.45rem, 2.2cqi, 0.7rem);
    color: oklch(100% 0 0 / 0.75);
  }

  /* Thumbnail variant: drop title stack + footer entirely. */
  .typo-cover-inner.is-thumb {
    padding: 6% 6%;
    justify-content: flex-start;
  }

  .typo-cover-inner.is-thumb .typo-cover-pill {
    font-size: clamp(0.45rem, 5cqi, 0.7rem);
    padding: 0.25em 0.6em;
    letter-spacing: 0.08em;
  }

  /* Dark theme: lighter dot pattern so it doesn't fight the gradient.
     Gradient tones themselves stay mid-range OKLCH and read fine on both themes. */
  :where([data-theme='dark'], [data-theme='stil-dark'], [data-theme='rpi-dark'])
    .typo-cover-inner::before {
    background-image: radial-gradient(circle at 1px 1px, oklch(100% 0 0 / 0.12) 1px, transparent 0),
      radial-gradient(circle at 1px 1px, oklch(100% 0 0 / 0.12) 1px, transparent 0);
  }
</style>
