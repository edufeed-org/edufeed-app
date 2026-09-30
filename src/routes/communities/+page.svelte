<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { useJoinedCommunitiesState } from '$lib/stores/joined-communities-list.svelte.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';

  const joined = useJoinedCommunitiesState();

  $effect(() => {
    const communities = joined.list();
    const status = joined.status();
    if (communities.length > 0) {
      const firstCommunity = [...communities].sort()[0];
      const npub = hexToNpub(firstCommunity);
      if (npub) {
        goto(resolve(`/c/${npub}`), { replaceState: true });
        return;
      }
    }
    // Wait until an empty list is known to BE empty. Sending a user whose list
    // failed to load to Discover invites re-following, and that overwrites
    // the real list (2026-09-30); the dashboard section explains + retries.
    if (status === 'loading') return;
    if (status === 'unavailable') {
      goto(resolve('/c?view=communities'), { replaceState: true });
      return;
    }
    // No communities or not logged in - go to discover communities tab
    goto(resolve('/discover?type=communities'), { replaceState: true });
  });
</script>
