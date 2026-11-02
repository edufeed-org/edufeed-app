<!--
  FollowListModal — the people behind "N Follower" / "M Gefolgt" on a
  profile (issue 891be310): profile cards, the viewer's own follows first
  and marked, PAGE at a time (each card loads its profile).
-->
<script>
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import { knownFirst } from '$lib/helpers/follow-graph.js';
  import * as m from '$lib/paraglide/messages';

  const PAGE = 50;

  /** @type {{ title: string, pubkeys: string[], viewerFollows: string[], onclose: () => void }} */
  let { title, pubkeys, viewerFollows, onclose } = $props();

  let shownCount = $state(PAGE);
  const ordered = $derived(knownFirst(pubkeys, viewerFollows));
  const known = $derived(new Set(viewerFollows));
</script>

<div class="modal-open modal" role="dialog" aria-label={title}>
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-extrabold">{title}</h3>
    <ul class="my-3 max-h-[60vh] space-y-2 overflow-y-auto">
      {#each ordered.slice(0, shownCount) as pubkey (pubkey)}
        <li class="flex items-center gap-2" data-testid="follow-list-row" data-pubkey={pubkey}>
          <div class="min-w-0 flex-1">
            <ProfileCard {pubkey} size="sm" showIcon={false} showNip05 />
          </div>
          {#if known.has(pubkey)}
            <span class="badge shrink-0 badge-ghost badge-sm" data-testid="follow-list-known">
              {m.profile_follow_list_you_follow()}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
    {#if ordered.length > shownCount}
      <button
        type="button"
        class="btn w-full btn-ghost btn-sm"
        onclick={() => (shownCount += PAGE)}
      >
        {m.common_show_more()}
      </button>
    {/if}
    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={onclose}>{m.common_close()}</button>
    </div>
  </div>
  <button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={onclose}
  ></button>
</div>
