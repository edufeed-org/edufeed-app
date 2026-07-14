<!--
  InlineRsvp Component
  Inline RSVP interface with segmented button group for quick status selection
-->

<script>
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useCalendarActions } from '$lib/stores/calendar-actions.svelte';
  import { showToast } from '$lib/helpers/toast.js';
  import CalendarIcon from '$lib/components/icons/calendar/CalendarIcon.svelte';
  import { CalendarEventRSVPsModel } from 'applesauce-common/models';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { calendarEventRsvpLoader } from '$lib/loaders/rsvp.js';
  import { getTagValue } from 'applesauce-core/helpers';
  import * as m from '$lib/paraglide/messages';

  let {
    calendarEvent,
    communityPubkey = '',
    size = 'md',
    showNote = false,
    compact = false
  } = $props();

  // Local state
  let isSubmitting = $state(false);
  let submittingStatus = $state(/** @type {'accepted' | 'tentative' | 'declined' | null} */ (null));
  // Initialize with prop value, but also sync if prop changes
  // User can toggle this locally, and prop changes also sync to it
  // eslint-disable-next-line svelte/prefer-writable-derived -- intentional: needs both prop sync and local toggle
  let showNoteField = $state(false);
  $effect(() => {
    showNoteField = showNote;
  });
  let rsvpNote = $state('');
  let error = $state('');

  // RSVP data management
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSubscription;
  /** @type {any[]} */
  let rsvps = $state([]);

  // Get calendar actions - updates when communityPubkey changes
  // Using $state + $effect instead of $derived because useCalendarActions
  // may mutate a SvelteMap cache, which is not allowed inside $derived
  /** @type {import('../../stores/calendar-actions.svelte.js').CalendarActions | null} */
  // eslint-disable-next-line svelte/prefer-writable-derived -- $derived causes state_unsafe_mutation
  let calendarActions = $state(null);

  $effect(() => {
    calendarActions = useCalendarActions(communityPubkey);
  });

  // Use reactive getter for active user to ensure proper reactivity on login/logout
  const getActiveUser = useActiveUser();
  const isLoggedIn = $derived(!!getActiveUser());

  // Derive user's RSVP status reactively from rsvps array
  let userRsvpStatus = $derived.by(() => {
    const currentUser = getActiveUser();
    if (!currentUser) return null;

    // Find user's most recent RSVP (handle duplicates)
    const userRsvp = rsvps
      .filter((r) => r.pubkey === currentUser.pubkey)
      .sort((a, b) => b.created_at - a.created_at)[0];

    if (!userRsvp) return null;

    // Extract status tag
    return getTagValue(userRsvp, 'status') || 'accepted';
  });

  // Load RSVPs reactively when calendarEvent changes
  $effect(() => {
    if (!calendarEvent?.id) {
      return;
    }

    // Subscribe to loader (fetches RSVPs from relays → EventStore)
    loaderSubscription = calendarEventRsvpLoader(calendarEvent)().subscribe({
      next: () => {
        // Loader handles fetching
      },
      error: (/** @type {any} */ err) => {
        console.error('Error loading RSVPs from relays:', err);
      }
    });

    // Subscribe to CalendarEventRSVPsModel (reactively watches EventStore)
    modelSubscription = eventStore
      .model(CalendarEventRSVPsModel, calendarEvent)
      .subscribe((rsvpEvents) => {
        rsvps = rsvpEvents || [];
      });

    // Cleanup subscriptions
    return () => {
      loaderSubscription?.unsubscribe();
      modelSubscription?.unsubscribe();
    };
  });

  /**
   * Handle RSVP status change
   * @param {'accepted' | 'tentative' | 'declined'} status
   */
  async function handleRsvp(status) {
    if (!isLoggedIn) {
      showToast(m.inline_rsvp_toast_login_required(), 'error');
      return;
    }

    if (!calendarEvent) {
      showToast(m.inline_rsvp_toast_event_unavailable(), 'error');
      return;
    }

    if (!calendarActions) {
      showToast('Calendar actions not ready. Please try again.', 'error');
      console.error('calendarActions is null in handleRsvp');
      return;
    }

    isSubmitting = true;
    submittingStatus = status;
    error = '';

    try {
      await calendarActions.createRsvp(calendarEvent, status, showNoteField ? rsvpNote : '');

      // Success toast
      const statusLabels = {
        accepted: m.inline_rsvp_button_going(),
        tentative: m.inline_rsvp_button_maybe(),
        declined: m.inline_rsvp_button_no()
      };
      showToast(m.inline_rsvp_toast_updated({ status: statusLabels[status] }), 'success');

      // Clear note after successful submit
      if (showNoteField && rsvpNote) {
        rsvpNote = '';
      }
    } catch (err) {
      console.error('Error creating RSVP:', err);
      const errorMsg = err instanceof Error ? err.message : m.inline_rsvp_error_failed();
      error = errorMsg;
      showToast(errorMsg, 'error');
    } finally {
      isSubmitting = false;
      submittingStatus = null;
    }
  }

  /**
   * Toggle note field visibility
   */
  function toggleNoteField() {
    showNoteField = !showNoteField;
  }

  // Size classes - derive reactively from size prop
  const sizeClasses = /** @type {Record<string, string>} */ ({
    sm: 'btn-sm text-xs',
    md: 'btn-md text-sm',
    lg: 'btn-lg text-base'
  });
  const btnClass = $derived(sizeClasses[size] || sizeClasses.md);
</script>

<div class="inline-rsvp {compact ? 'space-y-2' : 'space-y-3'}">
  <!-- RSVP Button Group -->
  <div class="flex flex-col gap-2">
    {#if !isLoggedIn}
      <!-- Not logged in message -->
      <div class="py-2 text-center text-sm text-base-content/60">
        <CalendarIcon class_="w-4 h-4 inline mr-1" />
        {m.inline_rsvp_login_prompt()}
      </div>
    {:else}
      <!-- Status buttons: separate gapped buttons (not a joined group) so the
           selected ring and hover borders never overlap the neighbors -->
      <div class="flex w-full flex-wrap gap-2">
        <!-- Going (Accepted) -->
        <button
          type="button"
          onclick={() => handleRsvp('accepted')}
          disabled={isSubmitting}
          class="btn {btnClass} flex-auto whitespace-nowrap transition-all
						{userRsvpStatus === 'accepted'
            ? 'shadow-md btn-success'
            : 'border-base-300 bg-base-100 text-base-content shadow-sm hover:border-success hover:bg-success/10'}
						{isSubmitting && submittingStatus === 'accepted' ? 'loading' : ''}"
          aria-label="RSVP as Going"
          aria-pressed={userRsvpStatus === 'accepted'}
        >
          {#if isSubmitting && submittingStatus === 'accepted'}
            <span class="loading loading-xs loading-spinner"></span>
          {:else}
            <span class="flex items-center gap-1">
              <span class="text-lg {userRsvpStatus === 'accepted' ? '' : 'text-success'}">✓</span>
              <span>{m.inline_rsvp_button_going()}</span>
            </span>
          {/if}
        </button>

        <!-- Maybe (Tentative) -->
        <button
          type="button"
          onclick={() => handleRsvp('tentative')}
          disabled={isSubmitting}
          class="btn {btnClass} flex-auto whitespace-nowrap transition-all
						{userRsvpStatus === 'tentative'
            ? 'shadow-md btn-warning'
            : 'border-base-300 bg-base-100 text-base-content shadow-sm hover:border-warning hover:bg-warning/10'}
						{isSubmitting && submittingStatus === 'tentative' ? 'loading' : ''}"
          aria-label="RSVP as Maybe"
          aria-pressed={userRsvpStatus === 'tentative'}
        >
          {#if isSubmitting && submittingStatus === 'tentative'}
            <span class="loading loading-xs loading-spinner"></span>
          {:else}
            <span class="flex items-center gap-1">
              <span class="text-lg {userRsvpStatus === 'tentative' ? '' : 'text-warning'}">?</span>
              <span>{m.inline_rsvp_button_maybe()}</span>
            </span>
          {/if}
        </button>

        <!-- Not Going (Declined) -->
        <button
          type="button"
          onclick={() => handleRsvp('declined')}
          disabled={isSubmitting}
          class="btn {btnClass} flex-auto whitespace-nowrap transition-all
						{userRsvpStatus === 'declined'
            ? 'shadow-md btn-error'
            : 'border-base-300 bg-base-100 text-base-content shadow-sm hover:border-error hover:bg-error/10'}
						{isSubmitting && submittingStatus === 'declined' ? 'loading' : ''}"
          aria-label="RSVP as Not Going"
          aria-pressed={userRsvpStatus === 'declined'}
        >
          {#if isSubmitting && submittingStatus === 'declined'}
            <span class="loading loading-xs loading-spinner"></span>
          {:else}
            <span class="flex items-center gap-1">
              <span class="text-lg {userRsvpStatus === 'declined' ? '' : 'text-error'}">✗</span>
              <span>{m.inline_rsvp_button_no()}</span>
            </span>
          {/if}
        </button>
      </div>

      <!-- Toggle Note Button -->
      {#if !compact}
        <button
          type="button"
          onclick={toggleNoteField}
          class="btn self-start btn-ghost btn-xs"
          disabled={isSubmitting}
        >
          {showNoteField ? `− ${m.inline_rsvp_note_hide()}` : `+ ${m.inline_rsvp_note_add()}`}
        </button>
      {/if}

      <!-- Optional Note Field -->
      {#if showNoteField}
        <div class="form-control">
          <textarea
            bind:value={rsvpNote}
            placeholder={m.inline_rsvp_note_placeholder()}
            rows={compact ? 2 : 3}
            disabled={isSubmitting}
            class="textarea-bordered textarea w-full bg-base-100
							textarea-sm text-base-content
							placeholder-base-content/40
							focus:border-primary focus:outline-none"
          ></textarea>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Error Display -->
  {#if error}
    <div class="alert py-2 text-sm alert-error shadow-lg">
      <span>{error}</span>
    </div>
  {/if}
</div>
