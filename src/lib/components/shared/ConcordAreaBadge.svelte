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
  convention. This component itself has no concord package import, only the
  plain-JS helper module, so it stays SSR-safe like its callers.

  Community icons are encrypted blob pointers in Concord metadata (tracked
  follow-up, NOT attempted here) — this badge is the deliberate placeholder
  instead of a real avatar image.
-->
<script>
  import { areaAbbreviation, areaColorClass } from '$lib/concord/unlinked-areas.js';
  import { LockIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {string} name - full area name (tooltip carries the untruncated version elsewhere)
   * @property {string} communityId - used only to deterministically pick the badge color
   * @property {'circle'|'square'} [shape]
   * @property {string} [class] - sizing classes for the badge box (e.g. "h-12 w-12")
   */

  /** @type {Props} */
  let { name = '', communityId = '', shape = 'circle', class: className = '' } = $props();

  const abbreviation = $derived(areaAbbreviation(name));
  const colorClass = $derived(areaColorClass(communityId));
</script>

<div
  class="relative flex items-center justify-center {shape === 'circle'
    ? 'rounded-full'
    : 'rounded-lg'} {colorClass} {className}"
>
  <span class="text-xs font-bold tracking-wide select-none">{abbreviation}</span>
  <span
    class="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-base-100 ring-1 ring-base-300"
  >
    <LockIcon class_="h-2.5 w-2.5 text-base-content/70" />
  </span>
</div>
