<!--
  PollsView Component
  Displays NIP-88 polls (kind 1068) shared with a community.
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { usePollCommunityLoader } from '$lib/loaders/polls.js';
  import { CommunityPollModel } from '$lib/models/community-content.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getContentEventRoute } from '$lib/helpers/contentNavigation.js';
  import PollCard from '$lib/components/polls/PollCard.svelte';
  import SharedByLine from '$lib/components/shared/SharedByLine.svelte';
  import CommunityContentView from './CommunityContentView.svelte';
  import { PlusIcon } from '$lib/components/icons';

  /** @type {{ communityPubkey: string, communityProfile?: any, canPublish?: boolean }} */
  let { communityPubkey, communityProfile = null, canPublish = true } = $props();

  function openCreate() {
    modalStore.openModal('createPoll', { communityPubkey });
  }

  /** @param {any} poll */
  function navigateToPoll(poll) {
    const route = getContentEventRoute(poll, { communityPubkey });
    if (route) goto(resolve(/** @type {any} */ (route)));
  }
</script>

<CommunityContentView
  {communityPubkey}
  {communityProfile}
  loaderHook={usePollCommunityLoader}
  model={CommunityPollModel}
  loadingText="Loading polls..."
  emptyTitle="No polls yet"
  emptyDescription="Be the first to ask a question."
  formatCount={(count) => `${count} ${count === 1 ? 'poll' : 'polls'}`}
  emptyIconPath="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125Z"
>
  {#snippet headerAction()}
    {#if manager.active && canPublish}
      <button class="btn gap-1 btn-sm btn-primary" onclick={openCreate} aria-label="Create poll">
        <PlusIcon class_="h-4 w-4" />
        Create poll
      </button>
    {/if}
  {/snippet}

  {#snippet content(items, authorProfiles)}
    <div class="flex flex-col gap-4">
      {#each items as poll (poll.id)}
        <div>
          {#if poll._sharedBy}
            <SharedByLine sharers={poll._allSharers || [poll._sharedBy]} {authorProfiles} />
          {/if}
          <PollCard event={poll} onclick={() => navigateToPoll(poll)} />
        </div>
      {/each}
    </div>
  {/snippet}
</CommunityContentView>
