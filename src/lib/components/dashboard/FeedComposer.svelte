<!--
  FeedComposer — composer card at the top of the feed (design: feed.html).
  Not a real text composer: the placeholder opens the create hub, and the
  type shortcuts jump straight into the event/resource/article create flows.
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { openCreateHub } from '$lib/stores/create-hub.svelte.js';
  import { CREATE_ACTIONS } from '$lib/config/create-actions.js';
  import { startResourceCreation } from '$lib/helpers/contentCreation.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import * as m from '$lib/paraglide/messages';

  const getActiveUser = useActiveUser();
  const getProfile = useUserProfile();

  let displayName = $derived.by(() => {
    const profile = getProfile();
    const name = profile ? getDisplayName(profile) : '';
    return name && !name.startsWith('npub1') ? name : '';
  });

  const TYPE_ACTION_IDS = ['event', 'resource', 'article'];
  const typeActions = TYPE_ACTION_IDS.map((id) => CREATE_ACTIONS.find((a) => a.id === id)).filter(
    (a) => a !== undefined
  );

  /** @param {import('$lib/config/create-actions.js').CreateAction} action */
  function runAction(action) {
    action.run({
      communityPubkey: '',
      openModal: (name, props) =>
        modalStore.openModal(
          /** @type {import('$lib/stores/modal.svelte.js').ModalType} */ (name),
          props
        ),
      goto,
      resolve: (path) => resolve(/** @type {any} */ (path)),
      startResourceCreation: () => startResourceCreation({ communityPubkey: '' })
    });
  }
</script>

<div
  class="mb-5 flex items-center gap-3 rounded-xl border border-base-300 bg-base-100 p-3.5"
  data-testid="feed-composer"
>
  <ProfileAvatar pubkey={getActiveUser()?.pubkey ?? ''} size="md" />
  <button
    class="min-w-0 flex-1 truncate rounded-lg bg-base-200 px-3.5 py-2.5 text-left text-sm text-base-content/60 transition-colors hover:bg-base-300/60"
    onclick={openCreateHub}
  >
    {displayName
      ? m.feed_composer_placeholder_named({ name: displayName })
      : m.feed_composer_placeholder()}
  </button>
  <div class="flex gap-1">
    {#each typeActions as action (action.id)}
      <button
        class="tooltip grid h-9 w-9 place-items-center rounded-lg text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content"
        data-tip={action.label()}
        aria-label={action.ariaLabel()}
        onclick={() => runAction(action)}
      >
        <action.icon class_="h-4 w-4" />
      </button>
    {/each}
  </div>
</div>
