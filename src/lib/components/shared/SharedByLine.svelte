<script>
  import { RepostIcon } from '$lib/components/icons';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ sharers: string[], authorProfiles: Map<string, any> }} */
  let { sharers, authorProfiles } = $props();

  /** @param {string} pubkey */
  function nameFor(pubkey) {
    const profile = authorProfiles.get(pubkey);
    return profile ? getDisplayName(profile) : pubkey.slice(0, 8) + '...';
  }

  // Show up to 2 avatars/names inline, rest as "and N more"
  const MAX_SHOWN = 2;
  let shownPubkeys = $derived(sharers.slice(0, MAX_SHOWN));
  let extraCount = $derived(Math.max(0, sharers.length - MAX_SHOWN));
</script>

<div class="flex items-center gap-1 pl-1 text-xs text-base-content/50">
  <RepostIcon class_="w-3.5 h-3.5" />
  {#each shownPubkeys as pubkey (pubkey)}
    <ProfileAvatar
      profile={authorProfiles.get(pubkey) || null}
      {pubkey}
      size="xs"
      linkToProfile
      fallbackType="robohash"
    />
  {/each}
  {#if sharers.length === 1}
    <a href={resolve(`/p/${sharers[0]}`)} class="hover:underline">
      {m.community_shared_label({ name: nameFor(sharers[0]) })}
    </a>
  {:else}
    {#each shownPubkeys as pubkey, i (pubkey)}<a
        href={resolve(`/p/${pubkey}`)}
        class="hover:underline">{nameFor(pubkey)}</a
      >{#if i < shownPubkeys.length - 1}
        &
      {/if}{/each}
    {#if extraCount > 0}
      {m.community_shared_multiple_overflow({ count: extraCount })}
    {:else}
      {m.community_shared_multiple_suffix()}
    {/if}
  {/if}
</div>
