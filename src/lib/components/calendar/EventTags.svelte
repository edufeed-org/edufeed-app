<!--
  EventTags Component
  Displays clickable event tags that navigate to filtered calendar views
-->

<script>
  import { resolve as _resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';

  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  /**
   * @typedef {Object} EventTagsProps
   * @property {string[]} tags - Array of tag strings to display
   * @property {'xs' | 'sm' | 'md' | 'lg'} [size='sm'] - Badge size
   * @property {number} [maxDisplay] - Maximum number of tags to show before truncating
   * @property {boolean} [showCount=true] - Show count of remaining tags if truncated
   * @property {string} [targetRoute='/calendar'] - Route to navigate to when tag is clicked
   */

  let {
    tags = [],
    size = 'sm',
    maxDisplay = undefined,
    showCount = true,
    targetRoute = '/calendar'
  } = $props();

  // Deduplicate tags to avoid keyed each block errors
  let uniqueTags = $derived([...new Set(tags)]);

  // Determine which tags to display
  let displayTags = $derived(
    maxDisplay && uniqueTags.length > maxDisplay ? uniqueTags.slice(0, maxDisplay) : uniqueTags
  );

  let remainingCount = $derived(
    maxDisplay && uniqueTags.length > maxDisplay ? uniqueTags.length - maxDisplay : 0
  );

  let hiddenTags = $derived(
    maxDisplay && uniqueTags.length > maxDisplay ? uniqueTags.slice(maxDisplay) : []
  );
</script>

{#if tags.length > 0}
  <!-- min-w-0/max-w-full: as a flex item this row otherwise sizes to
       max-content and overflows narrow cards (visible in masonry columns) -->
  <div class="flex max-w-full min-w-0 flex-wrap items-center gap-1">
    {#each displayTags as tag (tag)}
      <a
        href={resolve(`${targetRoute}?tags=${encodeURIComponent(tag)}`)}
        class="badge max-w-full badge-outline badge-{size} transition-colors hover:badge-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:badge-primary focus:outline-none"
        title={m.event_tags_view_all_tooltip({ tag })}
      >
        <!-- truncate: degenerate tags (hundreds of chars, no break points)
             must not blow out the card / masonry column width -->
        <span class="block max-w-full truncate">#{tag}</span>
      </a>
    {/each}
    {#if showCount && remainingCount > 0}
      <div class="dropdown dropdown-end dropdown-bottom inline-flex">
        <div
          tabindex="0"
          role="button"
          class="badge badge-ghost badge-{size} cursor-pointer text-base-content/40 hover:text-base-content/60"
        >
          {m.event_tags_more_count({ count: remainingCount })}
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          tabindex="0"
          class="dropdown-content z-10 mt-1 flex flex-col gap-1 rounded-box bg-base-100 p-2 shadow-lg"
        >
          {#each hiddenTags as tag (tag)}
            <a
              href={resolve(`${targetRoute}?tags=${encodeURIComponent(tag)}`)}
              class="badge badge-outline badge-{size} transition-colors hover:badge-primary"
              title={m.event_tags_view_all_tooltip({ tag })}
            >
              #{tag}
            </a>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}
