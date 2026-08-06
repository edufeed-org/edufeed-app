<!--
  A folder in the community rail: one tile standing for the containers inside
  it, opened by a click, the Discord/Armada shape.

  The tile shows up to four of its members so a folder is recognisable without
  opening it — a folder that only showed a generic glyph would make the rail
  worse than the flat list it replaces.
-->
<script>
  import { GridIcon } from '$lib/components/icons';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';

  /**
   * @type {{
   *   name: string,
   *   entries: import('$lib/rail/rail-entries.js').RailEntry[],
   *   open?: boolean,
   *   onToggle?: () => void
   * }}
   */
  let { name, entries, open = false, onToggle } = $props();

  const preview = $derived(entries.slice(0, 4));
</script>

<button
  type="button"
  title={name}
  data-testid="rail-folder-tile"
  data-folder-open={open ? 'true' : 'false'}
  onclick={() => onToggle?.()}
  class="grid h-12 w-12 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-2xl bg-base-300 p-1 transition-transform duration-200 hover:scale-110 {open
    ? 'ring-2 ring-primary/60'
    : ''}"
>
  {#each preview as entry (entry.key)}
    {#if entry.kind === 'community'}
      <ImageWithFallback
        src={`https://robohash.org/${entry.pubkey}`}
        alt=""
        fallbackType="community"
        class="h-full w-full rounded-full object-cover"
      />
    {:else if entry.kind === 'area'}
      <ConcordAreaBadge
        name={entry.area.name}
        communityId={entry.area.communityId}
        iconPointer={entry.area.iconPointer}
        class="h-full w-full"
      />
    {:else}
      <span
        class="flex h-full w-full items-center justify-center rounded-full bg-base-100 text-[0.6rem]"
        aria-hidden="true">{entry.row.symbol}</span
      >
    {/if}
  {/each}
  {#if preview.length === 0}
    <span class="col-span-2 row-span-2 grid place-items-center">
      <GridIcon class_="h-5 w-5 opacity-70" />
    </span>
  {/if}
</button>
