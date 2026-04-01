<script>
  import * as m from '$lib/paraglide/messages';

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
        {#if badge.badgeThumb || badge.badgeImage}
          <img
            src={badge.badgeThumb || badge.badgeImage}
            alt={badge.badgeName || 'Badge'}
            class="h-8 w-8 rounded-lg border-2 border-base-100 object-cover"
          />
        {:else}
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-base-100 bg-gradient-to-br from-primary/30 to-secondary/30"
          >
            <svg
              class="h-4 w-4 text-primary/60"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              stroke-width="2"
            >
              <circle cx="12" cy="8" r="6" />
              <path d="M15.477 12.89L17 22l-5-3l-5 3l1.523-9.11" />
            </svg>
          </div>
        {/if}
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
