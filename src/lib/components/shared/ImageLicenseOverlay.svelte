<!--
  ImageLicenseOverlay
  One overlay for an image's license state:
    - 'found'   → known-license badge (CC label + credit), same look as the
                  legacy LicenseBadge. Attestations carrying an `ai` tag get
                  the EU "AI" mark + "AI generated"/"AI modified" in front, so
                  AI content is labelled wherever the image is shown.
    - 'missing' → neutral, non-alarming caution. 'pill' shows an "i" icon +
                  "No license info"; 'dot' shows the icon only. Both reveal a
                  keyboard-accessible popover (hover + focus, Esc to close) with
                  a friendly explanation.
    - 'loading' → nothing (avoids flashing a warning while relays answer).

  The `position` prop carries the tailwind positioning/background classes from
  the caller (e.g. "absolute right-1 bottom-1 bg-base-100/80 backdrop-blur").
-->
<script module>
  // Per-instance id so each caution popover can be associated with its trigger
  // via aria-describedby (multiple overlays can coexist on one page).
  let popoverCounter = 0;
</script>

<script>
  import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';
  import { getAiLabel } from '$lib/helpers/ai-label.js';
  import { AiLabelIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  const tooltipId = `license-caution-tip-${popoverCounter++}`;

  /**
   * @typedef {Object} Props
   * @property {import('nostr-tools').NostrEvent | null} [licenseEvent]
   * @property {'loading' | 'found' | 'missing'} status
   * @property {'pill' | 'dot'} [variant]
   * @property {string} [position]
   */

  /** @type {Props} */
  let {
    licenseEvent = null,
    status,
    variant = 'pill',
    position = 'absolute right-1 bottom-1'
  } = $props();

  let open = $state(false);

  const licenseUrl = $derived(
    licenseEvent?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'license')?.[1] ?? null
  );
  const credit = $derived(
    licenseEvent?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'credit')?.[1] ?? null
  );
  const source = $derived(
    licenseEvent?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'source')?.[1] ?? null
  );
  const creatorP = $derived(
    licenseEvent?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'p')?.[1] ?? null
  );
  const label = $derived(licenseUrl ? formatLicenseUrl(licenseUrl) : null);
  const aiLabel = $derived(getAiLabel(licenseEvent));
  const aiText = $derived(
    aiLabel === 'generated'
      ? m.image_ai_label_generated()
      : aiLabel === 'modified'
        ? m.image_ai_label_modified()
        : null
  );

  const foundTitle = $derived.by(() => {
    if (!licenseEvent) return '';
    const parts = [];
    if (aiText) parts.push(aiText);
    if (credit) parts.push(`Credit: ${credit}`);
    if (source) parts.push(`Source: ${source}`);
    if (creatorP) parts.push(`Creator pubkey: ${creatorP}`);
    parts.push(`Attested by: ${licenseEvent.pubkey}`);
    return parts.join('\n');
  });

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') open = false;
  }
</script>

{#if status === 'found' && (label || aiText)}
  <span
    class="badge inline-flex max-w-full items-center gap-1 badge-ghost text-xs {position}"
    title={foundTitle}
    data-testid="license-badge"
  >
    {#if aiText}
      <span class="inline-flex shrink-0 items-center gap-1 font-medium" data-testid="ai-label">
        <AiLabelIcon class_="h-3.5 w-3.5" title="" />
        {aiText}
      </span>
    {/if}
    {#if label}
      <span class="shrink-0 font-medium">{aiText ? '· ' : ''}{label}</span>
    {/if}
    {#if credit}
      <span class="min-w-0 truncate opacity-70">· {credit}</span>
    {/if}
  </span>
{:else if status === 'missing'}
  <!-- Deliberately focusable so keyboard users can open the popover; role="note"
       keeps it out of the tab order's interactive semantics. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <span
    class="{position} z-10 inline-flex"
    role="note"
    tabindex="0"
    aria-label={m.image_license_caution_aria()}
    aria-describedby={open ? tooltipId : undefined}
    onmouseenter={() => (open = true)}
    onmouseleave={() => (open = false)}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
    onkeydown={onKeydown}
    data-testid="license-caution"
  >
    <span
      class="badge items-center gap-1 border-0 bg-base-100/80 text-xs text-base-content/70 backdrop-blur {variant ===
      'dot'
        ? 'px-1 badge-sm'
        : ''}"
    >
      <svg
        viewBox="0 0 24 24"
        class="h-3.5 w-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4" />
        <circle cx="12" cy="8" r=".6" fill="currentColor" stroke="none" />
      </svg>
      {#if variant === 'pill'}
        <span class="font-medium">{m.image_license_caution_pill()}</span>
      {/if}
    </span>

    {#if open}
      <span
        id={tooltipId}
        class="absolute right-0 bottom-full z-20 mb-1 block w-64 rounded-box border border-base-300 bg-base-100 p-3 text-left shadow-lg"
        role="tooltip"
        data-testid="license-caution-popover"
      >
        <span class="block text-sm font-semibold text-base-content">
          {m.image_license_caution_popover_title()}
        </span>
        <span class="mt-1 block text-xs text-base-content/70">
          {m.image_license_caution_popover_text()}
        </span>
      </span>
    {/if}
  </span>
{/if}
