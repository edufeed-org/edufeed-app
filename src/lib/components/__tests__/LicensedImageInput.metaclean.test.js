// @ts-nocheck
/**
 * LicensedImageInput — metadata-cleaner interstitial integration.
 *
 * Uses the real LicenseModal and MetadataCleanerModal (not stubbed) so we
 * can assert on their rendered UI, mirroring the pattern in
 * LicensedImageInput.test.svelte.js. Only network-ish boundaries (blossom,
 * nostr infra, metaclean service calls) are mocked.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(async () => ({
    url: 'https://blossom.example/abc.jpg',
    sha256: 'a'.repeat(64),
    size: 1234,
    type: 'image/png'
  })),
  findExistingLicense: vi.fn(async () => null),
  sha256Hex: vi.fn(async () => 'a'.repeat(64)),
  publish: vi.fn()
}));

const metacleanMocks = vi.hoisted(() => ({
  inspectFile: vi.fn(),
  getStripOps: vi.fn(),
  applyOps: vi.fn(),
  downloadCleaned: vi.fn()
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
  runtimeConfig: {
    blossom: { maxFileSize: 5 * 1024 * 1024 },
    metadataCleaner: { enabled: true }
  }
}));

vi.mock('$lib/helpers/image-license.js', async () => {
  const actual = await vi.importActual('$lib/helpers/image-license.js');
  return { ...actual, findExistingLicense: mocks.findExistingLicense };
});

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (...args) => mocks.publish(...args)
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    build: async (template) => ({ ...template, created_at: 1000, pubkey: 'p1' })
  })
}));

vi.mock('$lib/helpers/sha256.js', () => ({
  sha256Hex: mocks.sha256Hex
}));

vi.mock('$lib/helpers/blossom-trust.js', () => ({
  reconcileBlobUrlScheme: (u) => u
}));

vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseForHash: () => () => null
}));

vi.mock('$lib/helpers/metaclean.js', async () => {
  const actual = await vi.importActual('$lib/helpers/metaclean.js');
  return {
    ...actual,
    inspectFile: metacleanMocks.inspectFile,
    getStripOps: metacleanMocks.getStripOps,
    applyOps: metacleanMocks.applyOps,
    downloadCleaned: metacleanMocks.downloadCleaned
  };
});

// Stub the sibling modals not under test so they don't need their own mocks.
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

function pngFile(name = 'pic.png') {
  return new File(['payload'], name, { type: 'image/png' });
}

beforeEach(() => {
  mocks.uploadBlob.mockClear();
  mocks.findExistingLicense.mockClear();
  mocks.sha256Hex.mockClear();
  mocks.publish.mockClear();

  metacleanMocks.inspectFile.mockReset().mockResolvedValue({
    sessionId: 's1',
    filename: 'pic.png',
    fields: []
  });
  metacleanMocks.getStripOps.mockReset().mockResolvedValue({
    ops: [{ type: 'delete', fieldId: 'png.exif.Software' }]
  });
  metacleanMocks.applyOps.mockReset().mockResolvedValue({
    before: [],
    after: [],
    leaks: [],
    sizeBefore: 100,
    sizeAfter: 80
  });
  metacleanMocks.downloadCleaned
    .mockReset()
    .mockResolvedValue(new File(['clean'], 'pic.png', { type: 'image/png' }));
});

describe('LicensedImageInput metadata cleaner integration', () => {
  it('opens the metadata review before the license modal for supported files', async () => {
    const { getByTestId, getByText, queryByTestId } = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [pngFile()] } });

    await waitFor(() => expect(getByText('Check metadata')).toBeTruthy());
    expect(queryByTestId('license-modal')).toBeNull();
    // The interstitial blocks hashing until the user resolves it.
    expect(mocks.sha256Hex).not.toHaveBeenCalled();
  });

  it('continues to the license modal with the original file when user keeps original', async () => {
    const { getByTestId, getByText } = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });

    const file = pngFile();
    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByText('Continue with original')).toBeTruthy());
    await fireEvent.click(getByText('Continue with original'));

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    expect(mocks.sha256Hex).toHaveBeenCalledWith(file);
  });

  it('uses the cleaned file for hashing when user applies cleaning', async () => {
    const { getByTestId } = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [pngFile()] } });

    await waitFor(() => expect(getByTestId('metaclean-apply')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-apply'));

    await waitFor(() => expect(getByTestId('metaclean-use-cleaned')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-use-cleaned'));

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    const hashedFile = mocks.sha256Hex.mock.calls[0][0];
    expect(await hashedFile.text()).toBe('clean');
  });
});
