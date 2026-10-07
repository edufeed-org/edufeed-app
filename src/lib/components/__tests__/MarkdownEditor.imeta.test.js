// @ts-nocheck
/**
 * MarkdownEditor — every image inserted into the body is reported through
 * `onmediainsert` with its NIP-94 fields (url, sha256, mime, size, dim,
 * alt), which the article publisher turns into NIP-92 imeta tags.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

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
const { uploadAndFindLicense, readImageDimensions } = vi.hoisted(() => ({
  uploadAndFindLicense: vi.fn(async () => ({
    url: 'https://blossom.example/abc.png',
    sha256: 'a'.repeat(64),
    size: 2048,
    type: 'image/png',
    existingLicense: null
  })),
  readImageDimensions: vi.fn(async () => '640x480')
}));
vi.mock('$lib/helpers/upload-and-find-license.js', () => ({ uploadAndFindLicense }));
vi.mock('$lib/helpers/image-dimensions.js', () => ({ readImageDimensions }));
vi.mock('$lib/helpers/tullu-caption.js', () => ({ buildTulluCaption: () => '' }));
vi.mock('../shared/LicenseModal.svelte', () => import('./fixtures/LicenseModalAutoSave.svelte'));
vi.mock('../shared/MarkdownRenderer.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ImageLibraryPickerModal.svelte', () => ({ default: () => ({}) }));
vi.mock(
  '$lib/stores/mention-candidates.svelte.js',
  () => import('./fixtures/mention-candidates-mock.svelte.js')
);
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));

import MarkdownEditor from '../shared/MarkdownEditor.svelte';

describe('MarkdownEditor — onmediainsert', () => {
  it('reports an uploaded image with url, sha256, mime, size, dim and alt once the license is saved', async () => {
    const onmediainsert = vi.fn();
    const { container } = render(MarkdownEditor, { props: { content: '', onmediainsert } });
    const input = container.querySelector('input[type="file"]');
    const file = new File(['png'], 'cat.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    await fireEvent.change(input);

    await waitFor(() => expect(onmediainsert).toHaveBeenCalledTimes(1));
    expect(readImageDimensions).toHaveBeenCalledWith(file);
    expect(onmediainsert).toHaveBeenCalledWith({
      url: 'https://blossom.example/abc.png',
      sha256: 'a'.repeat(64),
      type: 'image/png',
      size: 2048,
      dimensions: '640x480',
      alt: 'cat.png'
    });
  });
});
