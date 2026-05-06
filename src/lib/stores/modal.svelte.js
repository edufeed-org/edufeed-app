/**
 * @typedef {'none' | 'login' | 'privateKey' | 'bunker' | 'settings' | 'profile' | 'eventDetails' | 'createCalendar' | 'calendarEvent' | 'signup' | 'createCommunity' | 'editCommunity' | 'webcalQRCode' | 'communityMigration' | 'addBookmark' | 'shareByNaddr' | 'createRoom' | 'joinRoom' | 'recovery-download'} ModalType
 */

/**
 * @typedef {Object} ModalState
 * @property {ModalType} activeModal - Currently active modal
 * @property {Object} modalProps - Props to pass to the active modal
 * @property {Object} modalCallbacks - Callbacks for modal interactions
 */

/**
 * @typedef {Object} ModalStore
 * @property {ModalType} activeModal - Get the currently active modal
 * @property {Object} modalProps - Get props for the active modal
 * @property {Object} modalCallbacks - Get callbacks for the active modal
 * @property {(type: ModalType, props?: Object, callbacks?: Object) => void} openModal - Open a modal
 * @property {() => void} closeModal - Close the active modal
 * @property {(fromType: ModalType, toType: ModalType, newProps?: Object) => void} transitionModal - Transition between modals
 * @property {(type: ModalType) => boolean} isModalActive - Check if a modal is active
 */

/**
 * Centralized modal management store using Svelte 5 runes
 * Provides a clean API for opening, closing, and transitioning between modals
 * @returns {ModalStore} Modal management functions and reactive state
 */
export function useModal() {
  let activeModal = $state(/** @type {ModalType} */ ('none'));
  let modalProps = $state({});
  let modalCallbacks = $state({});

  /**
   * Open a modal with optional props and callbacks
   * @param {ModalType} type - The type of modal to open
   * @param {Object} [props={}] - Props to pass to the modal component
   * @param {Object} [callbacks={}] - Callback functions for modal interactions
   */
  function openModal(type, props = {}, callbacks = {}) {
    activeModal = type;
    modalProps = props;
    modalCallbacks = callbacks;
  }

  /**
   * Close the currently active modal
   * Ensures proper cleanup of both store state and DOM elements
   */
  function closeModal() {
    console.log('modalStore: Closing modal, current state:', activeModal);
    activeModal = 'none';
    modalProps = {};
    modalCallbacks = {};
  }

  /**
   * Transition from one modal to another, preserving context
   * @param {ModalType} fromType - The modal type to transition from
   * @param {ModalType} toType - The modal type to transition to
   * @param {Object} [newProps={}] - New props for the target modal
   */
  function transitionModal(fromType, toType, newProps = {}) {
    if (activeModal === fromType) {
      activeModal = toType;
      modalProps = { ...modalProps, ...newProps };
    }
  }

  /**
   * Check if a specific modal is currently active
   * @param {ModalType} type - The modal type to check
   * @returns {boolean} True if the modal is active
   */
  function isModalActive(type) {
    return activeModal === type;
  }

  return {
    // Reactive state getters
    get activeModal() {
      return activeModal;
    },
    get modalProps() {
      return modalProps;
    },
    get modalCallbacks() {
      return modalCallbacks;
    },

    // Actions
    openModal,
    closeModal,
    transitionModal,
    isModalActive
  };
}

// Export a singleton instance for global use
export const modalStore = useModal();
