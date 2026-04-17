/**
 * Toast notification utility for DaisyUI 5
 * Shows temporary notifications that auto-dismiss after a specified duration
 */

/**
 * Show a toast notification.
 * Pass `duration: 0` for a persistent toast — the returned `dismiss` function
 * must be called manually to remove it.
 * @param {string} message - The message to display (can be a translation key or plain text)
 * @param {string} type - Toast type: 'success', 'error', 'info', 'warning'
 * @param {number} duration - Duration in ms (default: 3000). 0 = persistent (call dismiss()).
 * @returns {() => void} dismiss — removes the toast immediately
 */
export function showToast(message, type = 'info', duration = 3000) {
  // Determine where to append the toast container
  // If a modal is open, append to the modal to ensure proper stacking
  const openModal = document.querySelector('.modal-open');
  const targetElement = openModal || document.body;

  // Create toast container if it doesn't exist, or get existing one
  let toastContainer = targetElement.querySelector('.toast-container');

  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className =
      'toast-container toast toast-top toast-end fixed top-4 right-4 z-[9999]';
    targetElement.appendChild(toastContainer);
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `alert ${getAlertClass(type)} mb-2 shadow-lg min-w-80 max-w-md`;

  // Create toast content
  const content = document.createElement('span');
  content.className = 'text-sm';
  content.textContent = message;
  toast.appendChild(content);

  // Add to container
  toastContainer.appendChild(toast);

  /** Remove this toast with a slide-out animation. */
  function dismiss() {
    if (!toast.parentNode) return; // already removed
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease-in-out';

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }

      // Clean up empty toast container
      if (toastContainer && toastContainer.children.length === 0) {
        toastContainer.remove();
      }
    }, 300);
  }

  // Auto-remove after duration (skip if 0 = persistent)
  if (duration > 0) {
    setTimeout(dismiss, duration);
  }

  return dismiss;
}

/**
 * Get DaisyUI alert class based on toast type
 * @param {string} type - Toast type
 * @returns {string} DaisyUI alert class
 */
function getAlertClass(type) {
  switch (type) {
    case 'success':
      return 'alert-success';
    case 'error':
      return 'alert-error';
    case 'warning':
      return 'alert-warning';
    case 'info':
    default:
      return 'alert-info';
  }
}
