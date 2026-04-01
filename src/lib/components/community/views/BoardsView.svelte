<!--
  BoardsView Component
  Displays kanban boards (kind 30301) shared with a community
-->

<script>
  import { useKanbanCommunityLoader } from '$lib/loaders/kanban-community.js';
  import { CommunityBoardModel } from '$lib/models/community-content.js';
  import KanbanBoardCard from '$lib/components/kanban/KanbanBoardCard.svelte';
  import SharedByLine from '$lib/components/shared/SharedByLine.svelte';
  import CommunityContentView from './CommunityContentView.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ communityPubkey: string, communityProfile?: any }} */
  let { communityPubkey, communityProfile = null } = $props();
</script>

<CommunityContentView
  {communityPubkey}
  {communityProfile}
  loaderHook={useKanbanCommunityLoader}
  model={CommunityBoardModel}
  loadingText={m.community_boards_loading()}
  emptyTitle={m.community_boards_empty_title()}
  emptyDescription={m.community_boards_empty_description()}
  formatCount={(count) => m.community_boards_count({ count })}
  searchable
  searchPlaceholder={m.community_boards_search_placeholder()}
  emptyIconPath="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
>
  {#snippet content(items, authorProfiles)}
    <div class="space-y-4">
      {#each items as board (board.id)}
        <div>
          {#if board._sharedBy}
            <SharedByLine
              sharerProfile={authorProfiles.get(board._sharedBy) || null}
              sharerPubkey={board._sharedBy}
            />
          {/if}
          <KanbanBoardCard
            {board}
            authorProfile={authorProfiles.get(board.pubkey) || null}
            compact={false}
          />
        </div>
      {/each}
    </div>
  {/snippet}
</CommunityContentView>
