<!--
  ConcordAreaBadge — Armada-style badge for an unlinked Concord private area
  (sidebar follow-up: replaces the bare lock-icon circle CommunitySidebar.svelte
  and Sidebar.svelte used to render for every unlinked area, indistinguishable
  from one another). Shows a 1-2 char abbreviation of the area name on a
  deterministic background color, with a small lock glyph overlaid in the
  corner — these ARE private areas, so the lock stays, just no longer as the
  ONLY visual signal.

  Pure logic (abbreviation + color pick) lives in unlinked-areas.js
  (areaAbbreviation/areaColorClass) — imported directly from the concord
  submodule, never the $lib/concord barrel, per CLAUDE.md's Concord
  convention.

  Community icons ARE now rendered here (Armada parity follow-up): when
  `iconPointer` (a Concord `BlobPointer` — encrypted blob + symmetric
  key/nonce) resolves to a decrypted object URL via useConcordAreaIcon
  (blob-media.svelte.js), it replaces the abbreviation. The corner lock stays
  either way — it's the "this is a private area" signal, independent of
  whether we have an avatar. Falls back to the abbreviation placeholder while
  loading, when there's no icon, or if decryption fails.

  blob-media.svelte.js's $effect never runs during SSR (Svelte 5 effects are
  client-only) and blob-media.js itself has zero package imports, so this
  component stays SSR-safe exactly like its callers (Sidebar.svelte renders
  on every route, including SSR ones) despite now importing a concord
  submodule with real (browser-only, effect-gated) crypto work.
-->
<script>
  import { areaAbbreviation, areaColorClass } from '$lib/concord/unlinked-areas.js';
  import { useConcordAreaIcon } from '$lib/concord/blob-media.svelte.js';
  import { LockIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {string} name - full area name (tooltip carries the untruncated version elsewhere)
   * @property {string} communityId - used only to deterministically pick the badge color
   * @property {import('$lib/concord/blob-media.js').BlobPointerLike | undefined} [iconPointer] - encrypted community icon, if any
   * @property {'circle'|'square'} [shape]
   * @property {string} [class] - sizing classes for the badge box (e.g. "h-12 w-12")
   */

  /** @type {Props} */
  let {
    name = '',
    communityId = '',
    iconPointer = undefined,
    shape = 'circle',
    class: className = ''
  } = $props();

  const abbreviation = $derived(areaAbbreviation(name));
  const colorClass = $derived(areaColorClass(communityId));
  const getIconUrl = useConcordAreaIcon(() => iconPointer);
</script>

<div
  class="relative flex items-center justify-center {shape === 'circle'
    ? 'rounded-full'
    : 'rounded-lg'} {colorClass} {className}"
>
  {#if getIconUrl()}
    <img
      src={getIconUrl()}
      alt=""
      class="h-full w-full {shape === 'circle' ? 'rounded-full' : 'rounded-lg'} object-cover"
    />
  {:else}
    <span class="text-xs font-bold tracking-wide select-none">{abbreviation}</span>
  {/if}
  <span
    class="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-base-100 ring-1 ring-base-300"
  >
    <LockIcon class_="h-2.5 w-2.5 text-base-content/70" />
  </span>
</div>
