<!--
  FollowedByLine — "Gefolgt von Anna, Jörg und 3 weiteren": the viewer's
  follows who follow this person (useFollowedBy). Names the first two,
  counts the rest; renders nothing without followers.
-->
<script>
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { shortNpub } from '$lib/helpers/pubkey.js';
  import * as m from '$lib/paraglide/messages';

  const NAMED = 2;

  /** @type {{ followers: string[] }} */
  let { followers } = $props();

  const getProfiles = useProfileMap(() => followers.slice(0, NAMED));
  const names = $derived(
    followers
      .slice(0, NAMED)
      .map((pk) => {
        const p = getProfiles().get(pk);
        return p?.display_name || p?.name || shortNpub(pk);
      })
      .join(', ')
  );
  const rest = $derived(followers.length - NAMED);
</script>

{#if followers.length > 0}
  <p class="mt-1 truncate text-xs text-base-content/60" data-testid="followed-by">
    {rest > 0 ? m.people_followed_by_more({ names, count: rest }) : m.people_followed_by({ names })}
  </p>
{/if}
