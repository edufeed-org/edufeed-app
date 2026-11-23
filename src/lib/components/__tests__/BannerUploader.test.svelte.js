/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const added = vi.hoisted(() => /** @type {any[]} */ ([]));
vi.mock('$lib/paraglide/messages', () => ({
  banner_uploader_drop_or_click: () => 'banner_uploader_drop_or_click',
  banner_uploader_error_invalid_file: () => 'banner_uploader_error_invalid_file',
  banner_uploader_error_no_signer: () => 'banner_uploader_error_no_signer',
  banner_uploader_error_too_large: () => 'banner_uploader_error_too_large',
  banner_uploader_error_upload_failed: () => 'banner_uploader_error_upload_failed',
  banner_uploader_help_text: () => 'banner_uploader_help_text',
  banner_uploader_label: () => 'banner_uploader_label',
  banner_uploader_max_size: () => 'banner_uploader_max_size',
  banner_uploader_replace_button: () => 'banner_uploader_replace_button',
  banner_uploader_url_placeholder: () => 'banner_uploader_url_placeholder',
  image_source_chooser_library_label: () => 'image_source_chooser_library_label',
  max: () => 'max'
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { blossom: { maxFileSize: 5 * 1024 * 1024 } }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: (/** @type {any} */ e) => added.push(e) }
}));
vi.mock('$lib/helpers/upload-and-find-license.js', () => ({ uploadAndFindLicense: vi.fn() }));
vi.mock(
  '$lib/components/shared/LicenseModal.svelte',
  () => import('./__mocks__/DialogModalStub.svelte')
);
vi.mock(
  '$lib/components/shared/ImageLibraryPickerModal.svelte',
  () => import('./fixtures/LibraryPickerStub.svelte')
);

import BannerUploader from '$lib/components/shared/BannerUploader.svelte';

describe('BannerUploader image library (issue wcw946ml)', () => {
  it('a picked library image becomes the banner and brings its license along', async () => {
    const userData = $state({ banner: '' });
    const { getByTestId, container } = render(BannerUploader, {
      props: { userData, signer: {}, errors: {} }
    });
    await fireEvent.click(getByTestId('banner-library-button'));
    await fireEvent.click(getByTestId('stub-pick'));
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://blossom.example/abc.jpg'
    );
    expect(/** @type {HTMLInputElement} */ (container.querySelector('input[type=url]')).value).toBe(
      'https://blossom.example/abc.jpg'
    );
    expect(added).toEqual([{ id: 'lic1' }]);
  });
});
