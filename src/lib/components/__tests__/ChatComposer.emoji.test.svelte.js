// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * ChatComposer is the shared group-chat input (timeline + thread panel). It
 * was a plain <input>, so the ':' autocomplete and inline custom emojis were
 * missing from community group chats (laoc, 2026-09-18).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { typeIntoEditor } from './fixtures/editor.js';

vi.mock('$lib/paraglide/messages', () => ({
  emoji_suggestions_label: () => 'Emoji suggestions',
  chat_attach_file: () => 'Attach file',
  groups_poll_create: () => 'Poll'
}));

import ChatComposer from '$lib/components/chat/ChatComposer.svelte';

const SETS = [{ packName: 'Doge', emojis: [{ shortcode: 'doge', url: 'https://x/doge.png' }] }];

describe('ChatComposer emoji input', () => {
  it('suggests custom emojis on ":" and renders the pick inline', async () => {
    const { getByTestId, findByRole } = render(ChatComposer, {
      props: {
        value: '',
        placeholder: 'Message',
        onSubmit: () => {},
        customEmojiSets: SETS,
        testid: 'group-chat-input'
      }
    });
    const editor = getByTestId('group-chat-input');
    await typeIntoEditor(editor, 'hi :dog');
    await findByRole('listbox');
    await fireEvent.keyDown(editor, { key: 'Enter' });
    await tick();
    expect(editor.querySelector('img[data-shortcode="doge"]')).toBeTruthy();
  });

  it('submits on Enter when no suggestion is open', async () => {
    const onSubmit = vi.fn();
    const { getByTestId } = render(ChatComposer, {
      props: { value: '', placeholder: 'Message', onSubmit, testid: 'group-chat-input' }
    });
    const editor = getByTestId('group-chat-input');
    await typeIntoEditor(editor, 'hallo');
    await fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
