<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { resourceCreatePath } from '$lib/helpers/contentCreation.js';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';

  /**
   * ModalManager - Centralized modal rendering component
   *
   * Single source of truth for global modal rendering: reads the modal store
   * and mounts whichever modal is active.
   *
   * Every modal is loaded lazily via `import()` at open time. ModalManager
   * sits in the root layout, so a static import here would put the modal's
   * whole dependency graph (login flows, calendar forms, polls, meet,
   * membership, …) into every page's preload list — that was most of the
   * ~290 chunks the landing page shipped before hydration.
   */

  /** @typedef {import('$lib/stores/modal.svelte.js').ModalType} ModalType */

  const modal = modalStore;

  // Unique <dialog> ids for modals that open via showModal(); CSS-only modals
  // (no entry here) need no id/effect plumbing.
  /** @type {Partial<Record<ModalType, string>>} */
  const DIALOG_IDS = {
    login: 'global-login-modal',
    privateKey: 'global-private-key-modal',
    bunker: 'global-bunker-modal',
    npubLogin: 'global-npub-login-modal',
    googleLogin: 'global-google-login-modal',
    signup: 'global-signup-modal',
    createCommunity: 'create-community-modal',
    profile: 'edit-profile-modal',
    communityMigration: 'community-migration-modal',
    addBookmark: 'add-bookmark-modal',
    shareByNaddr: 'share-by-naddr-modal',
    reportMetadata: 'report-metadata-modal',
    createRoom: 'create-room-modal',
    'recovery-download': 'recovery-download-modal',
    deleteCommunity: 'delete-community-modal'
  };

  // Lazy loaders, keyed by modal type. Reading `.Component` triggers the import.
  /** @type {Partial<Record<ModalType, { readonly Component: any }>>} */
  const MODALS = {
    login: lazyComponent(() => import('./LoginModal.svelte')),
    privateKey: lazyComponent(() => import('./LoginWithPrivateKey.svelte')),
    bunker: lazyComponent(() => import('./LoginWithBunker.svelte')),
    npubLogin: lazyComponent(() => import('./LoginWithNpub.svelte')),
    googleLogin: lazyComponent(() => import('./LoginWithGoogle.svelte')),
    signup: lazyComponent(() => import('./SignupModal.svelte')),
    eventDetails: lazyComponent(() => import('./calendar/CalendarEventDetailsModal.svelte')),
    createCommunity: lazyComponent(() => import('./CreateCommunityModal.svelte')),
    webcalQRCode: lazyComponent(() => import('./calendar/WebcalQRCodeModal.svelte')),
    profile: lazyComponent(() => import('./EditProfileModal.svelte')),
    createCalendar: lazyComponent(() => import('./calendar/CalendarCreationModal.svelte')),
    calendarEvent: lazyComponent(() => import('./calendar/CalendarEventModal.svelte')),
    communityMigration: lazyComponent(() => import('./CommunityMigrationModal.svelte')),
    addBookmark: lazyComponent(() => import('./bookmarks/AddBookmarkModal.svelte')),
    shareByNaddr: lazyComponent(() => import('./shared/ShareByNaddrModal.svelte')),
    inviteToEvent: lazyComponent(() => import('./calendar/InviteToEventModal.svelte')),
    reportMetadata: lazyComponent(() => import('./shared/ReportMetadataModal.svelte')),
    createRoom: lazyComponent(() => import('./meet/CreateRoomModal.svelte')),
    createPoll: lazyComponent(() => import('./polls/PollCreateModal.svelte')),
    createNote: lazyComponent(() => import('./notes/NoteCreateModal.svelte')),
    'recovery-download': lazyComponent(() => import('./RecoveryDownloadModal.svelte')),
    deleteCommunity: lazyComponent(() => import('./community/DeleteCommunityModal.svelte')),
    membershipApply: lazyComponent(() => import('./membership/MembershipApplyModal.svelte')),
    resourceVariantPicker: lazyComponent(
      () => import('./educational/ResourceVariantPickerModal.svelte')
    ),
    concordInvites: lazyComponent(() => import('./community/channels/InviteInboxModal.svelte'))
  };

  /** @type {any} */
  const props = $derived(modal.modalProps);
  const communityPubkey = $derived(/** @type {string} */ (props?.communityPubkey) || '');

  /**
   * Handle a finished login flow (private key / bunker / npub).
   *
   * These fire once the sub-modal has closed its own <dialog>, so the login
   * flow is over and the whole stack must go away. Transitioning back to
   * 'login' here (the previous behaviour) re-opened the login modal on top of
   * the freshly authenticated app — the user appeared to be logged in but was
   * still staring at the login dialog.
   */
  function handleAccountCreated() {
    modal.closeModal();
  }

  /** @param {string} variantId */
  function handleResourceVariantSelect(variantId) {
    const target = communityPubkey;
    modal.closeModal();
    goto(/** @type {any} */ (resolve)(resourceCreatePath(variantId, target)));
  }

  /**
   * Per-modal props. Modals not listed here take no props.
   * @param {ModalType} type
   * @returns {Record<string, any>}
   */
  function propsFor(type) {
    const modalId = DIALOG_IDS[type];
    switch (type) {
      case 'login':
        return {
          modalId,
          // Seamless hand-off between login methods.
          onNSECTransition: () => modal.transitionModal('login', 'privateKey'),
          onBunkerTransition: () => modal.transitionModal('login', 'bunker'),
          onNpubTransition: () => modal.transitionModal('login', 'npubLogin'),
          onGoogleTransition: () => modal.transitionModal('login', 'googleLogin')
        };
      case 'privateKey':
      case 'npubLogin':
        return { modalId, onAccountCreated: handleAccountCreated };
      case 'bunker':
        return {
          modalId,
          onAccountCreated: handleAccountCreated,
          onBack: () => modal.transitionModal('bunker', 'login')
        };
      case 'signup':
        return { modalId, externalSignup: !!props?.externalSignup };
      case 'createPoll':
      case 'createNote':
        return { communityPubkey };
      case 'resourceVariantPicker':
        return {
          open: true,
          onSelect: handleResourceVariantSelect,
          onClose: () => modal.closeModal()
        };
      case 'concordInvites':
        return { onClose: () => modal.closeModal() };
      default:
        return modalId ? { modalId } : {};
    }
  }

  const activeType = $derived(modal.activeModal);
  // Reading `.Component` here is what kicks off the chunk load.
  const ActiveModal = $derived(MODALS[activeType]?.Component ?? null);

  // Open the <dialog> once the lazily loaded modal is in the DOM. `$effect`
  // runs after the template has rendered `ActiveModal`, so the element exists.
  // Closing needs no counterpart: the store flipping to 'none' unmounts the
  // modal, which removes its <dialog> from the top layer.
  $effect(() => {
    const id = DIALOG_IDS[activeType];
    if (!id || !ActiveModal) return;
    const dialog = /** @type {HTMLDialogElement | null} */ (document.getElementById(id));
    if (dialog && !dialog.open) dialog.showModal();
  });
</script>

{#if ActiveModal}
  {#key activeType}
    <ActiveModal {...propsFor(activeType)} />
  {/key}
{/if}
