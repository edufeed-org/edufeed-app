// @ts-nocheck
/**
 * LicensedImageInput — verify the new defer-upload behaviour.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(async () => ({
    url: 'https://blossom.example/abc.jpg',
    sha256: 'a'.repeat(64),
    size: 1234,
    type: 'image/jpeg'
  })),
  findExistingLicense: vi.fn(async () => null),
  sha256Hex: vi.fn(async () => 'a'.repeat(64))
}));

vi.mock('blossom-client-sdk', () => ({
  BlossomClient: class {
    constructor() {}
    uploadBlob = mocks.uploadBlob;
  }
}));

vi.mock('$lib/services/blossom-settings-service.js', () => ({
  getActiveBlossomServer: () => 'https://blossom.example'
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() },
  pool: {
    request: () => {
      throw new Error('not expected');
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: { pubkey: 'p1', signEvent: async (e) => ({ ...e, sig: 's', id: 'i', pubkey: 'p1' }) }
  }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { blossom: { maxFileSize: 5 * 1024 * 1024 } }
}));

vi.mock('$lib/helpers/image-license.js', async () => {
  const actual = await vi.importActual('$lib/helpers/image-license.js');
  return { ...actual, findExistingLicense: mocks.findExistingLicense };
});

vi.mock('$lib/helpers/sha256.js', () => ({
  sha256Hex: mocks.sha256Hex
}));

vi.mock('$lib/helpers/blossom-trust.js', () => ({
  reconcileBlobUrlScheme: (u) => u
}));

vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseForHash: () => () => null
}));

vi.mock('$lib/paraglide/messages', () => ({
  licensed_image_input_error_invalid_file: () => 'invalid',
  licensed_image_input_error_too_large: () => 'too large',
  licensed_image_input_error_upload_failed: () => 'upload failed',
  licensed_image_input_uploading: () => 'uploading',
  licensed_image_input_add_button: () => 'Add image',
  licensed_image_input_url_placeholder: () => 'paste url',
  licensed_image_input_replace_license: () => 'Replace'
}));

// Stub the child modal/sub-components so we can drive them via props.
vi.mock('../shared/LicenseModal.svelte', () => ({
  default: () => ({})
}));
vi.mock('../shared/ImageSourceChooserModal.svelte', () => ({
  default: () => ({})
}));
vi.mock('../shared/ImageLibraryPickerModal.svelte', () => ({
  default: () => ({})
}));
vi.mock('../shared/LicenseBadge.svelte', () => ({
  default: () => ({})
}));

import LicensedImageInput from '../shared/LicensedImageInput.svelte';

beforeEach(() => {
  mocks.uploadBlob.mockClear();
  mocks.findExistingLicense.mockClear();
  mocks.sha256Hex.mockClear();
});

describe('LicensedImageInput — defer upload', () => {
  it('picking a file does not call BlossomClient.uploadBlob', async () => {
    const { getByTestId } = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });

    const fileInput = getByTestId('licensed-image-file-input');
    const file = new File(['payload'], 'photo.jpg', { type: 'image/jpeg' });

    await fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    expect(mocks.findExistingLicense).toHaveBeenCalledTimes(1);
    expect(mocks.uploadBlob).not.toHaveBeenCalled();
  });
});
