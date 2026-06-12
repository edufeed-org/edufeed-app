<script>
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import LoginModal from './LoginModal.svelte';
  import LoginWithPrivateKey from './LoginWithPrivateKey.svelte';
  import LoginWithBunker from './LoginWithBunker.svelte';
  import SignupModal from './SignupModal.svelte';
  import CalendarEventDetailsModal from './calendar/CalendarEventDetailsModal.svelte';
  import CalendarCreationModal from './calendar/CalendarCreationModal.svelte';
  import CalendarEventModal from './calendar/CalendarEventModal.svelte';
  import CreateCommunityModal from './CreateCommunityModal.svelte';
  import EditCommunityModal from './EditCommunityModal.svelte';
  import WebcalQRCodeModal from './calendar/WebcalQRCodeModal.svelte';
  import EditProfileModal from './EditProfileModal.svelte';
  import CommunityMigrationModal from './CommunityMigrationModal.svelte';
  import AddBookmarkModal from './bookmarks/AddBookmarkModal.svelte';
  import ShareByNaddrModal from './shared/ShareByNaddrModal.svelte';
  import ReportMetadataModal from './shared/ReportMetadataModal.svelte';
  import CreateRoomModal from './meet/CreateRoomModal.svelte';
  import PollCreateModal from './polls/PollCreateModal.svelte';
  import RecoveryDownloadModal from './RecoveryDownloadModal.svelte';

  /**
   * ModalManager - Centralized modal rendering component
   *
   * This component acts as the single source of truth for modal rendering in the application.
   * It uses the centralized modal store to determine which modal to display and handles
   * all modal transitions and interactions.
   *
   * Key Features:
   * - Centralized modal state management
   * - Clean separation of modal logic from UI components
   * - Type-safe modal transitions
   * - Extensible for adding new modal types
   */

  // Use the modal store
  const modal = modalStore;

  // Generate unique modal IDs for each modal instance
  const loginModalId = 'global-login-modal';
  const privateKeyModalId = 'global-private-key-modal';
  const bunkerModalId = 'global-bunker-modal';
  const signupModalId = 'global-signup-modal';
  const createCommunityModalId = 'create-community-modal';
  const editCommunityModalId = 'edit-community-modal';
  const editProfileModalId = 'edit-profile-modal';
  const communityMigrationModalId = 'community-migration-modal';
  const addBookmarkModalId = 'add-bookmark-modal';
  const shareByNaddrModalId = 'share-by-naddr-modal';
  const reportMetadataModalId = 'report-metadata-modal';
  const createRoomModalId = 'create-room-modal';
  const recoveryDownloadModalId = 'recovery-download-modal';

  /**
   * Reactive effect to handle modal opening/closing based on store state
   * Automatically opens/closes the HTML dialog elements when modal state changes
   */
  $effect(() => {
    const currentModal = modal.activeModal;

    // Close any currently open modals first
    if (currentModal === 'none') {
      const loginModal = /** @type {HTMLDialogElement} */ (document.getElementById(loginModalId));
      const privateKeyModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(privateKeyModalId)
      );
      const signupModal = /** @type {HTMLDialogElement} */ (document.getElementById(signupModalId));
      const createCommunityModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(createCommunityModalId)
      );
      const editCommunityModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(editCommunityModalId)
      );
      const editProfileModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(editProfileModalId)
      );

      if (loginModal && loginModal.open) {
        loginModal.close();
      }
      if (privateKeyModal && privateKeyModal.open) {
        privateKeyModal.close();
      }
      const bunkerModal = /** @type {HTMLDialogElement} */ (document.getElementById(bunkerModalId));
      if (bunkerModal && bunkerModal.open) {
        bunkerModal.close();
      }
      if (signupModal && signupModal.open) {
        signupModal.close();
      }
      if (createCommunityModal && createCommunityModal.open) {
        createCommunityModal.close();
      }
      if (editCommunityModal && editCommunityModal.open) {
        editCommunityModal.close();
      }
      if (editProfileModal && editProfileModal.open) {
        editProfileModal.close();
      }
      const communityMigrationModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(communityMigrationModalId)
      );
      if (communityMigrationModal && communityMigrationModal.open) {
        communityMigrationModal.close();
      }
      const addBookmarkModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(addBookmarkModalId)
      );
      if (addBookmarkModal && addBookmarkModal.open) {
        addBookmarkModal.close();
      }
      const shareByNaddrModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(shareByNaddrModalId)
      );
      if (shareByNaddrModal && shareByNaddrModal.open) {
        shareByNaddrModal.close();
      }
      const reportMetadataModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(reportMetadataModalId)
      );
      if (reportMetadataModal && reportMetadataModal.open) {
        reportMetadataModal.close();
      }
      const createRoomModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(createRoomModalId)
      );
      if (createRoomModal && createRoomModal.open) {
        createRoomModal.close();
      }
      const recoveryDownloadModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(recoveryDownloadModalId)
      );
      if (recoveryDownloadModal && recoveryDownloadModal.open) {
        recoveryDownloadModal.close();
      }
    } else if (currentModal === 'login') {
      // Open login modal
      const loginModal = /** @type {HTMLDialogElement} */ (document.getElementById(loginModalId));
      if (loginModal && !loginModal.open) {
        loginModal.showModal();
      }
    } else if (currentModal === 'privateKey') {
      // Open private key modal
      const privateKeyModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(privateKeyModalId)
      );
      if (privateKeyModal && !privateKeyModal.open) {
        privateKeyModal.showModal();
      }
    } else if (currentModal === 'bunker') {
      const bunkerModal = /** @type {HTMLDialogElement} */ (document.getElementById(bunkerModalId));
      if (bunkerModal && !bunkerModal.open) {
        bunkerModal.showModal();
      }
    } else if (currentModal === 'signup') {
      // Open signup modal
      const signupModal = /** @type {HTMLDialogElement} */ (document.getElementById(signupModalId));
      if (signupModal && !signupModal.open) {
        signupModal.showModal();
      }
    } else if (currentModal === 'createCommunity') {
      // Open create community modal
      const createCommunityModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(createCommunityModalId)
      );
      if (createCommunityModal && !createCommunityModal.open) {
        createCommunityModal.showModal();
      }
    } else if (currentModal === 'profile') {
      // Open edit profile modal
      const editProfileModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(editProfileModalId)
      );
      if (editProfileModal && !editProfileModal.open) {
        editProfileModal.showModal();
      }
    } else if (currentModal === 'editCommunity') {
      // Open edit community modal
      const editCommunityModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(editCommunityModalId)
      );
      if (editCommunityModal && !editCommunityModal.open) {
        editCommunityModal.showModal();
      }
    } else if (currentModal === 'communityMigration') {
      // Open community migration modal
      const communityMigrationModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(communityMigrationModalId)
      );
      if (communityMigrationModal && !communityMigrationModal.open) {
        communityMigrationModal.showModal();
      }
    } else if (currentModal === 'addBookmark') {
      const addBookmarkModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(addBookmarkModalId)
      );
      if (addBookmarkModal && !addBookmarkModal.open) {
        addBookmarkModal.showModal();
      }
    } else if (currentModal === 'shareByNaddr') {
      const shareByNaddrModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(shareByNaddrModalId)
      );
      if (shareByNaddrModal && !shareByNaddrModal.open) {
        shareByNaddrModal.showModal();
      }
    } else if (currentModal === 'reportMetadata') {
      const reportMetadataModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(reportMetadataModalId)
      );
      if (reportMetadataModal && !reportMetadataModal.open) {
        reportMetadataModal.showModal();
      }
    } else if (currentModal === 'createRoom') {
      const createRoomModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(createRoomModalId)
      );
      if (createRoomModal && !createRoomModal.open) {
        createRoomModal.showModal();
      }
    } else if (currentModal === 'recovery-download') {
      const recoveryDownloadModal = /** @type {HTMLDialogElement} */ (
        document.getElementById(recoveryDownloadModalId)
      );
      if (recoveryDownloadModal && !recoveryDownloadModal.open) {
        recoveryDownloadModal.showModal();
      }
    }
  });

  /**
   * Handle NSEC transition from LoginModal to LoginWithPrivateKey
   * This creates a seamless user experience when switching between login methods
   */
  function handleNSECTransition() {
    modal.transitionModal('login', 'privateKey');
  }

  /**
   * Handle successful account creation from LoginWithPrivateKey
   * Transitions back to login modal to show account options or close flow
   */
  function handleAccountCreated() {
    modal.transitionModal('privateKey', 'login');
  }

  function handleBunkerTransition() {
    modal.transitionModal('login', 'bunker');
  }

  function handleBunkerBack() {
    modal.transitionModal('bunker', 'login');
  }

  function handleBunkerAccountCreated() {
    modal.transitionModal('bunker', 'login');
  }

  let pollCommunityPubkey = $derived(
    /** @type {string} */ (/** @type {any} */ (modal.modalProps)?.communityPubkey) || ''
  );
</script>

<!-- Render modals based on active modal state -->
{#if modal.activeModal === 'login'}
  <LoginModal
    modalId={loginModalId}
    onNSECTransition={handleNSECTransition}
    onBunkerTransition={handleBunkerTransition}
  />
{:else if modal.activeModal === 'privateKey'}
  <LoginWithPrivateKey modalId={privateKeyModalId} onAccountCreated={handleAccountCreated} />
{:else if modal.activeModal === 'bunker'}
  <LoginWithBunker
    modalId={bunkerModalId}
    onAccountCreated={handleBunkerAccountCreated}
    onBack={handleBunkerBack}
  />
{:else if modal.activeModal === 'signup'}
  <SignupModal modalId={signupModalId} />
{:else if modal.activeModal === 'eventDetails'}
  <CalendarEventDetailsModal />
{:else if modal.activeModal === 'createCommunity'}
  <CreateCommunityModal modalId={createCommunityModalId} />
{:else if modal.activeModal === 'editCommunity'}
  <EditCommunityModal modalId={editCommunityModalId} />
{:else if modal.activeModal === 'webcalQRCode'}
  <WebcalQRCodeModal />
{:else if modal.activeModal === 'profile'}
  <EditProfileModal modalId={editProfileModalId} />
{:else if modal.activeModal === 'createCalendar'}
  <CalendarCreationModal />
{:else if modal.activeModal === 'calendarEvent'}
  <CalendarEventModal />
{:else if modal.activeModal === 'communityMigration'}
  <CommunityMigrationModal modalId={communityMigrationModalId} />
{:else if modal.activeModal === 'addBookmark'}
  <AddBookmarkModal modalId={addBookmarkModalId} />
{:else if modal.activeModal === 'shareByNaddr'}
  <ShareByNaddrModal modalId={shareByNaddrModalId} />
{:else if modal.activeModal === 'reportMetadata'}
  <ReportMetadataModal modalId={reportMetadataModalId} />
{:else if modal.activeModal === 'createRoom'}
  <CreateRoomModal modalId={createRoomModalId} />
{:else if modal.activeModal === 'createPoll'}
  <PollCreateModal communityPubkey={pollCommunityPubkey} />
{:else if modal.activeModal === 'recovery-download'}
  <RecoveryDownloadModal modalId={recoveryDownloadModalId} />
{/if}
