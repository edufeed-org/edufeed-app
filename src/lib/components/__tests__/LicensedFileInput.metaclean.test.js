// @ts-nocheck
/**
 * LicensedFileInput — metadata-cleaner interstitial integration.
 *
 * Uses the real LicenseModal and MetadataCleanerModal (not stubbed) so we
 * can assert on their rendered UI, mirroring the pattern established in
 * LicensedImageInput.metaclean.test.js. Only network-ish boundaries
 * (blossom, nostr infra, metaclean service calls) are mocked.
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
  eventStore: { add: vi.fn(), model: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) },
  pool: {
    request: () => {
      throw new Error('not expected');
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: { pubkey: 'p1', signEvent: async (e) => ({ ...e, sig: 's', id: 'i', pubkey: 'p1' }) },
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

// Stub the sibling modal not under test so it doesn't need its own mocks.
vi.mock('../shared/LicenseBadge.svelte', () => ({
  default: () => ({})
}));

import LicensedFileInput from '../shared/LicensedFileInput.svelte';

function pdfFile(name = 'doc.pdf') {
  return new File(['payload'], name, { type: 'application/pdf' });
}

beforeEach(() => {
  mocks.uploadBlob.mockClear();
  mocks.findExistingLicense.mockClear();
  mocks.sha256Hex.mockClear();

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
});

describe('LicensedFileInput metadata cleaner integration', () => {
  it('opens the metadata review before the license modal for supported files', async () => {
    const { container, getByText, queryByTestId } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [pdfFile()] } });

    await waitFor(() => expect(getByText('Check metadata')).toBeTruthy());
    expect(queryByTestId('license-modal')).toBeNull();
    // The interstitial blocks hashing until the user resolves it.
    expect(mocks.sha256Hex).not.toHaveBeenCalled();
  });

  it('continues to the license modal with the original file when user keeps original', async () => {
    const { container, getByText, getByTestId } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const file = pdfFile();
    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByText('Continue with original')).toBeTruthy());
    await fireEvent.click(getByText('Continue with original'));

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    expect(mocks.sha256Hex).toHaveBeenCalledWith(file);
  });

  it('uses the cleaned file for hashing when user applies cleaning, but shows the original filename', async () => {
    const file = pdfFile('report_final.pdf');
    metacleanMocks.downloadCleaned
      .mockReset()
      .mockResolvedValue(new File(['clean'], 'report_final.pdf', { type: 'application/pdf' }));

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
    const hashedFile = mocks.sha256Hex.mock.calls[0][0];
    expect(await hashedFile.text()).toBe('clean');

    // Descriptor row (pending-files list) shows the original filename — scope
    // to the row's own element since the license modal also echoes the name.
    await waitFor(() => {
      const nameEl = container.querySelector('.truncate.font-medium.text-base-content');
      expect(nameEl?.textContent).toBe('report_final.pdf');
    });
  });

  it('skips the interstitial entirely for unsupported files', async () => {
    const { container, getByTestId, queryByText } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const zip = new File(['payload'], 'archive.zip', { type: 'application/zip' });
    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [zip] } });

    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());
    expect(queryByText('Check metadata')).toBeNull();
    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    expect(mocks.sha256Hex).toHaveBeenCalledWith(zip);
  });

  it('routes an oversized PDF into the cleaner instead of rejecting it', async () => {
    const file = pdfFile('big.pdf');
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });

    const { container, getByText, queryByText } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByText('Check metadata')).toBeTruthy());
    expect(queryByText(/exceeds maximum size/)).toBeNull();
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

  it('rejects an oversized unsupported file immediately without the interstitial', async () => {
    const zip = new File(['payload'], 'big.zip', { type: 'application/zip' });
    Object.defineProperty(zip, 'size', { value: 6 * 1024 * 1024 });

    const { container, getByText, queryByText, queryByTestId } = render(LicensedFileInput, {
      props: { files: [] }
    });

    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, { target: { files: [zip] } });

    await waitFor(() => expect(getByText(/exceeds maximum size/)).toBeTruthy());
    expect(queryByText('Check metadata')).toBeNull();
    expect(queryByTestId('license-modal')).toBeNull();
  });
});
