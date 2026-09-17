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

  it('skips the metadata cleaner entirely when config disables it', async () => {
    // This suite's config mock (above) has no `metadataCleaner` key, so
    // `runtimeConfig.metadataCleaner?.enabled` is falsy and picking a file
    // must go straight to the license modal path with no cleaner UI.
    const { getByTestId, queryByText } = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });

    const fileInput = getByTestId('licensed-image-file-input');
    const file = new File(['payload'], 'photo.jpg', { type: 'image/jpeg' });

    await fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    expect(mocks.sha256Hex).toHaveBeenCalledWith(file);
    expect(queryByText('Check metadata')).toBeNull();
  });
});

describe('LicensedImageInput — stale re-pick', () => {
  it('ignores a slow sha256 completion when a newer file has been picked', async () => {
    // First sha256 call resolves AFTER the second one. We use deferred
    // promises to control ordering.
    /** @type {(v: string) => void} */
    let resolveFirst;
    const firstPromise = new Promise((res) => {
      resolveFirst = res;
    });
    mocks.sha256Hex.mockImplementationOnce(() => firstPromise);
    mocks.sha256Hex.mockResolvedValueOnce('b'.repeat(64));

    const { getByTestId } = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });

    const fileInput = getByTestId('licensed-image-file-input');
    const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' });

    // Pick A (sha256 hangs), then pick B (sha256 resolves immediately).
    await fireEvent.change(fileInput, { target: { files: [fileA] } });
    await fireEvent.change(fileInput, { target: { files: [fileB] } });
    await new Promise((r) => setTimeout(r, 0));

    // Now resolve A's sha256 — it should be ignored because B superseded it.
    resolveFirst('a'.repeat(64));
    await new Promise((r) => setTimeout(r, 0));

    // findExistingLicense should have been called for B but NOT for A's late
    // completion: at most twice in total (A's first half before B picked,
    // then B's full path).
    const callHashes = mocks.findExistingLicense.mock.calls.map((c) => c[0]);
    // The final state should reflect B's hash, not A's.
    expect(callHashes.at(-1)).toBe('b'.repeat(64));
  });
});

describe('LicensedImageInput — previewShape="avatar"', () => {
  // Issue f2763558: a pasted picture URL gave no feedback at all, so the
  // tester assumed it was not taken and clicked "Add image" instead. The
  // opt-in round preview mirrors the URL live.
  it('renders no preview by default', () => {
    const { queryByTestId } = render(LicensedImageInput, {
      props: { imageUrl: 'https://example.com/pic.png' }
    });
    expect(queryByTestId('licensed-image-preview')).toBeNull();
  });

  it('shows a round preview slot even before a URL is entered', () => {
    const { getByTestId } = render(LicensedImageInput, {
      props: { imageUrl: '', previewShape: 'avatar' }
    });
    const preview = getByTestId('licensed-image-preview');
    expect(preview).toBeTruthy();
    expect(preview.querySelector('img')).toBeNull();
  });

  it('mirrors the typed URL into the preview image', async () => {
    const { getByTestId } = render(LicensedImageInput, {
      props: { imageUrl: '', previewShape: 'avatar' }
    });
    const urlInput = getByTestId('licensed-image-url-input');
    await fireEvent.input(urlInput, { target: { value: 'https://example.com/pic.png' } });

    const img = getByTestId('licensed-image-preview').querySelector('img');
    expect(img).toBeTruthy();
    expect(decodeURIComponent(img.getAttribute('src') ?? '')).toContain(
      'https://example.com/pic.png'
    );
  });
});
