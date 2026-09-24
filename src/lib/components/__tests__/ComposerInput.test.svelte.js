// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * ComposerInput — Slack-style composer input (laoc, 2026-09-18): typing `:xx`
 * opens a suggestion list of the user's custom emojis and unicode emojis;
 * Tab/arrows cycle, Enter inserts; a custom emoji is rendered INLINE as its
 * image (the field is a contenteditable) and serialises back to
 * `:shortcode:` for the send path. Enter alone submits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { nip19 } from 'nostr-tools';
import ComposerInputHost from './fixtures/ComposerInputHost.svelte';
import { profiles } from './fixtures/profile-map-mock.svelte.js';
import { mentions } from './fixtures/mention-candidates-mock.svelte.js';

vi.mock('$lib/stores/profile-map.svelte.js', () => import('./fixtures/profile-map-mock.svelte.js'));
vi.mock(
  '$lib/stores/mention-candidates.svelte.js',
  () => import('./fixtures/mention-candidates-mock.svelte.js')
);

const ALICE = 'a'.repeat(64);
const NPUB_ALICE = nip19.npubEncode(ALICE);

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

  it('with submitOnEnter=false Enter inserts a newline instead of submitting', async () => {
    const onSubmit = vi.fn();
    const { editor } = setup({ multiline: true, submitOnEnter: false, onSubmit });
    await typeText(editor, 'line');
    await fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
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

describe('ComposerInput mention chips', () => {
  beforeEach(() => {
    profiles.map = new Map();
    profiles.requested = [];
  });

  it('renders a nostr:npub token as a chip and keeps the raw value', () => {
    profiles.map = new Map([[ALICE, { name: 'alice', display_name: 'Alice' }]]);
    const { editor, value } = setup({ initial: `hi nostr:${NPUB_ALICE} there` });
    const chip = editor.querySelector('span[data-mention]');
    expect(chip?.getAttribute('data-mention')).toBe(ALICE);
    expect(chip?.getAttribute('contenteditable')).toBe('false');
    expect(chip?.textContent).toBe('@Alice');
    expect(editor.textContent).not.toContain('npub1');
    expect(value()).toBe(`hi nostr:${NPUB_ALICE} there`);
    expect(profiles.requested).toEqual([ALICE]);
  });

  it('shows a short hex label until the profile arrives, then patches the chip in place', async () => {
    const { editor } = setup({ initial: `nostr:${NPUB_ALICE}` });
    const chip = editor.querySelector('span[data-mention]');
    expect(chip?.textContent).toBe('@aaaaaaaa');
    profiles.map = new Map([[ALICE, { name: 'alice' }]]);
    profiles.bump();
    await tick();
    expect(editor.querySelector('span[data-mention]')).toBe(chip); // same node
    expect(chip?.textContent).toBe('@alice');
  });

  it('keeps an invalid npub as plain text', () => {
    const { editor, value } = setup({ initial: 'see nostr:npub1notvalid ok' });
    expect(editor.querySelector('span[data-mention]')).toBeNull();
    expect(editor.textContent).toContain('nostr:npub1notvalid');
    expect(value()).toBe('see nostr:npub1notvalid ok');
  });

  it('serialises chips back into the value after the user types around them', async () => {
    const { editor, value } = setup({ initial: `nostr:${NPUB_ALICE} ` });
    editor.appendChild(document.createTextNode('hello'));
    await fireEvent.input(editor);
    expect(value()).toBe(`nostr:${NPUB_ALICE} hello`);
  });

  it('chip removal round-trips: deleting the chip node drops the whole token', async () => {
    const { editor, value } = setup({ initial: `a nostr:${NPUB_ALICE} b` });
    editor.querySelector('span[data-mention]')?.remove();
    await fireEvent.input(editor);
    expect(value()).toBe('a  b');
  });

  it('renders chips and custom emojis in the same line', () => {
    const { editor } = setup({ initial: `:doge: nostr:${NPUB_ALICE}` });
    expect(editor.querySelector('img[data-shortcode="doge"]')).toBeTruthy();
    expect(editor.querySelector('span[data-mention]')).toBeTruthy();
  });
});

describe('ComposerInput @ people picker', () => {
  beforeEach(() => {
    profiles.map = new Map();
    mentions.candidates = [];
    mentions.lastQuery = null;
  });

  it('opens the people list on @, filters by the typed query, inserts nostr:npub + space on Enter, chip shows the picked name', async () => {
    mentions.candidates = [
      {
        pubkey: ALICE,
        name: 'Alice',
        profile: { name: 'alice', display_name: 'Alice', picture: null }
      },
      {
        pubkey: 'b'.repeat(64),
        name: 'Bob',
        profile: { name: 'bob', display_name: null, picture: null }
      }
    ];
    const { editor, value, findByTestId, getAllByRole, queryByTestId } = setup();
    await typeText(editor, 'hey @');
    expect(await findByTestId('mention-suggestions')).toBeTruthy();
    expect(getAllByRole('option')).toHaveLength(2);
    expect(mentions.lastQuery).toBe('');

    await typeText(editor, 'hey @al');
    expect(getAllByRole('option')).toHaveLength(1);
    expect(getAllByRole('option')[0].textContent).toContain('Alice');

    await fireEvent.keyDown(editor, { key: 'Enter' });
    await tick();
    expect(value()).toBe(`hey nostr:${NPUB_ALICE} `);
    expect(editor.querySelector('span[data-mention]')?.textContent).toBe('@Alice');
    expect(queryByTestId('mention-suggestions')).toBeNull();
  });

  it('cycles people with arrows (Tab cycles too) and Enter picks the highlighted one', async () => {
    mentions.candidates = [
      { pubkey: ALICE, name: 'Alice', profile: null },
      { pubkey: 'b'.repeat(64), name: 'Bob', profile: null }
    ];
    const { editor, value, findByTestId, getAllByRole } = setup();
    await typeText(editor, '@');
    await findByTestId('mention-suggestions');
    await fireEvent.keyDown(editor, { key: 'ArrowDown' });
    await fireEvent.keyUp(editor, { key: 'ArrowDown' });
    expect(getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    await fireEvent.keyDown(editor, { key: 'Tab' });
    await fireEvent.keyUp(editor, { key: 'Tab' });
    expect(getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true'); // wrapped
    await fireEvent.keyDown(editor, { key: 'ArrowDown' });
    await fireEvent.keyUp(editor, { key: 'ArrowDown' });
    await fireEvent.keyDown(editor, { key: 'Enter' });
    await tick();
    expect(value()).toBe(`nostr:${nip19.npubEncode('b'.repeat(64))} `);
  });

  it('only one list opens: ":" after an "@" shows emojis, "@" after a ":" shows people', async () => {
    mentions.candidates = [{ pubkey: ALICE, name: 'Alice', profile: null }];
    const { editor, findByTestId, queryByTestId } = setup();
    await typeText(editor, '@al :dog');
    await findByTestId('emoji-suggestions');
    expect(queryByTestId('mention-suggestions')).toBeNull();
    await typeText(editor, ':dog @al');
    await findByTestId('mention-suggestions');
    expect(queryByTestId('emoji-suggestions')).toBeNull();
  });

  it('does not open for an email-like @ mid-word, and Escape closes the people list', async () => {
    mentions.candidates = [{ pubkey: ALICE, name: 'Alice', profile: null }];
    const { editor, queryByTestId, findByTestId, value } = setup();
    await typeText(editor, 'mail a@b');
    expect(queryByTestId('mention-suggestions')).toBeNull();
    await typeText(editor, 'mail @');
    await findByTestId('mention-suggestions');
    await fireEvent.keyDown(editor, { key: 'Escape' });
    expect(queryByTestId('mention-suggestions')).toBeNull();
    expect(value()).toBe('mail @');
  });
});

describe('ComposerInput selection API', () => {
  it('reports the selection in value coordinates, counting chips by their token length', async () => {
    const { editor, getByTestId } = setup({ initial: `nostr:${NPUB_ALICE} hello` });
    const textNode = editor.lastChild; // " hello"
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 6);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    await fireEvent.click(getByTestId('read-selection'));
    const token = `nostr:${NPUB_ALICE}`.length;
    expect(JSON.parse(getByTestId('selection').textContent)).toEqual({
      start: token + 1,
      end: token + 6
    });
  });

  it('replaceRange wraps the selected text and re-renders', async () => {
    const { editor, value, getByTestId } = setup({ initial: 'make me bold' });
    const range = document.createRange();
    range.setStart(editor.firstChild, 8);
    range.setEnd(editor.firstChild, 12);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    await fireEvent.click(getByTestId('wrap-bold'));
    await tick();
    expect(value()).toBe('make me **bold**');
  });

  it('applies minHeight and drops the multiline max-height cap', () => {
    const { editor } = setup({ multiline: true, minHeight: '20rem' });
    expect(editor.style.minHeight).toBe('20rem');
    expect(editor.className).not.toContain('max-h-40');
  });
});
