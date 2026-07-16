// @ts-nocheck
/**
 * LicensedImageInput — quiet metaclean opt-in integration.
 *
 * Uses the real LicenseModal and MetadataCleanerModal (not stubbed) so we
 * can assert on their rendered UI, mirroring the pattern established in
 * LicensedFileInput.metaclean.test.js. Only network-ish boundaries
 * (blossom, nostr infra, metaclean service calls, license publishing) are
 * mocked.
 *
 * Behavior under test (quiet flow, #47 task 5):
 *   - There is no more pre-hash interstitial for images (they can't be
 *     compressed, so oversized images keep failing fast at the early
 *     size check in handleFileSelected). Picking a supported image opens
 *     the license modal directly, which carries an opt-in "remove hidden
 *     metadata" checkbox (no compression select — images only) + a
 *     "show details" inspect link.
 *   - Cleaning happens silently inside performUpload, right before upload.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(async () => ({
    url: 'https://blossom.example/abc.png',
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
  downloadCleaned: vi.fn(),
  cleanFileQuietly: vi.fn()
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
    downloadCleaned: metacleanMocks.downloadCleaned,
    cleanFileQuietly: metacleanMocks.cleanFileQuietly
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

/**
 * Drives the real LicenseModal's create-own form to a successful Save:
 * fills the required credit field, ticks the disclosure checkbox, clicks
 * Save. License select already defaults to CC BY 4.0.
 * @param {{ getByTestId: any, getByLabelText: any }} screen
 */
async function fillAndSaveLicenseForm({ getByTestId, getByLabelText }) {
  const creditInput = getByLabelText(/Credit/);
  await fireEvent.input(creditInput, { target: { value: 'Jane Doe' } });
  await fireEvent.click(getByTestId('license-modal-disclosure'));
  await fireEvent.click(getByTestId('license-modal-save'));
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
  metacleanMocks.cleanFileQuietly.mockReset();
});

describe('LicensedImageInput metadata cleaner integration (quiet flow)', () => {
  it('opens the license modal directly for a supported image, with metaclean options attached (no compress select)', async () => {
    const { queryByText, getByTestId, queryByTestId } = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [pngFile()] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    expect(queryByText('Check metadata')).toBeNull();
    expect(getByTestId('metaclean-license-checkbox')).toBeTruthy();
    expect(queryByTestId('metaclean-license-compress')).toBeNull();
    expect(getByTestId('metaclean-license-details')).toBeTruthy();
  });

  it('cleans the pending file and uploads the cleaned copy when the checkbox is ticked', async () => {
    metacleanMocks.cleanFileQuietly.mockResolvedValue({
      file: new File(['clean'], 'pic.png', { type: 'image/png' }),
      removedCount: 3,
      cleaned: true
    });

    const file = pngFile();
    const screen = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });
    const { getByTestId } = screen;

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    // The picked file is hashed directly — no interstitial in the way.
    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    expect(mocks.sha256Hex).toHaveBeenCalledWith(file);

    await fireEvent.click(getByTestId('metaclean-license-checkbox'));
    await fillAndSaveLicenseForm(screen);

    await waitFor(() => expect(mocks.uploadBlob).toHaveBeenCalledTimes(1));
    expect(metacleanMocks.cleanFileQuietly).toHaveBeenCalledTimes(1);
    expect(metacleanMocks.cleanFileQuietly.mock.calls[0][0]).toBe(file);
    expect(metacleanMocks.cleanFileQuietly.mock.calls[0][1]).toEqual({ strip: true });

    const uploadedFile = mocks.uploadBlob.mock.calls[0][0];
    expect(await uploadedFile.text()).toBe('clean');

    await waitFor(() =>
      expect(screen.getByText('Hidden metadata removed (3 fields)')).toBeTruthy()
    );
  });

  it('clears the "hidden metadata removed" note once the URL field is edited to a different image', async () => {
    metacleanMocks.cleanFileQuietly.mockResolvedValue({
      file: new File(['clean'], 'pic.png', { type: 'image/png' }),
      removedCount: 3,
      cleaned: true
    });

    const file = pngFile();
    const screen = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });
    const { getByTestId } = screen;

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-license-checkbox'));
    await fillAndSaveLicenseForm(screen);

    await waitFor(() =>
      expect(screen.getByText('Hidden metadata removed (3 fields)')).toBeTruthy()
    );

    // Replacing the image via the URL field points at a different (never
    // cleaned) image — the stale note must not survive.
    const urlInput = getByTestId('licensed-image-url-input');
    await fireEvent.input(urlInput, { target: { value: 'https://example.com/other.png' } });
    await fireEvent.blur(urlInput);

    expect(screen.queryByText('Hidden metadata removed (3 fields)')).toBeNull();
  });

  it('does not clean and uploads the original when the checkbox is left unticked', async () => {
    const file = pngFile();
    const screen = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });
    const { getByTestId } = screen;

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    await fillAndSaveLicenseForm(screen);

    await waitFor(() => expect(mocks.uploadBlob).toHaveBeenCalledTimes(1));
    expect(metacleanMocks.cleanFileQuietly).not.toHaveBeenCalled();
    expect(mocks.uploadBlob.mock.calls[0][0]).toBe(file);
  });

  it('falls back to the original file and shows a failure note when the cleaner errors', async () => {
    metacleanMocks.cleanFileQuietly.mockResolvedValue(null);

    const file = pngFile();
    const screen = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });
    const { getByTestId } = screen;

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-license-checkbox'));
    await fillAndSaveLicenseForm(screen);

    await waitFor(() => expect(mocks.uploadBlob).toHaveBeenCalledTimes(1));
    expect(mocks.uploadBlob.mock.calls[0][0]).toBe(file);

    await waitFor(() =>
      expect(
        screen.getByText('Metadata could not be removed — the original file was uploaded.')
      ).toBeTruthy()
    );
  });

  it('"Show details" opens the read-only inspect modal', async () => {
    const file = pngFile();
    const screen = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });
    const { getByTestId, getByText, queryByTestId } = screen;

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-license-details'));

    await waitFor(() => expect(getByText('File metadata')).toBeTruthy());
    expect(queryByTestId('metaclean-apply')).toBeNull();
  });

  it('shows no metaclean checkbox in the license modal when the cleaner is disabled or file is unsupported', async () => {
    // metadataCleaner.enabled is true in this suite's config mock, so use an
    // unsupported mime type to exercise the isSupportedFile(pendingFile) gate.
    const { getByTestId, queryByTestId } = render(LicensedImageInput, {
      props: { imageUrl: '', imageWasUploaded: false, licenseEvent: null }
    });

    // LicensedImageInput's file input only accepts image/*, but the gate is
    // driven by isSupportedFile (mime allow-list), not the input's accept
    // attribute — an svg (not in the metaclean mime allow-list) still passes
    // the component's own `file.type.startsWith('image/')` check.
    const svg = new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' });
    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [svg] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    expect(queryByTestId('metaclean-license-checkbox')).toBeNull();
  });
});
