<!--
  CalendarEventModal Component
  Modal for creating and editing calendar events with form validation
-->

<script>
  import { tick } from 'svelte';
  import { SvelteDate } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { validateEventForm, getCurrentTimezone } from '../../helpers/calendar.js';
  import { encodeEventToNaddr } from '../../helpers/nostrUtils.js';
  import { getCalendarRelays } from '$lib/helpers/relay-helper.js';
  import { useCalendarActions } from '../../stores/calendar-actions.svelte.js';
  import { useCalendarManagement } from '../../stores/calendar-management-store.svelte.js';
  // Share surfaces list joined ∪ area-linked communities — a private area's
  // member never (publicly) follow-set-joins, but must still be able to share.
  import { useShareableCommunities } from '$lib/helpers/shareable-communities.svelte.js';
  import { useShareRestrictions } from '$lib/stores/share-restrictions.svelte.js';
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
  import { normalizeHashtag, normalizeHashtags } from '$lib/helpers/hashtags.js';
  import ParticipantsEditor from '$lib/components/calendar/ParticipantsEditor.svelte';
  import EventAttributesFields from '$lib/components/calendar/EventAttributesFields.svelte';
  import {
    emptyEventAttributes,
    parseCalendarEventAttributes
  } from '$lib/helpers/calendar-attributes.js';
  import { CloseIcon } from '../icons';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { canHaveGuestLink, defaultMeetingSlot } from '$lib/groups/meetings.js';
  import { scheduleGroupMeeting, sendMeetingInvites } from '$lib/groups/schedule-meeting.js';
  import { showToast } from '$lib/helpers/toast';
  import { hasNip44 } from '$lib/helpers/nip44.js';
  import { formatDateParam } from '$lib/helpers/urlParams.js';
  import { followStartDate, followStartTime } from '$lib/helpers/event-form-dates.js';
  import { formDateFromTimestamp } from '$lib/helpers/calendar-timing.js';

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
  // "Termin planen" in a NIP-29 channel (scheduled meetings): the opener
  // passes { pointer: {id, relay}, channelName, channelUrl, memberPubkeys? }.
  // The meeting goes to the group relay only (scheduleGroupMeeting), never
  // through calendarActions' outbox path. Create only — editing a meeting is
  // delete + recreate.
  let groupMeeting = $derived(
    /** @type {import('$lib/groups/schedule-meeting.js').GroupMeeting | null} */ (
      /** @type {any} */ (modalStore.modalProps)?.groupMeeting
    ) || null
  );
  let isGroupMeeting = $derived(!!groupMeeting && mode !== 'edit');
  // Guest link for people off the channel roster — opt-in per meeting.
  let allowGuests = $state(false);

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
    hashtags: [],
    participants: []
  });

  // Whether the user picked the end date themselves; until then it follows
  // the start date (GitHub #9). Plain lets: internal refs, never rendered.
  let endDateEdited = false;
  // Last complete start date, so the end keeps its offset across the empty
  // values the date input binds while the user is mid-typing.
  let lastValidStart = '';

  /** @param {string} value */
  function setStartDate(value) {
    formData.endDate = followStartDate({
      previousStart: lastValidStart,
      nextStart: value,
      endDate: formData.endDate,
      endEdited: endDateEdited
    });
    formData.startDate = value;
    if (value) lastValidStart = value;
  }

  /** @param {string} value */
  function setEndDate(value) {
    formData.endDate = value;
    endDateEdited = true;
  }

  // Same for the end time of a timed event: until the user sets it, it keeps
  // the duration when the start time moves; once set, it is only pushed when
  // the start reaches it. Plain lets, like the date pair above.
  let endTimeEdited = false;
  // The start time the event's duration is measured from: the start as of
  // the last time the end moved. Typing "16:00" binds 01:00 and 16:00 on the
  // way; measuring from such a passing value would blow the duration up.
  let durationFromTime = '';

  /** @param {string} value */
  function setStartTime(value) {
    const next = followStartTime({
      startDate: formData.startDate,
      previousStartTime: durationFromTime,
      nextStartTime: value,
      endDate: formData.endDate,
      endTime: formData.endTime,
      endEdited: endTimeEdited
    });
    const endMoved = next.endTime !== formData.endTime || next.endDate !== formData.endDate;
    formData.endDate = next.endDate;
    formData.endTime = next.endTime;
    formData.startTime = value;
    if (value && (endMoved || !endTimeEdited)) durationFromTime = value;
  }

  /** @param {string} value */
  function setEndTime(value) {
    formData.endTime = value;
    endTimeEdited = true;
    if (formData.startTime) durationFromTime = formData.startTime;
  }

  let validationErrors = $state(/** @type {string[]} */ ([]));
  let isSubmitting = $state(false);
  let submitError = $state('');

  // The relay refuses passes living past 60 days from now: say so before the
  // organiser submits (the meeting is still created, just without a link).
  let plannedEnd = $derived.by(() => {
    // Same fallback as the submit: no end date means it ends the day it starts.
    const date = formData.endDate || formData.startDate;
    const time = formData.endTime || formData.startTime;
    if (!date || !time) return null;
    const ms = new Date(`${date}T${time}`).getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  });
  let guestsTooFar = $derived(
    isGroupMeeting &&
      allowGuests &&
      plannedEnd !== null &&
      !canHaveGuestLink({ end: plannedEnd }, Math.floor(Date.now() / 1000))
  );

  // Reactive user state
  let activeUser = $state(manager.active);
  // The guest link's code is stored self-encrypted (NIP-44): a signer
  // without it cannot make one, so the toggle is disabled with a hint.
  let canGuests = $derived(hasNip44(activeUser?.signer));
  // Guest links need the channel's relay to speak call passes. A channel
  // without calls yet (a community's General channel starts that way) still
  // offers them to an admin who may switch calls on — scheduling with guests
  // then switches them on (issue d0ab04d0); a plain member is told why not.
  let guestLinksPossible = $derived(
    groupMeeting?.passesSupported === true || groupMeeting?.canEnableCalls === true
  );
  let guestsEnableCalls = $derived(
    groupMeeting?.passesSupported !== true && groupMeeting?.canEnableCalls === true
  );
  let guestsNeedCalls = $derived(
    !guestLinksPossible && isGroupMeeting && groupMeeting?.callsEnabled === false
  );
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

  const getJoinedCommunities = useShareableCommunities();
  // Calendar events land in the Calendar section either way — gate check
  // follows the concrete kind the form will publish (31922 all-day / 31923).
  const getRestricted = useShareRestrictions(
    () => (formData.isAllDay ? 31922 : 31923),
    () => joinedCommunities
  );
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
      hashtags: [],
      participants: [],
      attributes: emptyEventAttributes()
    };
    endDateEdited = false;
    lastValidStart = '';
    endTimeEdited = false;
    durationFromTime = '09:00';
    validationErrors = [];
    isSubmitting = false;
    submitError = '';
    selectedCalendarIds = [];
    selectedCommunityIds = [];
    allowGuests = false;
  }

  /**
   * Initialize form with default values for creating new event
   */
  function initializeForm() {
    const now = new Date();
    const today = selectedDate || new SvelteDate(now.getTime());
    // A channel meeting is always timed (kind 31923).
    const meeting = isGroupMeeting;
    // …and opened for today it starts at the next half hour, not at an
    // already-past 09:00 (QA round 3 C1).
    const slot =
      meeting && formatDateParam(today) === formatDateParam(now) ? defaultMeetingSlot(now) : null;
    // Local day: toISOString() names the UTC day, which east of UTC just
    // after midnight is still yesterday.
    const startDay = slot?.startDate ?? formatDateParam(today);

    formData = {
      title: '',
      summary: '',
      image: '',
      imageWasUploaded: false,
      imageLicenseEvent: null,
      startDate: startDay,
      startTime: slot?.startTime ?? '09:00',
      // A new event ends the day it starts (GitHub #9). All-day ends are
      // stored inclusively, so for kind 31922 this is a one-day event.
      endDate: slot?.endDate ?? startDay,
      endTime: slot?.endTime ?? '10:00',
      startTimezone: getCurrentTimezone(),
      endTimezone: getCurrentTimezone(),
      location: '',
      isAllDay: false,
      eventType: meeting ? 'time' : 'date',
      references: [],
      hashtags: [],
      participants: [],
      attributes: emptyEventAttributes()
    };
    endDateEdited = false;
    endTimeEdited = false;
    // Never read formData here: this runs inside the open-modal $effect.
    lastValidStart = startDay;
    durationFromTime = slot?.startTime ?? '09:00';

    validationErrors = [];
    isSubmitting = false;
    submitError = '';
    allowGuests = false;
  }

  /**
   * Initialize form with existing event data for editing
   */
  function initializeFormForEdit() {
    if (!existingEvent) return;

    // Convert Unix timestamps to Date objects
    const startDate = new SvelteDate(existingEvent.start * 1000);
    const endDate = existingEvent.end ? new SvelteDate(existingEvent.end * 1000) : null;

    // All-day days are UTC days, timed ones local (formDateFromTimestamp).
    const startDay = formDateFromTimestamp(existingEvent.start, existingEvent.kind);

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
      startDate: startDay,
      startTime: startDate.toTimeString().slice(0, 5),
      endDate: endDate ? formDateFromTimestamp(existingEvent.end, existingEvent.kind) : '',
      endTime: endDate ? endDate.toTimeString().slice(0, 5) : '10:00',
      startTimezone: existingEvent.startTimezone || getCurrentTimezone(),
      endTimezone: existingEvent.endTimezone || getCurrentTimezone(),
      location: location,
      isAllDay: isAllDay,
      eventType: eventType,
      references: existingEvent.references || [],
      // Normalized like on save, so a tag repeated in another casing shows once.
      hashtags: normalizeHashtags(existingEvent.hashtags),
      participants: existingEvent.participants || [],
      // Educational attributes round-trip from the parsed event (#13).
      attributes:
        $state.snapshot(existingEvent.attributes) ??
        parseCalendarEventAttributes(existingRawEvent?.tags)
    };
    // An existing event's stored end is a choice: it stays put and only
    // follows when the start is moved past it.
    endDateEdited = true;
    lastValidStart = startDay;
    // Only a stored end is a choice; without one the end time is a default.
    endTimeEdited = Boolean(endDate);
    durationFromTime = startDate.toTimeString().slice(0, 5);

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
   * Reject input that normalizes to nothing (e.g. a bare "#").
   * @param {string} hashtag - already normalized by EditableList
   * @returns {string | null}
   */
  function validateHashtag(hashtag) {
    return hashtag ? null : m.event_modal_hashtags_error_empty();
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

    if (isGroupMeeting && groupMeeting) {
      await submitGroupMeeting(groupMeeting);
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
   * Schedule the meeting on the channel's group relay, then copy the guest
   * link (if any) and send the invitations. Invitations never block the
   * meeting: they run after the dialog closed, failures end in one toast.
   * @param {import('$lib/groups/schedule-meeting.js').GroupMeeting} meeting
   */
  async function submitGroupMeeting(meeting) {
    const user = activeUser;
    if (!user) {
      submitError = m.meeting_modal_failed();
      return;
    }
    isSubmitting = true;
    submitError = '';
    const form = $state.snapshot(formData);
    if (!form.endDate) form.endDate = form.startDate;

    let result;
    try {
      result = await scheduleGroupMeeting({
        relayConn: pool.relay(meeting.pointer.relay),
        formData: form,
        groupMeeting: meeting,
        user,
        origin: window.location.origin,
        allowGuests: allowGuests && canGuests && guestLinksPossible
      });
    } catch (error) {
      console.error('Error scheduling meeting:', error);
      submitError =
        error instanceof Error && error.message ? error.message : m.meeting_modal_failed();
      isSubmitting = false;
      return;
    }

    // Copy first: the click's user activation may not survive much longer.
    let copied = false;
    if (result.guestUrl) {
      try {
        await navigator.clipboard.writeText(result.guestUrl);
        copied = true;
      } catch {
        copied = false;
      }
    }

    handleClose();
    // A toast lands inside the topmost open <dialog>: wait for ours to go.
    await tick();
    if (result.guestStatus === 'created') {
      showToast(
        copied
          ? m.meeting_scheduled_link_copied_toast()
          : m.meeting_scheduled_link_not_copied_toast(),
        'success'
      );
    } else if (result.guestStatus === 'too_far') {
      showToast(m.meeting_scheduled_too_far_toast(), 'info');
    } else if (result.guestStatus === 'failed') {
      showToast(m.meeting_scheduled_link_failed_toast(), 'warning');
    } else {
      showToast(m.meeting_scheduled_toast(), 'success');
    }

    try {
      const { failed } = await sendMeetingInvites({
        participants: form.participants,
        self: user.pubkey,
        memberPubkeys: meeting.memberPubkeys,
        guestUrl: result.guestUrl,
        title: form.title.trim(),
        start: result.start,
        channelName: meeting.channelName,
        channelUrl: meeting.channelUrl
      });
      if (failed.length > 0) {
        showToast(m.meeting_invites_failed_toast({ count: failed.length }), 'warning');
      }
    } catch (error) {
      console.warn('meeting: invitations failed', error);
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
          {#if isGroupMeeting && groupMeeting}
            {m.meeting_modal_title({ channel: groupMeeting.channelName })}
          {:else}
            {mode === 'edit' ? m.event_modal_title_edit() : m.event_modal_title_create()}
          {/if}
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
        <!-- Event Type Selector (a channel meeting is always timed) -->
        {#if !isGroupMeeting}
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
        {/if}

        <!-- Event Title -->
        <div class="mb-4">
          <label for="title" class="mb-1 block text-sm font-medium text-base-content">
            {isGroupMeeting ? m.meeting_modal_title_label() : m.event_modal_event_title()}
            <span class="text-error">*</span>
          </label>
          <input
            id="title"
            type="text"
            class="input-bordered input w-full"
            bind:value={formData.title}
            placeholder={isGroupMeeting
              ? m.meeting_modal_title_placeholder()
              : m.event_modal_enter_event_title()}
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
            placeholder={isGroupMeeting
              ? m.meeting_modal_description_placeholder()
              : m.event_modal_enter_event_description()}
            rows="3"
          ></textarea>
        </div>

        <!-- Date and Time -->
        <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="mb-4">
            <label for="startDate" class="mb-1 block text-sm font-medium text-base-content">
              {m.event_modal_start_date_label()} <span class="text-error">*</span>
            </label>
            <EuropeanDateInput
              id="startDate"
              bind:value={() => formData.startDate, setStartDate}
              required
            />
          </div>

          {#if formData.eventType === 'time'}
            <div class="mb-4">
              <label for="startTime" class="mb-1 block text-sm font-medium text-base-content">
                {m.event_modal_start_time_label()} <span class="text-error">*</span>
              </label>
              <EuropeanTimeInput
                id="startTime"
                bind:value={() => formData.startTime, setStartTime}
                required
              />
            </div>
          {/if}
        </div>

        <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="mb-4">
            <label for="endDate" class="mb-1 block text-sm font-medium text-base-content"
              >{m.event_modal_end_date_label()}</label
            >
            <EuropeanDateInput id="endDate" bind:value={() => formData.endDate, setEndDate} />
          </div>

          {#if formData.eventType === 'time'}
            <div class="mb-4">
              <label for="endTime" class="mb-1 block text-sm font-medium text-base-content"
                >{m.event_modal_end_time_label()}</label
              >
              <EuropeanTimeInput id="endTime" bind:value={() => formData.endTime, setEndTime} />
            </div>
          {/if}
        </div>

        {#if isGroupMeeting}
          <!-- Guest link (the meeting's location is always the channel) —
               only where the channel's relay speaks call passes (GroupChat
               probes it and hands the result in). -->
          {#if guestLinksPossible}
            <div class="mb-4">
              <label class="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  class="toggle toggle-primary toggle-sm"
                  bind:checked={allowGuests}
                  disabled={isSubmitting || !canGuests}
                />
                <span class="text-sm font-medium text-base-content"
                  >{m.meeting_modal_guests_label()}</span
                >
              </label>
              <p class="mt-1 text-xs text-base-content/60">
                {!canGuests
                  ? m.meeting_modal_guests_no_nip44()
                  : guestsEnableCalls
                    ? m.meeting_modal_guests_help_enables_calls()
                    : m.meeting_modal_guests_help()}
              </p>
              {#if guestsTooFar && canGuests}
                <p class="mt-2 alert text-sm alert-info" role="status">
                  {m.meeting_modal_guests_too_far()}
                </p>
              {/if}
            </div>
          {:else if guestsNeedCalls}
            <p class="mb-4 text-xs text-base-content/60" data-testid="meeting-guests-need-calls">
              {m.meeting_modal_guests_calls_off()}
            </p>
          {/if}
        {:else}
          <!-- Educational attributes (#13): registration, cost, format, level -->
          <div class="mb-4">
            <EventAttributesFields bind:attributes={formData.attributes} disabled={isSubmitting} />
          </div>

          <!-- Location with Autocomplete -->
          <div class="mb-4">
            <!-- Online events (#8): the location is a meeting link or just "online" -->
            <LocationInput
              bind:value={formData.location}
              label={formData.attributes?.attendanceMode === 'online'
                ? m.event_modal_location_label_online()
                : m.event_modal_location_label()}
              placeholder={formData.attributes?.attendanceMode === 'online'
                ? m.event_modal_location_placeholder_online()
                : m.event_modal_location_placeholder()}
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
        {/if}

        <!-- Reference Links + Hashtags (Optional) — not for a channel meeting (C5) -->
        {#if !isGroupMeeting}
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
          <!-- Hashtags (NIP-52 t tags, GitHub #6) -->
          <div class="mb-4">
            <EditableList
              bind:items={formData.hashtags}
              label={m.event_modal_hashtags_label()}
              placeholder={m.event_modal_hashtags_placeholder()}
              buttonText={m.event_modal_hashtags_button()}
              itemType="hashtag"
              normalize={normalizeHashtag}
              validator={validateHashtag}
              helpText={m.event_modal_hashtags_help()}
            />
          </div>
        {/if}

        <!-- Participants (Optional) -->
        <div class="mb-4">
          <ParticipantsEditor
            bind:participants={formData.participants}
            disabled={isSubmitting}
            label={isGroupMeeting ? m.meeting_modal_invite_label() : ''}
            help={isGroupMeeting ? m.meeting_modal_invite_help() : ''}
          />
        </div>

        <!-- Calendar Selection (Optional) -->
        <!-- A channel meeting stays on its group relay: no personal calendars
             (kind 31924 goes out via the outbox) and no community shares. -->
        {#if !isGroupMeeting && activeUser && calendarManagement && calendarManagement.calendars.length > 0}
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
        {#if !isGroupMeeting && activeUser && joinedCommunities.length > 0}
          <div class="mb-4 border-t border-base-300 pt-4">
            <h3 class="mb-2 text-sm font-semibold text-base-content">
              {m.event_modal_communities_section()}
            </h3>
            <CommunitySelector
              communities={joinedCommunities}
              bind:selectedCommunityIds
              communitiesWithShares={new Set()}
              restrictedCommunities={getRestricted()}
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
            {#if isGroupMeeting}
              {isSubmitting ? m.meeting_modal_submitting() : m.meeting_modal_submit()}
            {:else if isSubmitting}
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
