// @ts-nocheck
/**
 * MarkdownEditor — the image toolbar button opens the PC-vs-library source
 * chooser instead of going straight to the file input.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  article_editor_tab_write: () => 'Write',
  article_editor_tab_preview: () => 'Preview',
  image_source_chooser_title: () => 'Add an image',
  image_source_chooser_upload_label: () => 'Upload from computer',
  image_source_chooser_upload_desc: () => 'Pick a file',
  image_source_chooser_library_label: () => 'Choose from library',
  image_source_chooser_library_desc: () => 'Reuse a licensed image',
  image_source_chooser_paste_hint: () => 'Or paste a URL above.',
  image_source_chooser_cancel: () => 'Cancel'
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'p1', signer: {} } }
}));

vi.mock('$lib/helpers/upload-and-find-license.js', () => ({
  uploadAndFindLicense: vi.fn()
}));

// Stub the heavy children; this suite only exercises the chooser wiring.
vi.mock('../shared/LicenseModal.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/MarkdownRenderer.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ImageLibraryPickerModal.svelte', () => ({ default: () => ({}) }));
vi.mock(
  '$lib/stores/mention-candidates.svelte.js',
  () => import('./fixtures/mention-candidates-mock.svelte.js')
);
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));

import MarkdownEditor from '../shared/MarkdownEditor.svelte';

describe('MarkdownEditor — toolbar on the composer editor', () => {
  it('renders the body as the composer editor (contenteditable) with the editor min-height', () => {
    const { getByTestId } = render(MarkdownEditor, { props: { content: '', minHeight: '300px' } });
    const editor = getByTestId('markdown-editor-input');
    expect(editor.getAttribute('contenteditable')).toBe('true');
    expect(editor.style.minHeight).toBe('300px');
  });

  it('Bold wraps the default text at the caret through the editor API', async () => {
    const { getByTitle, getByTestId } = render(MarkdownEditor, { props: { content: 'hello' } });
    const editor = getByTestId('markdown-editor-input');
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await fireEvent.click(getByTitle('Bold'));
    await new Promise((r) => setTimeout(r, 0));
    expect(editor.textContent).toBe('hello**bold text**');
  });
});

describe('MarkdownEditor — image source chooser', () => {
  it('does not show the chooser until the image toolbar button is clicked', () => {
    const { queryByTestId } = render(MarkdownEditor, { props: { content: '' } });
    expect(queryByTestId('chooser-upload')).toBeNull();
    expect(queryByTestId('chooser-library')).toBeNull();
  });

  it('opens the source chooser when the image toolbar button is clicked', async () => {
    const { getByTitle, getByTestId } = render(MarkdownEditor, { props: { content: '' } });

    await fireEvent.click(getByTitle('Image'));

    expect(getByTestId('chooser-upload')).toBeTruthy();
    expect(getByTestId('chooser-library')).toBeTruthy();
  });
});
