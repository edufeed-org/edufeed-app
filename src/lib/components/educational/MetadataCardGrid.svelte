<!--
  MetadataCardGrid
  Presentational olive-container card grid for resource metadata. Renders a flat
  list of cards (core educational facts first, then extension facets) inside one
  unified olive container. Extension cards may carry a provenance `chip` (e.g.
  "EKKW"). All label/icon/wrap/chip decisions are made by the caller via the pure
  helpers in `extensionMetadata.js`; this component only maps `iconKey` → glyph
  and lays the cards out.
-->

<script>
  import {
    GraduationCapIcon,
    BookIcon,
    TranslateIcon,
    LockOpenIcon,
    LockIcon,
    SchoolIcon,
    LightbulbIcon,
    SparkleIcon,
    BibleIcon,
    CheckIcon,
    TagIcon
  } from '$lib/components/icons';

  /**
   * @typedef {Object} MetadataCard
   * @property {string} key
   * @property {string} iconKey
   * @property {string} label
   * @property {string} [chip]
   * @property {boolean} [wide]
   * @property {string} [value]
   * @property {string} [valueMuted]
   * @property {{ text: string, href?: string }[]} [scalars]
   */

  /**
   * @typedef {Object} Props
   * @property {MetadataCard[]} cards
   */

  /** @type {Props} */
  let { cards } = $props();

  // Hard-coded facet → icon registry. Unknown facets fall back to the neutral
  // tag glyph (never the old lightning bolt).
  const ICONS = /** @type {Record<string, any>} */ ({
    graduationCap: GraduationCapIcon,
    klassenstufe: GraduationCapIcon,
    book: BookIcon,
    schulart: SchoolIcon,
    translate: TranslateIcon,
    lockOpen: LockOpenIcon,
    lock: LockIcon,
    didaktKonzept: LightbulbIcon,
    methode: SparkleIcon,
    bibelstelle: BibleIcon,
    check: CheckIcon,
    tag: TagIcon
  });

  /** @param {string} key */
  const iconFor = (key) => ICONS[key] ?? TagIcon;
</script>

{#if cards.length > 0}
  <div class="mcg-grid">
    {#each cards as card (card.key)}
      {@const IconCmp = iconFor(card.iconKey)}
      <div class="mcg-card" class:mcg-wide={card.wide} class:mcg-has-chip={card.chip}>
        {#if card.chip}<span class="mcg-chip">{card.chip}</span>{/if}
        <span class="mcg-ic"><IconCmp class_="w-7 h-7" /></span>
        <div class="mcg-bd">
          <p class="mcg-lbl">{card.label}</p>
          {#if card.scalars && card.scalars.length > 0}
            <p class="mcg-val mcg-val-stack">
              {#each card.scalars as s, i (i)}
                {#if s.href}
                  <a class="mcg-link" href={s.href} target="_blank" rel="noopener noreferrer"
                    >{s.text}</a
                  >
                {:else}
                  <span>{s.text}</span>
                {/if}
              {/each}
            </p>
          {:else}
            <p class="mcg-val">
              {card.value}{#if card.valueMuted}<span class="mcg-muted">
                  {card.valueMuted}</span
                >{/if}
            </p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .mcg-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
    gap: 18px;
    background: var(--c-olive);
    border-radius: 18px;
    padding: clamp(20px, 3vw, 30px);
  }
  /* On narrow screens collapse to one column. A `span 2` wide card would
     otherwise force a two-column track that overflows the viewport. */
  @media (max-width: 560px) {
    .mcg-grid {
      grid-template-columns: 1fr;
    }
    .mcg-wide {
      grid-column: auto;
    }
  }
  .mcg-card {
    position: relative;
    display: flex;
    gap: 14px;
    align-items: flex-start;
    background: color-mix(in oklch, var(--c-paper) 88%, transparent);
    border-radius: 12px;
    padding: 16px 18px;
    min-height: 92px;
  }
  .mcg-wide {
    grid-column: span 2;
  }
  .mcg-ic {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--c-olive-2);
  }
  .mcg-bd {
    flex: 1;
    min-width: 0;
  }
  .mcg-lbl {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--c-olive-2);
    margin: 0 0 4px;
  }
  /* Reserve room on the label line so the absolutely-positioned chip never
     overlaps a long facet label (e.g. "Didaktisches Konzept"). */
  .mcg-has-chip .mcg-lbl {
    padding-right: 52px;
  }
  .mcg-val {
    font-size: 17px;
    font-weight: 600;
    color: var(--c-ink);
    line-height: 1.3;
    margin: 0;
    overflow-wrap: anywhere;
    hyphens: auto;
    text-wrap: pretty;
  }
  .mcg-val-stack {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mcg-link {
    color: var(--c-ink);
    text-decoration: underline;
    text-decoration-color: var(--c-olive-2);
    text-underline-offset: 2px;
    width: fit-content;
  }
  .mcg-link:hover {
    text-decoration-color: var(--c-ink);
  }
  .mcg-muted {
    font-size: 0.8em;
    font-weight: 400;
    color: var(--c-ink-soft);
  }
  /* provenance chip — extension cards only */
  .mcg-chip {
    position: absolute;
    top: 11px;
    right: 11px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.09em;
    padding: 4px 8px;
    border-radius: 999px;
    background: var(--c-bg);
    color: var(--c-olive-2);
    border: 1px solid var(--c-rule);
  }
</style>
