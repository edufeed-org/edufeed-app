// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * ComposerInput — Slack-style composer input (laoc, 2026-09-18): typing `:xx`
 * opens a suggestion list of the user's custom emojis and unicode emojis;
 * Tab/arrows cycle, Enter inserts; a custom emoji is rendered INLINE as its
 * image (the field is a contenteditable) and serialises back to
 * `:shortcode:` for the send path. Enter alone submits.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import ComposerInputHost from './fixtures/ComposerInputHost.svelte';

const SETS = [
  {
    packName: 'Doge',
    emojis: [
      { shortcode: 'doge', url: 'https://x/doge.png' },
      { shortcode: 'dogedance_sm', url: 'https://x/dogedance.gif' }
    ]
  }
];

/** Put text into the editor the way a keyboard would end up: DOM + caret at the end + input event. */
async function typeText(editor, text) {
  editor.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  await fireEvent.input(editor);
  await tick();
}

function setup(props = {}) {
  const utils = render(ComposerInputHost, { props: { customEmojiSets: SETS, ...props } });
  const editor = utils.getByTestId('emoji-input');
  const value = () => utils.getByTestId('value').textContent;
  return { ...utils, editor, value };
}

describe('ComposerInput', () => {
  it('renders a known custom shortcode as an inline image and keeps unknown ones as text', () => {
    const { editor } = setup({ initial: 'hi :doge: and :nope:' });
    const img = editor.querySelector('img[data-shortcode="doge"]');
    expect(img?.getAttribute('src')).toBe('https://x/doge.png');
    expect(editor.textContent).toContain(':nope:');
    expect(editor.textContent).not.toContain(':doge:');
  });

  it('serialises typed text back into the bound value', async () => {
    const { editor, value } = setup();
    await typeText(editor, 'hallo welt');
    expect(value()).toBe('hallo welt');
  });

  it('opens suggestions for :xx, custom packs first, and inserts the highlighted one on Enter', async () => {
    const { editor, value, findByRole, getAllByRole, queryByRole } = setup();
    await typeText(editor, 'nun :dog');
    const list = await findByRole('listbox');
    expect(list).toBeTruthy();
    const options = getAllByRole('option');
    expect(options[0].textContent).toContain('doge');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].textContent).toContain('dogedance_sm');

    await fireEvent.keyDown(editor, { key: 'Enter' });
    await tick();
    expect(value()).toBe('nun :doge: ');
    expect(editor.querySelector('img[data-shortcode="doge"]')).toBeTruthy();
    expect(queryByRole('listbox')).toBeNull();
  });

  it('cycles the highlight with Tab / arrows and inserts a later candidate', async () => {
    const { editor, value, findByRole, getAllByRole } = setup();
    await typeText(editor, ':dog');
    await findByRole('listbox');
    // a real key press is keydown AND keyup; the keyup must not reset the
    // highlight (laoc, 2026-09-18: "arrow keys always jump back")
    await fireEvent.keyDown(editor, { key: 'Tab' });
    await fireEvent.keyUp(editor, { key: 'Tab' });
    expect(getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    await fireEvent.keyDown(editor, { key: 'ArrowUp' });
    await fireEvent.keyUp(editor, { key: 'ArrowUp' });
    expect(getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    await fireEvent.keyDown(editor, { key: 'ArrowDown' });
    await fireEvent.keyUp(editor, { key: 'ArrowDown' });
    expect(getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    await fireEvent.keyDown(editor, { key: 'Enter' });
    await tick();
    expect(value()).toBe(':dogedance_sm: ');
  });

  it('keeps the highlight while the query is unchanged, resets it when the query changes', async () => {
    const { editor, findByRole, getAllByRole } = setup();
    await typeText(editor, ':dog');
    await findByRole('listbox');
    await fireEvent.keyDown(editor, { key: 'ArrowDown' });
    await fireEvent.keyUp(editor, { key: 'ArrowDown' });
    // caret-only events (click, keyup of a letter that did not change the query) keep it
    await fireEvent.click(editor);
    expect(getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    // typing more narrows the list: highlight goes back to the top
    await typeText(editor, ':doged');
    expect(getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('inserts a unicode suggestion as the character itself', async () => {
    const { editor, value, findByRole } = setup();
    await typeText(editor, ':grin');
    await findByRole('listbox');
    await fireEvent.keyDown(editor, { key: 'Enter' });
    await tick();
    expect(value()).toBe('😀 ');
  });

  it('closes the suggestions on Escape without changing the text', async () => {
    const { editor, value, findByRole, queryByRole } = setup();
    await typeText(editor, ':dog');
    await findByRole('listbox');
    await fireEvent.keyDown(editor, { key: 'Escape' });
    expect(queryByRole('listbox')).toBeNull();
    expect(value()).toBe(':dog');
  });

  it('submits on Enter when no suggestion is open, but not on Shift+Enter in multiline mode', async () => {
    const onSubmit = vi.fn();
    const { editor } = setup({ multiline: true, onSubmit });
    await typeText(editor, 'fertig');
    await fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    await fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('accepts picker inserts (custom and unicode) through insert()', async () => {
    const { editor, value, getByTestId } = setup({ initial: 'hey' });
    await fireEvent.click(getByTestId('insert-custom'));
    await tick();
    expect(value()).toBe('hey :cat_wow: ');
    await fireEvent.click(getByTestId('insert-unicode'));
    await tick();
    expect(value()).toBe('hey :cat_wow: 😀 ');
    expect(editor.querySelector('img[data-shortcode="cat_wow"]')).toBeTruthy();
  });

  it('empties the editor when the parent clears the value (after send)', async () => {
    const { editor, getByTestId } = setup({ initial: 'tschüss :doge:' });
    await fireEvent.click(getByTestId('clear'));
    await tick();
    await waitFor(() => expect(editor.textContent).toBe(''));
    expect(editor.querySelector('img')).toBeNull();
  });
});
