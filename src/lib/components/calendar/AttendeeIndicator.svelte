<script>
  /**
   * AttendeeIndicator Component
   * Displays RSVP attendee counts and avatars
   * Supports compact mode (for cards) and expanded mode (for detail pages)
   */
  import CreatorAvatarStack from '../shared/CreatorAvatarStack.svelte';
  import ProfileCard from '../shared/ProfileCard.svelte';
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

  // Compact mode: at most 5 circles (the last one becomes "+N").
  const maxAvatars = 5;
  const attending = $derived(accepted.length + tentative.length);
  const acceptedCreators = $derived(accepted.map((/** @type {any} */ a) => ({ pubkey: a.pubkey })));
  // "9 Zusagen · 1 vielleicht" — declines deliberately left out.
  const attendingSummary = $derived(
    [
      accepted.length === 1
        ? m.event_card_rsvp_going_one()
        : accepted.length > 1
          ? m.event_card_rsvp_going_other({ count: accepted.length })
          : null,
      tentative.length > 0 ? m.event_card_rsvp_maybe({ count: tentative.length }) : null
    ]
      .filter(Boolean)
      .join(' · ')
  );
</script>

{#if totalCount > 0}
  {#if compact}
    <!-- Compact Mode: one calm line on event cards. Declines are not
         attendees: never pictured, only named when they are all there is. -->
    {#if attending > 0}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-base-content/70"
        onclick={(e) => e.stopPropagation()}
      >
        {#if accepted.length > 0}
          <CreatorAvatarStack creators={acceptedCreators} max={maxAvatars} size="xs" />
        {/if}
        <span data-testid="attendee-summary">{attendingSummary}</span>
      </div>
    {:else}
      <div class="text-sm text-base-content/50" data-testid="attendee-summary">
        {declined.length === 1
          ? m.event_card_rsvp_declined_one()
          : m.event_card_rsvp_declined_other({ count: declined.length })}
      </div>
    {/if}
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
