/**
 * Chat composer keyboard behavior: Enter submits, Shift+Enter uses the
 * textarea's native newline, Alt+Enter inserts a newline manually (browsers
 * do nothing with it natively). IME composition is left alone.
 */

/**
 * @param {KeyboardEvent} event - keydown on a textarea
 * @param {() => void} submit
 */
export function composerKeydown(event, submit) {
  if (event.key !== 'Enter' || event.isComposing) return;
  if (event.shiftKey) return; // native newline
  event.preventDefault();
  if (event.altKey) {
    insertNewlineAtCursor(/** @type {HTMLTextAreaElement} */ (event.target));
    return;
  }
  submit();
}

/** @param {HTMLTextAreaElement} textarea */
function insertNewlineAtCursor(textarea) {
  const { selectionStart, selectionEnd, value } = textarea;
  textarea.value = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
  textarea.selectionStart = textarea.selectionEnd = selectionStart + 1;
  // Keep Svelte's bind:value in sync with the manual mutation.
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
