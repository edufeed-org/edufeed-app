/**
 * Typing into a contenteditable composer (ComposerInput). `fireEvent.input` with
 * `target.value` only works on <input>/<textarea>; a contenteditable needs its
 * text set, the caret placed, and then the input event.
 */
import { fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

/**
 * @param {Element} editor
 * @param {string} text
 */
export async function typeIntoEditor(editor, text) {
  editor.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  await fireEvent.input(editor);
  await tick();
}
