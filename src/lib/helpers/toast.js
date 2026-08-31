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
  // Targeting (journey-test regression 2026-08-14 — "silent" error toasts):
  // - An OPEN native <dialog> renders in the browser's top layer, which sits
  //   above ALL z-indexed body content — a body-appended toast is invisible
  //   behind it, so the toast must live inside the dialog itself.
  // - CSS modals (.modal-open divs) are ordinary stacking contexts our
  //   z-[9999] beats, and appending INSIDE them puts the toast at the mercy
  //   of the modal's transform/overflow (which clipped it entirely) — so
  //   those get the plain body toast.
  const openDialogs = document.querySelectorAll('dialog[open]');
  const targetElement = openDialogs[openDialogs.length - 1] || document.body;

  // Reuse only a container that is a DIRECT child of the target — a subtree
  // querySelector can find a stale container hidden inside a closed modal
  // and silently swallow every toast appended there.
  let toastContainer = /** @type {HTMLElement | undefined} */ (
    [...targetElement.children].find((el) => el.classList.contains('toast-container'))
  );

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
