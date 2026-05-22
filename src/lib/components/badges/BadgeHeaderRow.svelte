<script>
  import * as m from '$lib/paraglide/messages';
  import BadgeThumb from './BadgeThumb.svelte';

  const MAX_VISIBLE = 5;

  /**
   * @type {{
   *   badges: import('$lib/stores/badge-awards.svelte.js').BadgeDisplayItem[],
   *   onViewAll: () => void
   * }}
   */
  let { badges, onViewAll } = $props();

  let visible = $derived(badges.slice(0, MAX_VISIBLE));
  let overflow = $derived(badges.length - MAX_VISIBLE);
</script>

{#if badges.length > 0}
  <div class="mt-3 flex items-center gap-2">
    <div class="flex -space-x-1">
      {#each visible as badge (badge.id)}
        <BadgeThumb
          thumb={badge.badgeThumb}
          image={badge.badgeImage}
          alt={badge.badgeName || 'Badge'}
          class="h-8 w-8 rounded-lg border-2 border-base-100"
        />
      {/each}
    </div>

    {#if overflow > 0}
      <span class="rounded-full bg-base-300 px-2 py-0.5 text-xs font-medium text-base-content/70">
        +{overflow}
      </span>
    {/if}

    <button onclick={onViewAll} class="text-xs font-medium text-primary hover:text-primary/80">
      {m.profile_badges_view_all()} &rarr;
    </button>
  </div>
{/if}
