<script>
  import { RepostIcon } from '$lib/components/icons';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import ProfileCard from './ProfileCard.svelte';
  import HoverCard from './HoverCard.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ sharers: string[], authorProfiles: Map<string, any> }} */
  let { sharers, authorProfiles } = $props();

  const MAX_SHOWN = 3;
  let shownPubkeys = $derived(sharers.slice(0, MAX_SHOWN));
  let extraCount = $derived(Math.max(0, sharers.length - MAX_SHOWN));
</script>

<div class="mb-0.5 flex items-center gap-1.5 pl-1 text-xs text-base-content/50">
  <RepostIcon class_="w-3.5 h-3.5 shrink-0" />
  <div class="flex items-center">
    {#each shownPubkeys as pubkey, i (pubkey)}
      <div class="{i > 0 ? '-ml-1.5' : ''} relative" style="z-index: {shownPubkeys.length - i}">
        <ProfileAvatar
          profile={authorProfiles.get(pubkey) || null}
          {pubkey}
          size="xs"
          linkToProfile
          showHoverCard={false}
          fallbackType="robohash"
          class="rounded-full ring-2 ring-base-100"
        />
      </div>
    {/each}
    {#if extraCount > 0}
      <HoverCard position="top">
        {#snippet trigger()}
          <div
            class="relative -ml-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-base-300 text-[10px] font-medium text-base-content/70 ring-2 ring-base-100"
            style="z-index: 0"
          >
            +{extraCount}
          </div>
        {/snippet}
        {#snippet content()}
          <div class="max-h-48 w-56 space-y-1 overflow-y-auto p-3">
            <div class="mb-2 text-xs font-semibold text-base-content/70">
              {m.community_shared_all_label({ count: sharers.length })}
            </div>
            {#each sharers as pubkey (pubkey)}
              <ProfileCard
                {pubkey}
                profile={authorProfiles.get(pubkey)}
                size="sm"
                showNpub={false}
                showIcon={false}
                showHoverCard={false}
                class="!bg-transparent !p-1"
              />
            {/each}
          </div>
        {/snippet}
      </HoverCard>
    {/if}
  </div>
  <span>
    {sharers.length === 1
      ? m.community_shared_single_suffix()
      : m.community_shared_multiple_suffix()}
  </span>
</div>
