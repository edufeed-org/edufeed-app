<script>
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useCalendarManagement } from '$lib/stores/calendar-management-store.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  // Use $state + $effect for reactive RxJS subscription bridge (Svelte 5 pattern)
  let activeUser = $state(/** @type {any} */ (null));
  let calendarManagement = $state(/** @type {any} */ (null));

  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
      // Update calendarManagement when activeUser changes
      // This avoids state_unsafe_mutation error that occurs when calling
      // a function that creates $state() inside a $derived() context
      calendarManagement = user ? useCalendarManagement(user.pubkey) : null;
    });
    return () => subscription.unsubscribe();
  });

  // Local state for editing
  let editingCalendarId = $state(/** @type {string | null} */ (null));
  let editTitle = $state('');
  let editDescription = $state('');
  let isUpdating = $state(false);
  let updateError = $state(/** @type {string | null} */ (null));

  // Local state for deletion
  let deletingCalendarId = $state(/** @type {string | null} */ (null));
  let isDeleting = $state(false);
  let deleteError = $state(/** @type {string | null} */ (null));

  /**
   * Start editing a calendar
   * @param {string} calendarId
   */
  function startEditing(calendarId) {
    const calendar = calendarManagement?.calendars.find(
      (/** @type {any} */ c) => c.id === calendarId
    );
    if (calendar) {
      editingCalendarId = calendarId;
      editTitle = calendar.title;
      editDescription = calendar.description;
      updateError = null;
    }
  }

  /**
   * Cancel editing
   */
  function cancelEditing() {
    editingCalendarId = null;
    editTitle = '';
    editDescription = '';
    updateError = null;
  }

  /**
   * Update a calendar
   * @param {string} calendarId
   */
  async function updateCalendar(calendarId) {
    if (!calendarManagement || !activeUser) return;

    const calendar = calendarManagement.calendars.find(
      (/** @type {any} */ c) => c.id === calendarId
    );
    if (!calendar) return;

    isUpdating = true;
    updateError = null;

    try {
      // Build tags for the updated calendar
      const tags = [
        ['d', calendar.dTag],
        ['title', editTitle]
      ];

      // Add all existing event references as 'a' tags
      calendar.eventReferences.forEach((/** @type {string} */ ref) => {
        tags.push(['a', ref]);
      });

      // Create the updated calendar event using EventFactory
      const eventFactory = createAppEventFactory();
      const eventTemplate = await eventFactory.build({
        kind: 31924,
        content: editDescription,
        tags: tags
      });

      // Sign the event
      const signedEvent = await activeUser.signEvent(eventTemplate);

      // Publish using outbox model + calendar relays (for kind 31924)
      const publishResult = await publishEvent(signedEvent);

      if (publishResult.success) {
        eventStore.add(signedEvent);
        // Force refresh to show changes immediately
        await calendarManagement.refresh();

        console.log('📅 Calendar Management: Successfully updated calendar:', editTitle);

        // Reset editing state
        cancelEditing();
      } else {
        throw new Error('Failed to publish calendar update to any relay');
      }
    } catch (error) {
      console.error('Error updating calendar:', error);
      updateError = error instanceof Error ? error.message : 'Failed to update calendar';
    } finally {
      isUpdating = false;
    }
  }

  /**
   * Start deleting a calendar
   * @param {string} calendarId
   */
  function startDeleting(calendarId) {
    deletingCalendarId = calendarId;
    deleteError = null;
  }

  /**
   * Cancel deletion
   */
  function cancelDeleting() {
    deletingCalendarId = null;
    deleteError = null;
  }

  /**
   * Delete a calendar using NIP-09 deletion request
   * @param {string} calendarId
   */
  async function deleteCalendar(calendarId) {
    if (!calendarManagement || !activeUser) return;

    const calendar = calendarManagement.calendars.find(
      (/** @type {any} */ c) => c.id === calendarId
    );
    if (!calendar) return;

    isDeleting = true;
    deleteError = null;

    try {
      // Create NIP-09 deletion request event (kind 5)
      const deletionEventTemplate = await createAppEventFactory().build({
        kind: 5,
        content: 'Calendar deleted by user',
        tags: [
          ['a', `31924:${calendar.pubkey}:${calendar.dTag}`],
          ['k', '31924']
        ]
      });

      // Sign the deletion event
      const signedDeletionEvent = await activeUser.signEvent(deletionEventTemplate);

      // Publish deletion using outbox model
      const publishResult = await publishEvent(signedDeletionEvent);

      if (publishResult.success) {
        eventStore.add(signedDeletionEvent);
        // Force refresh to show changes immediately
        await calendarManagement.refresh();

        console.log('📅 Calendar Management: Successfully deleted calendar:', calendar.title);

        // Reset deletion state
        cancelDeleting();
      } else {
        throw new Error('Failed to publish calendar deletion request to any relay');
      }
    } catch (error) {
      console.error('Error deleting calendar:', error);
      deleteError = error instanceof Error ? error.message : 'Failed to delete calendar';
    } finally {
      isDeleting = false;
    }
  }

  /**
   * Handle create new calendar
   */
  function handleCreateCalendar() {
    modalStore.openModal('createCalendar');
  }

  /**
   * Handle refresh calendars
   */
  async function handleRefresh() {
    if (calendarManagement) {
      await calendarManagement.refresh();
    }
  }

  /**
   * View a calendar by navigating to the calendar-specific route
   * @param {string} calendarId
   */
  function viewCalendar(calendarId) {
    const calendar = calendarManagement?.calendars.find(
      (/** @type {any} */ c) => c.id === calendarId
    );

    if (!calendar) {
      console.error('Calendar not found:', calendarId);
      showToast('Calendar not found', 'error');
      return;
    }

    try {
      // Create minimal event object for naddr encoding
      // encodeEventToNaddr needs: kind, pubkey, and tags with d-tag
      const calendarEvent = {
        kind: calendar.kind, // 31924
        pubkey: calendar.pubkey,
        tags: [['d', calendar.dTag]],
        content: '',
        created_at: 0,
        id: '',
        sig: ''
      };

      // Encode to naddr
      const naddr = encodeEventToNaddr(calendarEvent, []);

      if (!naddr) {
        throw new Error('Failed to encode calendar naddr');
      }

      // Navigate to calendar-specific route
      goto(/** @type {string} */ (resolve(`/calendar/${naddr}`)));
    } catch (error) {
      console.error('Error navigating to calendar:', error);
      showToast('Failed to open calendar', 'error');
    }
  }

  /**
   * Handle clicking on a calendar card
   * @param {MouseEvent | KeyboardEvent} e - Click or keyboard event
   * @param {string} calendarId - Calendar ID
   */
  function handleCardClick(e, calendarId) {
    // Don't navigate if in edit or delete mode
    if (editingCalendarId === calendarId || deletingCalendarId === calendarId) {
      return;
    }

    // Don't navigate if clicking on interactive elements
    const target = /** @type {HTMLElement} */ (e.target);
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('.dropdown')
    ) {
      return;
    }

    // Navigate to calendar view
    viewCalendar(calendarId);
  }

  /**
   * Handle keyboard navigation on calendar cards
   * @param {KeyboardEvent} e - Keyboard event
   * @param {string} calendarId - Calendar ID
   */
  function handleCardKeydown(e, calendarId) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick(e, calendarId);
    }
  }

  /**
   * Copy calendar naddr to clipboard
   * @param {string} calendarId
   */
  async function copyCalendarNaddr(calendarId) {
    const calendar = calendarManagement?.calendars.find(
      (/** @type {any} */ c) => c.id === calendarId
    );
    if (!calendar) return;

    try {
      // Create a minimal event object with the calendar data
      // @ts-ignore - We only need kind, pubkey, and d tag for encoding
      const calendarEvent = {
        kind: 31924,
        pubkey: calendar.pubkey,
        tags: [['d', calendar.dTag]],
        content: '',
        created_at: 0,
        id: '',
        sig: ''
      };

      // Encode to naddr (without relays for now)
      const naddr = encodeEventToNaddr(calendarEvent);

      if (!naddr) {
        throw new Error('Failed to encode calendar naddr');
      }

      // Copy to clipboard
      await navigator.clipboard.writeText(naddr);

      // Show success toast
      showToast('Calendar link copied to clipboard!', 'success');
    } catch (error) {
      console.error('Error copying calendar naddr:', error);
      showToast('Failed to copy calendar link', 'error');
    }
  }
</script>

<svelte:head>
  <title>{m.calendar_management_page_title({ appName: runtimeConfig.appName })}</title>
  <meta name="description" content={m.calendar_management_page_description()} />
</svelte:head>

<div class="container mx-auto max-w-4xl px-4 py-8">
  <!-- Header -->
  <div class="mb-8 flex items-center justify-between">
    <div>
      <h1 class="text-3xl font-bold text-base-content">{m.calendar_management_header_title()}</h1>
      <p class="mt-2 text-base-content/60">{m.calendar_management_header_subtitle()}</p>
    </div>

    <!-- Action buttons -->
    <div class="flex gap-3">
      <button
        class="btn btn-outline btn-primary"
        onclick={handleRefresh}
        disabled={calendarManagement?.loading}
      >
        {#if calendarManagement?.loading}
          <span class="loading loading-sm loading-spinner"></span>
        {:else}
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        {/if}
        {m.calendar_management_refresh_button()}
      </button>

      <button class="btn btn-primary" onclick={handleCreateCalendar}>
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
          />
        </svg>
        {m.calendar_management_new_calendar_button()}
      </button>
    </div>
  </div>

  <!-- Error state -->
  {#if calendarManagement?.error}
    <div class="mb-6 alert alert-error">
      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{calendarManagement.error}</span>
    </div>
  {/if}

  <!-- Loading state -->
  {#if calendarManagement?.loading && calendarManagement.calendars.length === 0}
    <div class="flex items-center justify-center py-12">
      <div class="text-center">
        <span class="loading loading-lg loading-spinner text-primary"></span>
        <p class="mt-4 text-base-content/60">{m.calendar_management_loading()}</p>
      </div>
    </div>
  {:else if !activeUser}
    <!-- Not logged in -->
    <div class="hero min-h-[400px] rounded-box bg-base-100">
      <div class="hero-content text-center">
        <div class="max-w-md">
          <svg
            class="mx-auto h-16 w-16 text-base-content/30"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <h2 class="mt-6 text-2xl font-bold text-base-content">
            {m.calendar_management_not_logged_in_title()}
          </h2>
          <p class="mt-4 text-base-content/60">
            {m.calendar_management_not_logged_in_description()}
          </p>
        </div>
      </div>
    </div>
  {:else if calendarManagement?.calendars.length === 0}
    <!-- Empty state -->
    <div class="hero min-h-[400px] rounded-box bg-base-100">
      <div class="hero-content text-center">
        <div class="max-w-md">
          <svg
            class="mx-auto h-16 w-16 text-base-content/30"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <h2 class="mt-6 text-2xl font-bold text-base-content">
            {m.calendar_management_empty_title()}
          </h2>
          <p class="mt-4 text-base-content/60">
            {m.calendar_management_empty_description()}
          </p>
          <button class="btn mt-6 btn-primary" onclick={handleCreateCalendar}>
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
            {m.calendar_management_empty_create_button()}
          </button>
        </div>
      </div>
    </div>
  {:else}
    <!-- Calendar list -->
    <div class="grid gap-6">
      {#each calendarManagement?.calendars || [] as calendar (calendar.id)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="card border border-base-300 bg-base-100 shadow-lg {editingCalendarId !==
            calendar.id && deletingCalendarId !== calendar.id
            ? 'cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-xl focus:ring-2 focus:ring-primary focus:outline-none'
            : ''}"
          role={editingCalendarId !== calendar.id && deletingCalendarId !== calendar.id
            ? 'button'
            : undefined}
          tabindex={editingCalendarId !== calendar.id && deletingCalendarId !== calendar.id
            ? 0
            : undefined}
          onclick={(e) => handleCardClick(e, calendar.id)}
          onkeydown={(e) => handleCardKeydown(e, calendar.id)}
        >
          <div class="card-body">
            <!-- Calendar header -->
            <div class="flex items-start justify-between">
              <div class="min-w-0 flex-1">
                {#if editingCalendarId === calendar.id}
                  <!-- Edit mode -->
                  <div class="space-y-4">
                    <input
                      type="text"
                      placeholder={m.calendar_management_edit_title_placeholder()}
                      class="input-bordered input w-full"
                      bind:value={editTitle}
                      disabled={isUpdating}
                    />
                    <textarea
                      placeholder={m.calendar_management_edit_description_placeholder()}
                      class="textarea-bordered textarea w-full resize-none"
                      rows="3"
                      bind:value={editDescription}
                      disabled={isUpdating}
                    ></textarea>

                    {#if updateError}
                      <div class="alert py-2 alert-error">
                        <span class="text-sm">{updateError}</span>
                      </div>
                    {/if}

                    <div class="flex gap-2">
                      <button
                        class="btn btn-sm btn-primary"
                        onclick={() => updateCalendar(calendar.id)}
                        disabled={isUpdating || !editTitle.trim()}
                      >
                        {#if isUpdating}
                          <span class="loading loading-sm loading-spinner"></span>
                        {/if}
                        {m.calendar_management_edit_save_button()}
                      </button>
                      <button
                        class="btn btn-ghost btn-sm"
                        onclick={cancelEditing}
                        disabled={isUpdating}
                      >
                        {m.calendar_management_edit_cancel_button()}
                      </button>
                    </div>
                  </div>
                {:else}
                  <!-- Display mode -->
                  <h3 class="card-title text-lg font-semibold text-base-content">
                    {calendar.title}
                  </h3>
                  {#if calendar.description}
                    <p class="mt-1 text-base-content/70">{calendar.description}</p>
                  {/if}
                {/if}
              </div>

              <!-- Action buttons -->
              {#if editingCalendarId !== calendar.id && deletingCalendarId !== calendar.id}
                <div class="dropdown dropdown-end">
                  <button
                    class="btn btn-ghost btn-sm"
                    aria-label={m.calendar_management_menu_actions()}
                  >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                      />
                    </svg>
                  </button>
                  <ul
                    class="dropdown-content menu z-[1] w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
                  >
                    <li>
                      <button type="button" onclick={() => viewCalendar(calendar.id)}>
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                        {m.calendar_management_menu_view_calendar()}
                      </button>
                    </li>
                    <li>
                      <button type="button" onclick={() => copyCalendarNaddr(calendar.id)}>
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        {m.calendar_management_menu_copy_link()}
                      </button>
                    </li>
                    <li>
                      <button type="button" onclick={() => startEditing(calendar.id)}>
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                        {m.calendar_management_menu_edit_calendar()}
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        class="text-error"
                        onclick={() => startDeleting(calendar.id)}
                      >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                        {m.calendar_management_menu_delete_calendar()}
                      </button>
                    </li>
                  </ul>
                </div>
              {/if}
            </div>

            <!-- Calendar stats -->
            {#if editingCalendarId !== calendar.id}
              <div class="mt-4 flex items-center gap-4 text-sm text-base-content/60">
                <div class="flex items-center gap-1">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span
                    >{m.calendar_management_event_count({
                      count: calendar.eventReferences.length
                    })}</span
                  >
                </div>
                <div class="flex items-center gap-1">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span
                    >{m.calendar_management_created_date({
                      date: formatCalendarDate(new Date(calendar.createdAt * 1000), 'short')
                    })}</span
                  >
                </div>
              </div>
            {/if}

            <!-- Delete confirmation -->
            {#if deletingCalendarId === calendar.id}
              <div class="mt-4 rounded-lg border border-error/20 bg-error/10 p-4">
                <div class="flex items-start gap-3">
                  <svg
                    class="mt-0.5 h-5 w-5 flex-shrink-0 text-error"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  <div class="flex-1">
                    <h4 class="font-semibold text-error">{m.calendar_management_delete_title()}</h4>
                    <p class="mt-1 text-sm text-base-content/70">
                      {m.calendar_management_delete_confirmation({ title: calendar.title })}
                    </p>

                    {#if deleteError}
                      <div class="mt-3 alert py-2 alert-error">
                        <span class="text-sm">{deleteError}</span>
                      </div>
                    {/if}

                    <div class="mt-4 flex gap-2">
                      <button
                        class="btn btn-sm btn-error"
                        onclick={() => deleteCalendar(calendar.id)}
                        disabled={isDeleting}
                      >
                        {#if isDeleting}
                          <span class="loading loading-sm loading-spinner"></span>
                        {/if}
                        {m.calendar_management_delete_button()}
                      </button>
                      <button
                        class="btn btn-ghost btn-sm"
                        onclick={cancelDeleting}
                        disabled={isDeleting}
                      >
                        {m.calendar_management_delete_cancel_button()}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>

          <!-- Calendar Creation Modal rendered by ModalManager -->
        </div>
      {/each}
    </div>
  {/if}
</div>
