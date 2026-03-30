<script>
  /**
   * AttendeeIndicator Component
   * Displays RSVP attendee counts and avatars
   * Supports compact mode (for cards) and expanded mode (for detail pages)
   */
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import ProfileCard from '../shared/ProfileCard.svelte';
  import { getDisplayName } from 'applesauce-core/helpers';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {import('$lib/types/calendar.js').CalendarEventRSVP} CalendarEventRSVP
   */

  let {
    accepted = [],
    tentative = [],
    declined = [],
    totalCount = 0,
    compact = false,
    showViewAll: _showViewAll = false
  } = $props();

  // State for view all modal
  let isViewAllOpen = $state(false);

  // Determine how many avatars to show (max 5 in avatar group)
  const maxAvatars = 5;
  const showAcceptedAvatars = $derived(accepted.slice(0, maxAvatars));
  const remainingAccepted = $derived(Math.max(0, accepted.length - maxAvatars));

  /**
   * Get display name for an attendee
   * @param {any} attendee
   * @returns {string}
   */
  function getAttendeeName(attendee) {
    return getDisplayName(attendee.profile) || `${attendee.pubkey.slice(0, 8)}...`;
  }
</script>

{#if totalCount > 0}
  {#if compact}
    <!-- Compact Mode: For event cards -->
    <div class="flex items-center gap-3 text-sm">
      <div class="flex items-center gap-1 text-base-content/70">
        <span class="text-lg">👥</span>
        <span class="font-medium"
          >{m.attendee_indicator_attendees_label({ count: totalCount })}</span
        >
      </div>

      <div class="flex items-center gap-2">
        <!-- Accepted count with avatar group -->
        {#if accepted.length > 0}
          <div class="flex items-center gap-1">
            <div class="avatar-group -space-x-3">
              {#each showAcceptedAvatars as attendee (attendee.pubkey)}
                <div class="tooltip" data-tip={getAttendeeName(attendee)}>
                  <div class="h-7 w-7 transition-transform hover:scale-110">
                    <div
                      class="w-full rounded-full ring ring-success ring-offset-2 ring-offset-base-100"
                    >
                      <ProfileAvatar
                        pubkey={attendee.pubkey}
                        profile={attendee.profile}
                        size="xs"
                        linkToProfile
                      />
                    </div>
                  </div>
                </div>
              {/each}
              {#if remainingAccepted > 0}
                <div class="placeholder avatar h-7 w-7">
                  <div
                    class="w-full rounded-full bg-success text-success-content ring ring-success ring-offset-2 ring-offset-base-100"
                  >
                    <span class="text-xs">+{remainingAccepted}</span>
                  </div>
                </div>
              {/if}
            </div>
            <span class="badge badge-sm badge-success">{accepted.length}</span>
          </div>
        {/if}

        <!-- Maybe count -->
        {#if tentative.length > 0}
          <span class="badge badge-sm badge-warning">{tentative.length}</span>
        {/if}

        <!-- Declined count -->
        {#if declined.length > 0}
          <span class="badge badge-sm badge-error">{declined.length}</span>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Expanded Mode: For detail pages -->
    <div class="space-y-4">
      <h3 class="text-lg font-semibold text-base-content">
        {m.attendee_indicator_attendees_label({ count: totalCount })}
      </h3>

      <!-- Accepted Attendees -->
      {#if accepted.length > 0}
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <span class="text-xl text-success">✓</span>
            <h4 class="font-medium text-base-content">
              {m.attendee_indicator_accepted_label({ count: accepted.length })}
            </h4>
          </div>
          <div class="ml-6 space-y-2">
            {#each accepted.slice(0, 5) as attendee (attendee.pubkey)}
              {#key attendee.pubkey}
                <ProfileCard
                  pubkey={attendee.pubkey}
                  profile={attendee.profile}
                  size="sm"
                  showNpub={false}
                  class="hover:bg-base-300"
                />
              {/key}
            {/each}
            {#if accepted.length > 5}
              <button
                onclick={() => (isViewAllOpen = true)}
                class="btn w-full text-base-content/60 btn-ghost btn-sm hover:text-base-content"
              >
                {m.attendee_indicator_show_all({ count: accepted.length })}
              </button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Tentative Attendees -->
      {#if tentative.length > 0}
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <span class="text-xl text-warning">?</span>
            <h4 class="font-medium text-base-content">
              {m.attendee_indicator_maybe_label({ count: tentative.length })}
            </h4>
          </div>
          <div class="ml-6 space-y-2">
            {#each tentative.slice(0, 5) as attendee (attendee.pubkey)}
              {#key attendee.pubkey}
                <ProfileCard
                  pubkey={attendee.pubkey}
                  profile={attendee.profile}
                  size="sm"
                  showNpub={false}
                  class="hover:bg-base-300"
                />
              {/key}
            {/each}
            {#if tentative.length > 5}
              <button
                onclick={() => (isViewAllOpen = true)}
                class="btn w-full text-base-content/60 btn-ghost btn-sm hover:text-base-content"
              >
                {m.attendee_indicator_show_all({ count: tentative.length })}
              </button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Declined Attendees -->
      {#if declined.length > 0}
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <span class="text-xl text-error">✗</span>
            <h4 class="font-medium text-base-content">
              {m.attendee_indicator_declined_label({ count: declined.length })}
            </h4>
          </div>
          <div class="ml-6 space-y-2">
            {#each declined.slice(0, 3) as attendee (attendee.pubkey)}
              {#key attendee.pubkey}
                <ProfileCard
                  pubkey={attendee.pubkey}
                  profile={attendee.profile}
                  size="sm"
                  showNpub={false}
                  class="hover:bg-base-300"
                />
              {/key}
            {/each}
            {#if declined.length > 3}
              <button
                onclick={() => (isViewAllOpen = true)}
                class="btn w-full text-base-content/60 btn-ghost btn-sm hover:text-base-content"
              >
                {m.attendee_indicator_show_all({ count: declined.length })}
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
{/if}

<!-- View All Attendees Modal -->
{#if isViewAllOpen}
  <div class="modal-open modal">
    <div class="modal-box max-w-2xl">
      <h3 class="mb-4 text-lg font-bold">
        {m.attendee_indicator_modal_title({ count: totalCount })}
      </h3>

      <!-- Tabbed view for different RSVP statuses -->
      <div role="tablist" class="tabs-boxed mb-4 tabs">
        <button role="tab" class="tab-active tab"
          >{m.attendee_indicator_accepted_label({ count: accepted.length })}</button
        >
        {#if tentative.length > 0}
          <button role="tab" class="tab"
            >{m.attendee_indicator_maybe_label({ count: tentative.length })}</button
          >
        {/if}
        {#if declined.length > 0}
          <button role="tab" class="tab"
            >{m.attendee_indicator_declined_label({ count: declined.length })}</button
          >
        {/if}
      </div>

      <!-- Scrollable attendee list -->
      <div class="max-h-96 space-y-2 overflow-y-auto">
        {#if accepted.length > 0}
          <div class="space-y-2">
            <h4
              class="sticky top-0 z-10 flex items-center gap-2 bg-base-100 py-2 font-semibold text-success"
            >
              <span class="text-xl">✓</span>
              {m.attendee_indicator_accepted_label({ count: accepted.length })}
            </h4>
            {#each accepted as attendee (attendee.pubkey)}
              {#key attendee.pubkey}
                <ProfileCard
                  pubkey={attendee.pubkey}
                  profile={attendee.profile}
                  size="sm"
                  showNpub={false}
                  class="hover:bg-base-300"
                />
              {/key}
            {/each}
          </div>
        {/if}

        {#if tentative.length > 0}
          <div class="mt-4 space-y-2">
            <h4
              class="sticky top-0 z-10 flex items-center gap-2 bg-base-100 py-2 font-semibold text-warning"
            >
              <span class="text-xl">?</span>
              {m.attendee_indicator_maybe_label({ count: tentative.length })}
            </h4>
            {#each tentative as attendee (attendee.pubkey)}
              {#key attendee.pubkey}
                <ProfileCard
                  pubkey={attendee.pubkey}
                  profile={attendee.profile}
                  size="sm"
                  showNpub={false}
                  class="hover:bg-base-300"
                />
              {/key}
            {/each}
          </div>
        {/if}

        {#if declined.length > 0}
          <div class="mt-4 space-y-2">
            <h4
              class="sticky top-0 z-10 flex items-center gap-2 bg-base-100 py-2 font-semibold text-error"
            >
              <span class="text-xl">✗</span>
              {m.attendee_indicator_declined_label({ count: declined.length })}
            </h4>
            {#each declined as attendee (attendee.pubkey)}
              {#key attendee.pubkey}
                <ProfileCard
                  pubkey={attendee.pubkey}
                  profile={attendee.profile}
                  size="sm"
                  showNpub={false}
                  class="hover:bg-base-300"
                />
              {/key}
            {/each}
          </div>
        {/if}
      </div>

      <div class="modal-action">
        <button class="btn" onclick={() => (isViewAllOpen = false)}
          >{m.attendee_indicator_modal_close()}</button
        >
      </div>
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={() => (isViewAllOpen = false)}></div>
  </div>
{/if}
