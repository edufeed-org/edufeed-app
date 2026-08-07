<!--
  CalendarEventModal Component
  Modal for creating and editing calendar events with form validation
-->

<script>
  import { SvelteDate } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { validateEventForm, getCurrentTimezone } from '../../helpers/calendar.js';
  import { encodeEventToNaddr } from '../../helpers/nostrUtils.js';
  import { getCalendarRelays } from '$lib/helpers/relay-helper.js';
  import { useCalendarActions } from '../../stores/calendar-actions.svelte.js';
  import { useCalendarManagement } from '../../stores/calendar-management-store.svelte.js';
  import { useJoinedCommunitiesList } from '../../stores/joined-communities-list.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import CalendarSelector from './CalendarSelector.svelte';
  import CommunitySelector from './CommunitySelector.svelte';
  import LocationInput from '../shared/LocationInput.svelte';
  import EuropeanDateInput from '../shared/EuropeanDateInput.svelte';
  import EuropeanTimeInput from '../shared/EuropeanTimeInput.svelte';
  import LicensedImageInput from '../shared/LicensedImageInput.svelte';
  import { useUserProfile } from '../../stores/user-profile.svelte.js';
  import EditableList from '../shared/EditableList.svelte';
  import ParticipantsEditor from '$lib/components/calendar/ParticipantsEditor.svelte';
  import { CloseIcon } from '../icons';

  /**
   * @typedef {import('../../types/calendar.js').EventFormData} EventFormData
   * @typedef {import('../../types/calendar.js').EventType} EventType
   */

  // Modal ID for dialog element
  const modalId = 'calendar-event-modal';

  // Get props from modal store
  let communityPubkey = $derived(
    /** @type {string} */ (/** @type {any} */ (modalStore.modalProps)?.communityPubkey) || ''
  );
  let selectedDate = $derived(
    /** @type {Date | null} */ (/** @type {any} */ (modalStore.modalProps)?.selectedDate) || null
  );
  let mode = $derived(
    /** @type {'create' | 'edit'} */ (/** @type {any} */ (modalStore.modalProps)?.mode) || 'create'
  );
  let existingEvent = $derived(
    /** @type {any} */ (/** @type {any} */ (modalStore.modalProps)?.existingEvent) || null
  );
  let existingRawEvent = $derived(
    /** @type {any} */ (/** @type {any} */ (modalStore.modalProps)?.existingRawEvent) || null
  );

  // Get calendar actions - updates when communityPubkey changes
  // Using $state + $effect instead of $derived because useCalendarActions
  // may mutate a SvelteMap cache, which is not allowed inside $derived
  /** @type {import('../../stores/calendar-actions.svelte.js').CalendarActions | null} */
  // eslint-disable-next-line svelte/prefer-writable-derived -- $derived causes state_unsafe_mutation
  let calendarActions = $state(null);

  $effect(() => {
    calendarActions = useCalendarActions(communityPubkey);
  });

  // Form state
  /** @type {EventFormData} */
  let formData = $state({
    title: '',
    summary: '',
    image: '',
    imageWasUploaded: false,
    imageLicenseEvent: null,
    startDate: '',
    startTime: '09:00',
    endDate: '',
    endTime: '10:00',
    startTimezone: getCurrentTimezone(),
    endTimezone: getCurrentTimezone(),
    location: '',
    isAllDay: false,
    eventType: 'date',
    references: [],
    participants: []
  });

  let validationErrors = $state(/** @type {string[]} */ ([]));
  let isSubmitting = $state(false);
  let submitError = $state('');

  // Reactive user state
  let activeUser = $state(manager.active);
  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription.unsubscribe();
  });

  // Get calendar management and joined communities for authenticated user
  let calendarManagement = $state(
    /** @type {import('../../stores/calendar-management-store.svelte.js').CalendarManagementStore | null} */ (
      null
    )
  );

  $effect(() => {
    if (activeUser) {
      calendarManagement = useCalendarManagement(activeUser.pubkey);
    } else {
      calendarManagement = null;
    }
  });

  const getOwnProfile = $derived(activeUser ? useUserProfile(activeUser.pubkey) : null);
  const ownProfile = $derived(getOwnProfile ? getOwnProfile() : null);

  const getJoinedCommunities = useJoinedCommunitiesList();
  const joinedCommunities = $derived(getJoinedCommunities());

  // Calendar and community selection state
  let selectedCalendarIds = $state(/** @type {string[]} */ ([]));
  let selectedCommunityIds = $state(/** @type {string[]} */ ([]));

  /**
   * Sync dialog open/close with modal store state
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    if (modalStore.activeModal === 'calendarEvent') {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  });

  /**
   * Sync dialog close events back to the modal store
   * This handles Escape key and backdrop clicks via native dialog behavior
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      if (modalStore.activeModal === 'calendarEvent') {
        resetFormState();
        modalStore.closeModal();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  // Initialize form when modal opens
  $effect(() => {
    if (modalStore.activeModal === 'calendarEvent') {
      if (mode === 'edit' && existingEvent) {
        initializeFormForEdit();
        // Pre-select the communities the event is already shared with (its
        // h-tags) so editing doesn't look like — or silently cause — an
        // un-share. Non-joined communities stay in the list untouched; the
        // selector simply doesn't render them.
        selectedCommunityIds = (existingRawEvent?.tags || [])
          .filter((/** @type {string[]} */ t) => t[0] === 'h' && t[1])
          .map((/** @type {string[]} */ t) => t[1]);
      } else {
        initializeForm();
        selectedCommunityIds = [];
      }
      selectedCalendarIds = [];
    }
  });

  /**
   * Reset form state to initial values
   */
  function resetFormState() {
    formData = {
      title: '',
      summary: '',
      image: '',
      imageWasUploaded: false,
      imageLicenseEvent: null,
      startDate: '',
      startTime: '09:00',
      endDate: '',
      endTime: '10:00',
      startTimezone: getCurrentTimezone(),
      endTimezone: getCurrentTimezone(),
      location: '',
      isAllDay: false,
      eventType: 'date',
      references: [],
      participants: []
    };
    validationErrors = [];
    isSubmitting = false;
    submitError = '';
    selectedCalendarIds = [];
    selectedCommunityIds = [];
  }

  /**
   * Initialize form with default values for creating new event
   */
  function initializeForm() {
    const today = selectedDate || new SvelteDate();
    const tomorrow = new SvelteDate(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    formData = {
      title: '',
      summary: '',
      image: '',
      imageWasUploaded: false,
      imageLicenseEvent: null,
      startDate: today.toISOString().split('T')[0],
      startTime: '09:00',
      endDate: tomorrow.toISOString().split('T')[0],
      endTime: '10:00',
      startTimezone: getCurrentTimezone(),
      endTimezone: getCurrentTimezone(),
      location: '',
      isAllDay: false,
      eventType: 'date',
      references: [],
      participants: []
    };

    validationErrors = [];
    isSubmitting = false;
    submitError = '';
  }

  /**
   * Initialize form with existing event data for editing
   */
  function initializeFormForEdit() {
    if (!existingEvent) return;

    // Convert Unix timestamps to Date objects
    const startDate = new SvelteDate(existingEvent.start * 1000);
    const endDate = existingEvent.end ? new SvelteDate(existingEvent.end * 1000) : null;

    // Determine event type
    const isAllDay = existingEvent.kind === 31922;
    const eventType = isAllDay ? 'date' : 'time';

    // Extract location from event (handle both single string and array formats)
    let location = '';
    if (existingEvent.location) {
      location = existingEvent.location;
    } else if (existingEvent.locations && existingEvent.locations.length > 0) {
      location = existingEvent.locations[0];
    }

    formData = {
      title: existingEvent.title || '',
      summary: existingEvent.summary || '',
      image: existingEvent.image || '',
      imageWasUploaded: false,
      imageLicenseEvent: null,
      startDate: startDate.toISOString().split('T')[0],
      startTime: startDate.toTimeString().slice(0, 5),
      endDate: endDate ? endDate.toISOString().split('T')[0] : '',
      endTime: endDate ? endDate.toTimeString().slice(0, 5) : '10:00',
      startTimezone: existingEvent.startTimezone || getCurrentTimezone(),
      endTimezone: existingEvent.endTimezone || getCurrentTimezone(),
      location: location,
      isAllDay: isAllDay,
      eventType: eventType,
      references: existingEvent.references || [],
      participants: existingEvent.participants || []
    };

    validationErrors = [];
    isSubmitting = false;
    submitError = '';
  }

  /**
   * Validate URL format
   * @param {string} url
   * @returns {string | null} Error message or null if valid
   */
  function validateUrl(url) {
    try {
      new URL(url);
      return null;
    } catch {
      return m.event_modal_error_invalid_url();
    }
  }

  /**
   * Handle event type change
   * @param {EventType} newType
   */
  function handleEventTypeChange(newType) {
    formData.eventType = newType;
    formData.isAllDay = newType === 'date';
  }

  /**
   * Handle form submission
   * @param {Event} e
   */
  async function handleSubmit(e) {
    e.preventDefault();

    // Validate form
    validationErrors = validateEventForm(formData);
    if (validationErrors.length > 0) {
      return;
    }

    // Ensure calendarActions is available
    if (!calendarActions) {
      submitError = 'Calendar actions not ready. Please try again.';
      console.error('calendarActions is null in handleSubmit');
      return;
    }

    isSubmitting = true;
    submitError = '';

    try {
      let resultEvent = /** @type {any} */ (null);

      if (mode === 'edit' && existingRawEvent) {
        // Update existing event, applying the (pre-selected) community set so
        // unchanged selections keep the sharing state and edits to it stick.
        resultEvent = await calendarActions.updateEvent(
          formData,
          existingRawEvent,
          null,
          selectedCommunityIds
        );

        handleClose();
        // Refresh data to show the updated event
        // Using invalidateAll() instead of window.location.reload() to preserve
        // the JavaScript context
        await invalidateAll();
      } else {
        // Merge current community + selected communities into one array of h-tags
        const allCommunityPubkeys = [communityPubkey, ...selectedCommunityIds].filter(Boolean);

        // Create new event with all h-tags at creation time
        resultEvent = await calendarActions.createEvent(formData, allCommunityPubkeys);

        // Only proceed with calendar operations if event was created successfully
        if (resultEvent && resultEvent.id) {
          // Add event to selected calendars (event already has dTag from createEvent)
          if (calendarManagement && selectedCalendarIds.length > 0) {
            await Promise.all(
              selectedCalendarIds.map((calendarId) =>
                calendarManagement?.addEventToCalendar(calendarId, resultEvent)
              )
            );
          }

          // Generate naddr with relay hints and navigate to event page
          const relayHints = getCalendarRelays().slice(0, 3); // Limit to 3 per NIP-19
          const naddr = encodeEventToNaddr(resultEvent, relayHints);

          handleClose();

          // Navigate to the event page
          await goto(/** @type {string} */ (resolve(`/calendar/event/${naddr}`)));
        }
      }
    } catch (error) {
      console.error(`Error ${mode === 'edit' ? 'updating' : 'creating'} event:`, error);
      submitError =
        error instanceof Error
          ? error.message
          : `Failed to ${mode === 'edit' ? 'update' : 'create'} event`;
    } finally {
      isSubmitting = false;
    }
  }

  /**
   * Handle modal close
   */
  function handleClose() {
    resetFormState();
    modalStore.closeModal();
  }
</script>

<!-- Modal -->
{#if modalStore.activeModal === 'calendarEvent'}
  <dialog id={modalId} class="modal" aria-labelledby="calendar-event-modal-title">
    <div class="modal-box max-h-screen w-full max-w-2xl overflow-y-auto">
      <!-- Modal Header -->
      <div class="mb-4 flex items-center justify-between">
        <h2 id="calendar-event-modal-title" class="text-xl font-semibold text-base-content">
          {mode === 'edit' ? m.event_modal_title_edit() : m.event_modal_title_create()}
        </h2>
        <button
          class="btn btn-circle btn-ghost btn-sm"
          onclick={handleClose}
          aria-label={m.event_modal_close_modal()}
          disabled={isSubmitting}
        >
          <CloseIcon class_="w-6 h-6" />
        </button>
      </div>

      <!-- Modal Body -->
      <form onsubmit={handleSubmit}>
        <!-- Event Type Selector -->
        <div class="mb-4">
          <span class="mb-1 block text-sm font-medium text-base-content"
            >{m.event_modal_type_label()}</span
          >
          <!--
            The type is LOCKED when editing. All-day is NIP-52 kind 31922 and
            timed is 31923, and a replaceable event is addressed by
            (kind, pubkey, d-tag) — so switching would publish to a different
            coordinate, leaving the original live and the naddr in the URL
            still pointing at it. The user would see a save that did nothing.
            `updateEvent` refuses the change too; this only stops the user
            reaching a control that cannot work. (#65)
          -->
          <div
            class="flex rounded-lg bg-base-200 p-1"
            role="group"
            aria-label={m.event_modal_type_label()}
          >
            <button
              type="button"
              disabled={mode === 'edit'}
              title={mode === 'edit' ? m.event_modal_type_locked_hint() : undefined}
              class="focus:ring-opacity-50 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus:ring-2 focus:ring-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 {formData.eventType ===
              'date'
                ? 'bg-base-100 text-primary shadow-sm'
                : 'text-base-content/60 hover:bg-base-300 hover:text-base-content'}"
              onclick={() => handleEventTypeChange('date')}
            >
              {m.event_modal_type_all_day()}
            </button>
            <button
              type="button"
              disabled={mode === 'edit'}
              title={mode === 'edit' ? m.event_modal_type_locked_hint() : undefined}
              class="focus:ring-opacity-50 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus:ring-2 focus:ring-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 {formData.eventType ===
              'time'
                ? 'bg-base-100 text-primary shadow-sm'
                : 'text-base-content/60 hover:bg-base-300 hover:text-base-content'}"
              onclick={() => handleEventTypeChange('time')}
            >
              {m.event_modal_type_timed()}
            </button>
          </div>
          {#if mode === 'edit'}
            <p class="mt-1 text-xs text-base-content/60">{m.event_modal_type_locked_hint()}</p>
          {/if}
        </div>

        <!-- Event Title -->
        <div class="mb-4">
          <label for="title" class="mb-1 block text-sm font-medium text-base-content">
            {m.event_modal_event_title()} <span class="text-error">*</span>
          </label>
          <input
            id="title"
            type="text"
            class="input-bordered input w-full"
            bind:value={formData.title}
            placeholder={m.event_modal_enter_event_title()}
            required
          />
        </div>

        <!-- Event Description -->
        <div class="mb-4">
          <label for="summary" class="mb-1 block text-sm font-medium text-base-content"
            >{m.event_modal_description()}</label
          >
          <textarea
            id="summary"
            class="textarea-bordered resize-vertical textarea w-full"
            bind:value={formData.summary}
            placeholder={m.event_modal_enter_event_description()}
            rows="3"
          ></textarea>
        </div>

        <!-- Date and Time -->
        <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="mb-4">
            <label for="startDate" class="mb-1 block text-sm font-medium text-base-content">
              {m.event_modal_start_date_label()} <span class="text-error">*</span>
            </label>
            <EuropeanDateInput id="startDate" bind:value={formData.startDate} required />
          </div>

          {#if formData.eventType === 'time'}
            <div class="mb-4">
              <label for="startTime" class="mb-1 block text-sm font-medium text-base-content">
                {m.event_modal_start_time_label()} <span class="text-error">*</span>
              </label>
              <EuropeanTimeInput id="startTime" bind:value={formData.startTime} required />
            </div>
          {/if}
        </div>

        <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="mb-4">
            <label for="endDate" class="mb-1 block text-sm font-medium text-base-content"
              >{m.event_modal_end_date_label()}</label
            >
            <EuropeanDateInput id="endDate" bind:value={formData.endDate} />
          </div>

          {#if formData.eventType === 'time'}
            <div class="mb-4">
              <label for="endTime" class="mb-1 block text-sm font-medium text-base-content"
                >{m.event_modal_end_time_label()}</label
              >
              <EuropeanTimeInput id="endTime" bind:value={formData.endTime} />
            </div>
          {/if}
        </div>

        <!-- Location with Autocomplete -->
        <div class="mb-4">
          <LocationInput
            bind:value={formData.location}
            label={m.event_modal_location_label()}
            placeholder={m.event_modal_location_placeholder()}
          />
        </div>

        <!-- Event Image (upload or URL, with license attestation — #13) -->
        <div class="mb-4">
          <span class="mb-1 block text-sm font-medium text-base-content"
            >{m.event_modal_image_label()}</span
          >
          <LicensedImageInput
            bind:imageUrl={formData.image}
            bind:imageWasUploaded={formData.imageWasUploaded}
            bind:licenseEvent={formData.imageLicenseEvent}
            activeUserDisplayName={ownProfile?.display_name ?? ownProfile?.name ?? ''}
          />
        </div>

        <!-- Reference Links (Optional) -->
        <div class="mb-4">
          <EditableList
            bind:items={formData.references}
            label={m.event_modal_references_label()}
            placeholder={m.event_modal_references_placeholder()}
            buttonText={m.event_modal_references_button()}
            itemType="link"
            validator={validateUrl}
            helpText={m.event_modal_references_help()}
          />
        </div>

        <!-- Participants (Optional) -->
        <div class="mb-4">
          <ParticipantsEditor bind:participants={formData.participants} disabled={isSubmitting} />
        </div>

        <!-- Calendar Selection (Optional) -->
        {#if activeUser && calendarManagement && calendarManagement.calendars.length > 0}
          <div class="mb-4 border-t border-base-300 pt-4">
            <h3 class="mb-2 text-sm font-semibold text-base-content">
              {m.event_modal_calendars_section()}
            </h3>
            <CalendarSelector
              calendars={calendarManagement.calendars}
              bind:selectedCalendarIds
              title={m.event_modal_calendars_title()}
              showSelectAll={true}
            />
          </div>
        {/if}

        <!-- Community Selection (Optional) -->
        {#if activeUser && joinedCommunities.length > 0}
          <div class="mb-4 border-t border-base-300 pt-4">
            <h3 class="mb-2 text-sm font-semibold text-base-content">
              {m.event_modal_communities_section()}
            </h3>
            <CommunitySelector
              communities={joinedCommunities}
              bind:selectedCommunityIds
              communitiesWithShares={new Set()}
              title={m.event_modal_communities_title()}
              showSelectAll={true}
            />
          </div>
        {/if}

        <!-- Validation Errors -->
        {#if validationErrors.length > 0}
          <div class="mb-4 alert alert-error">
            {#each validationErrors as error, index (index)}
              <div class="text-sm">{error}</div>
            {/each}
          </div>
        {/if}

        <!-- Submit Error -->
        {#if submitError}
          <div class="mb-4 alert alert-error">
            <div class="text-sm">{submitError}</div>
          </div>
        {/if}

        <!-- Form Actions -->
        <div class="flex justify-end gap-3 border-t border-base-300 pt-4">
          <button
            type="button"
            class="btn btn-outline"
            onclick={handleClose}
            disabled={isSubmitting}
          >
            {m.event_modal_cancel_button()}
          </button>
          <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
            {#if isSubmitting}
              {mode === 'edit' ? m.event_modal_updating() : m.event_modal_creating()}
            {:else}
              {mode === 'edit' ? m.event_modal_update_button() : m.event_modal_create_button()}
            {/if}
          </button>
        </div>
      </form>
    </div>
    <!-- Backdrop for clicking outside to close -->
    <form method="dialog" class="modal-backdrop">
      <button disabled={isSubmitting}>close</button>
    </form>
  </dialog>
{/if}
