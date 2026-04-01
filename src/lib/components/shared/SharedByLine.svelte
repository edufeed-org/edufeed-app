<script>
  import { RepostIcon } from '$lib/components/icons';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ sharerProfile: any | null, sharerPubkey: string }} */
  let { sharerProfile, sharerPubkey } = $props();

  let displayName = $derived(sharerProfile ? getDisplayName(sharerProfile) : '...');
</script>

<div class="flex items-center gap-1 pl-1 text-xs text-base-content/50">
  <RepostIcon class_="w-3.5 h-3.5" />
  <ProfileAvatar
    profile={sharerProfile}
    pubkey={sharerPubkey}
    size="xs"
    linkToProfile
    fallbackType="robohash"
  />
  <a href={resolve(`/p/${sharerPubkey}`)} class="hover:underline">
    {m.community_shared_label({ name: displayName })}
  </a>
</div>
