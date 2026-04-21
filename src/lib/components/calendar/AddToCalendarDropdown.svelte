<!--
  AddToCalendarDropdown Component
  Responsive component for adding events to personal calendars
  - Desktop: Dropdown
  - Mobile: Bottom sheet modal
-->

<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { PlusIcon, ChevronDownIcon } from '../icons';
  import PersonalCalendarShare from './PersonalCalendarShare.svelte';
  import CommunityShare from '../shared/CommunityShare.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ event: any, disabled?: boolean }} */
  let { event, disabled = false } = $props();

  // Reactive user state
  let activeUser = $state(manager.active);
  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription.unsubscribe();
  });

  // State management
  let isOpen = $state(false);
  let isDesktop = $state(true);

  // Responsive behavior
  $effect(() => {
    function handleResize() {
      isDesktop = window.innerWidth >= 768;
    }
    handleResize(); // Initial check
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  /**
   * Toggle dropdown/modal
   */
  function toggleOpen() {
    if (disabled) return;
    isOpen = !isOpen;
  }

  /**
   * Close dropdown/modal
   */
  function close() {
    isOpen = false;
  }

  /**
   * Handle backdrop click for modal
   * @param {MouseEvent} e
   */
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      close();
    }
  }
</script>

{#if isDesktop}
  <!-- Desktop: Dropdown -->
  <div class="dropdown dropdown-end" class:dropdown-open={isOpen}>
    <button tabindex="0" class="btn gap-2 btn-sm btn-primary" onclick={toggleOpen} {disabled}>
      <PlusIcon class_="w-4 h-4" />
      {m.add_to_calendar_dropdown_button_label()}
      <ChevronDownIcon class_="w-4 h-4" />
    </button>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      tabindex="0"
      class="dropdown-content menu z-50 mt-2 w-96 rounded-lg bg-base-100 p-4 shadow-xl"
    >
      {#if activeUser}
        <PersonalCalendarShare {event} {activeUser} compact={true} />

        <div class="divider my-2"></div>

        <CommunityShare event={event.originalEvent} {activeUser} compact={true} />
      {:else}
        <div class="py-4 text-center text-sm text-base-content/60">
          {m.add_to_calendar_dropdown_signin_required()}
        </div>
      {/if}
    </div>
  </div>
{:else}
  <!-- Mobile: Button that opens modal -->
  <button class="btn gap-2 btn-sm btn-primary" onclick={toggleOpen} {disabled}>
    <PlusIcon class_="w-4 h-4" />
    {m.add_to_calendar_dropdown_button_label()}
  </button>

  <!-- Mobile Modal -->
  {#if isOpen}
    <div
      class="fixed inset-0 z-50 flex items-end bg-black/50"
      onclick={handleBackdropClick}
      onkeydown={(e) => e.key === 'Escape' && close()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="w-full rounded-t-2xl bg-base-100 p-6 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-base-content">
            {m.add_to_calendar_dropdown_button_label()}
          </h3>
          <button class="btn btn-circle btn-ghost btn-sm" onclick={close}>✕</button>
        </div>

        {#if activeUser}
          <PersonalCalendarShare {event} {activeUser} compact={false} />

          <div class="divider my-3"></div>

          <CommunityShare event={event.originalEvent} {activeUser} compact={false} />
        {:else}
          <div class="py-8 text-center text-base-content/60">
            {m.add_to_calendar_dropdown_signin_required()}
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/if}
