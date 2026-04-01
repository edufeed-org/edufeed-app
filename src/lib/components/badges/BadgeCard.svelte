<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';

  /**
   * @type {{
   *   badge: import('$lib/stores/badge-awards.svelte.js').BadgeDisplayItem,
   *   issuerProfile?: any
   * }}
   */
  let { badge, issuerProfile = null } = $props();

  let issuerName = $derived(
    issuerProfile ? getDisplayName(issuerProfile) : badge.issuerPubkey.slice(0, 12) + '...'
  );
  let issuerPicture = $derived(issuerProfile ? getProfilePicture(issuerProfile) : null);
  let dateStr = $derived(formatCalendarDate(new Date(badge.awardedAt * 1000), 'short'));
</script>

<div class="card bg-base-100 shadow-sm">
  <!-- Badge image header -->
  <figure class="h-40">
    {#if badge.badgeImage}
      <img
        src={badge.badgeImage}
        alt={badge.badgeName || 'Badge'}
        class="h-full w-full object-contain p-4"
      />
    {:else}
      <div
        class="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-secondary/20"
      >
        <svg
          class="h-16 w-16 text-primary/40"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="1.5"
        >
          <circle cx="12" cy="8" r="6" />
          <path d="M15.477 12.89L17 22l-5-3l-5 3l1.523-9.11" />
        </svg>
      </div>
    {/if}
  </figure>

  <div class="card-body gap-1 p-4">
    {#if badge.badgeName}
      <h3 class="card-title text-base">{badge.badgeName}</h3>
    {/if}

    {#if badge.badgeDescription}
      <p class="line-clamp-2 text-sm text-base-content/70">{badge.badgeDescription}</p>
    {/if}

    <!-- Issuer -->
    <div class="mt-2 flex items-center gap-2">
      {#if issuerPicture}
        <img src={issuerPicture} alt={issuerName} class="h-5 w-5 rounded-full object-cover" />
      {:else}
        <div class="h-5 w-5 rounded-full bg-base-300"></div>
      {/if}
      <span class="text-xs text-base-content/60">{issuerName}</span>
    </div>

    <!-- Date -->
    <div class="mt-1 text-xs text-base-content/50">{dateStr}</div>
  </div>
</div>
