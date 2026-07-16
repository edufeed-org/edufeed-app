// @ts-nocheck
/**
 * LicensedFileInput — quiet metaclean opt-in integration.
 *
 * Uses the real LicenseModal and MetadataCleanerModal (not stubbed) so we
 * can assert on their rendered UI, mirroring the pattern established in
 * LicensedImageInput.metaclean.test.js. Only network-ish boundaries
 * (blossom, nostr infra, metaclean service calls, license publishing) are
 * mocked.
 *
 * Behavior under test (quiet flow, #47 task 4):
 *   - The pre-hash interstitial only opens for oversized PDFs (the rescue
 *     case). Normal supported files skip straight to the license modal,
 *     which now carries an opt-in "remove hidden metadata" checkbox (+
 *     compression select for PDFs + a "show details" inspect link).
 *   - Cleaning happens silently inside beforeAttest, right before upload.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(async () => ({
    url: 'https://blossom.example/abc.pdf',
    sha256: 'a'.repeat(64),
    size: 4321,
    type: 'application/pdf'
  })),
  findExistingLicense: vi.fn(async () => null),
  sha256Hex: vi.fn(async () => 'a'.repeat(64))
}));

const metacleanMocks = vi.hoisted(() => ({
  inspectFile: vi.fn(),
  getStripOps: vi.fn(),
  applyOps: vi.fn(),
  downloadCleaned: vi.fn(),
  cleanFileQuietly: vi.fn()
}));

const publishMocks = vi.hoisted(() => ({
  publishEventOptimistic: vi.fn()
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
  eventStore: { add: vi.fn(), model: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) },
  pool: {
    request: () => {
      throw new Error('not expected');
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: {
      pubkey: 'p1',
      signEvent: async (e) => ({ ...e, sig: 's', id: 'i', pubkey: 'p1' })
    },
    active$: {
      subscribe: (cb) => {
        cb({ pubkey: 'p1', signEvent: async (e) => e });
        return { unsubscribe: () => {} };
      }
    }
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

vi.mock('$lib/helpers/sha256.js', () => ({
  sha256Hex: mocks.sha256Hex
}));

vi.mock('$lib/helpers/blossom-trust.js', () => ({
  reconcileBlobUrlScheme: (u) => u
}));

vi.mock('$lib/loaders/blossom-server-loader.js', () => ({
  createBlossomServerLoader: () => () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => []
}));

vi.mock('applesauce-core/models', () => ({
  TimelineModel: 'TimelineModel'
}));

// The license form's Save path publishes a kind 1063 attestation through
// this real helper — only the actual network/publish call is mocked.
vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (...args) => publishMocks.publishEventOptimistic(...args)
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    build: async (template) => ({ ...template, created_at: 1000, pubkey: 'p1' })
  })
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

// Stub the sibling modal not under test so it doesn't need its own mocks.
vi.mock('../shared/LicenseBadge.svelte', () => ({
  default: () => ({})
}));

import LicensedFileInput from '../shared/LicensedFileInput.svelte';

function pdfFile(name = 'doc.pdf') {
  return new File(['payload'], name, { type: 'application/pdf' });
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
  publishMocks.publishEventOptimistic.mockReset();

  metacleanMocks.inspectFile.mockReset().mockResolvedValue({
    sessionId: 's1',
    filename: 'doc.pdf',
    fields: []
  });
  metacleanMocks.getStripOps.mockReset().mockResolvedValue({
    ops: [{ type: 'delete', fieldId: 'pdf.info.Producer' }]
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
    .mockResolvedValue(new File(['clean'], 'doc.pdf', { type: 'application/pdf' }));
  metacleanMocks.cleanFileQuietly.mockReset();
});

describe('LicensedFileInput metadata cleaner integration (quiet flow)', () => {
  it('opens the license modal directly for a normal PDF, with metaclean options attached', async () => {
    const { container, queryByText, getByTestId } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [pdfFile()] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    expect(queryByText('Check metadata')).toBeNull();
    expect(getByTestId('metaclean-license-checkbox')).toBeTruthy();
    expect(getByTestId('metaclean-license-compress')).toBeTruthy();
    expect(getByTestId('metaclean-license-details')).toBeTruthy();
  });

  it('cleans the pending file and uploads the cleaned copy when the checkbox is ticked', async () => {
    metacleanMocks.cleanFileQuietly.mockResolvedValue({
      file: new File(['clean'], 'doc.pdf', { type: 'application/pdf' }),
      removedCount: 2,
      cleaned: true
    });

    const file = pdfFile();
    const screen = render(LicensedFileInput, { props: { files: [] } });
    const { container, getByTestId } = screen;

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-license-checkbox'));

    await fillAndSaveLicenseForm(screen);

    await waitFor(() => expect(mocks.uploadBlob).toHaveBeenCalledTimes(1));
    expect(metacleanMocks.cleanFileQuietly).toHaveBeenCalledTimes(1);
    expect(metacleanMocks.cleanFileQuietly.mock.calls[0][0]).toBe(file);
    expect(metacleanMocks.cleanFileQuietly.mock.calls[0][1]).toEqual({
      strip: true,
      compress: 'off'
    });

    const uploadedFile = mocks.uploadBlob.mock.calls[0][0];
    expect(await uploadedFile.text()).toBe('clean');

    await waitFor(() =>
      expect(screen.getByText('Hidden metadata removed (2 fields)')).toBeTruthy()
    );
  });

  it('does not clean and uploads the original when checkbox unticked and compression off', async () => {
    const file = pdfFile();
    const screen = render(LicensedFileInput, { props: { files: [] } });
    const { container, getByTestId } = screen;

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    await fillAndSaveLicenseForm(screen);

    await waitFor(() => expect(mocks.uploadBlob).toHaveBeenCalledTimes(1));
    expect(metacleanMocks.cleanFileQuietly).not.toHaveBeenCalled();
    expect(mocks.uploadBlob.mock.calls[0][0]).toBe(file);
  });

  it('falls back to the original file and shows a failure note when the cleaner errors', async () => {
    metacleanMocks.cleanFileQuietly.mockResolvedValue(null);

    const file = pdfFile();
    const screen = render(LicensedFileInput, { props: { files: [] } });
    const { container, getByTestId } = screen;

    const fileInput = container.querySelector('input[type="file"]');
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
    const file = pdfFile();
    const screen = render(LicensedFileInput, { props: { files: [] } });
    const { container, getByTestId, getByText, queryByTestId } = screen;

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-license-details'));

    await waitFor(() => expect(getByText('File metadata')).toBeTruthy());
    expect(queryByTestId('metaclean-apply')).toBeNull();
  });

  it('still auto-opens the interstitial for an oversized PDF (rescue case)', async () => {
    const file = pdfFile('big.pdf');
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });

    const { container, getByText } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByText('Check metadata')).toBeTruthy());
    await waitFor(() => expect(getByText(/This file is.*upload limit is/)).toBeTruthy());
  });

  it('rejects an oversized PDF only after keep-original resolves it unchanged', async () => {
    const file = pdfFile('big.pdf');
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });

    const { container, getByText, queryByTestId } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByText('Continue with original')).toBeTruthy());
    await fireEvent.click(getByText('Continue with original'));

    await waitFor(() => expect(getByText(/exceeds maximum size/)).toBeTruthy());
    expect(queryByTestId('license-modal')).toBeNull();
    expect(mocks.sha256Hex).not.toHaveBeenCalled();
  });

  it('accepts an oversized PDF once the cleaned copy fits the limit', async () => {
    const file = pdfFile('big.pdf');
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });
    metacleanMocks.downloadCleaned
      .mockReset()
      .mockResolvedValue(new File(['clean'], 'big.pdf', { type: 'application/pdf' }));

    const { container, getByTestId } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('metaclean-apply')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-apply'));
    await waitFor(() => expect(getByTestId('metaclean-use-cleaned')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-use-cleaned'));

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    expect(await mocks.sha256Hex.mock.calls[0][0].text()).toBe('clean');
  });

  it('shows no metaclean checkbox in the license modal for an unsupported file', async () => {
    const { container, getByTestId, queryByTestId } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const zip = new File(['payload'], 'archive.zip', { type: 'application/zip' });
    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [zip] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    expect(queryByTestId('metaclean-license-checkbox')).toBeNull();
  });
});
