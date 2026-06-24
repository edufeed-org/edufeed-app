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

import MarkdownEditor from '../shared/MarkdownEditor.svelte';

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
