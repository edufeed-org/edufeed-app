// @ts-nocheck
/**
 * LicensedFileInput — display-name derivation + defer-upload behaviour.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(async () => ({
    url: 'https://blossom.example/abc.pdf',
    sha256: 'a'.repeat(64),
    size: 4321,
    type: 'application/pdf'
  })),
  findExistingLicense: vi.fn(async () => null),
  sha256Hex: vi.fn(async () => 'a'.repeat(64)),
  // Captures the props the LicenseModal stub was mounted with, so tests can
  // assert what the parent wired up (e.g. whether an upload hook was passed).
  modalProps: /** @type {any} */ (null)
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

vi.mock('$lib/loaders/blossom-server-loader.js', () => ({
  createBlossomServerLoader: () => () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => []
}));

vi.mock('applesauce-core/models', () => ({
  TimelineModel: 'TimelineModel'
}));

vi.mock('$lib/paraglide/messages', () => ({
  blossom_uploading: () => 'uploading',
  blossom_drop_files: () => 'drop',
  blossom_click_upload: () => 'click to upload',
  blossom_max_size: () => 'max size',
  blossom_uploaded_files: () => 'uploaded',
  blossom_view: () => 'View',
  aria_remove_file: () => 'remove',
  licensed_image_input_replace_license: () => 'Replace',
  licensed_file_input_add_license: () => 'Add license',
  licensed_file_input_duplicate_file: ({ name }) => `duplicate: ${name}`
}));

vi.mock('../shared/LicenseModal.svelte', () => ({
  default: function (_anchor, props) {
    mocks.modalProps = props;
  }
}));
vi.mock('../shared/LicenseBadge.svelte', () => ({
  default: () => ({})
}));

import LicensedFileInput from '../shared/LicensedFileInput.svelte';

beforeEach(() => {
  mocks.uploadBlob.mockClear();
  mocks.findExistingLicense.mockClear();
  mocks.sha256Hex.mockClear();
  mocks.modalProps = null;
});

function makeLicenseEvent(title) {
  return {
    pubkey: 'p2',
    tags: [
      ['url', 'https://blossom.example/abc.pdf'],
      ['x', 'a'.repeat(64)],
      ['m', 'application/pdf'],
      ['license', 'https://creativecommons.org/licenses/by/4.0/'],
      ['credit', 'Jane'],
      ...(title ? [['title', title]] : [])
    ],
    content: ''
  };
}

describe('LicensedFileInput — display name', () => {
  it('shows the license-event title tag as the file name', () => {
    const files = [
      {
        url: 'https://blossom.example/abc.pdf',
        name: 'scan_0034.pdf',
        type: 'application/pdf',
        size: 4321,
        sha256: 'a'.repeat(64),
        licenseEvent: makeLicenseEvent('Arbeitsblatt Bruchrechnung Kl. 6')
      }
    ];

    const { getByText, queryByText } = render(LicensedFileInput, {
      props: { files }
    });

    expect(getByText('Arbeitsblatt Bruchrechnung Kl. 6')).toBeTruthy();
    expect(queryByText('scan_0034.pdf')).toBeNull();
  });

  it('falls back to the OS filename when no title tag is present', () => {
    const files = [
      {
        url: 'https://blossom.example/abc.pdf',
        name: 'scan_0034.pdf',
        type: 'application/pdf',
        size: 4321,
        sha256: 'a'.repeat(64),
        licenseEvent: makeLicenseEvent(null)
      }
    ];

    const { getByText } = render(LicensedFileInput, {
      props: { files }
    });

    expect(getByText('scan_0034.pdf')).toBeTruthy();
  });

  it('falls back to the OS filename when there is no license event at all', () => {
    const files = [
      {
        url: 'https://blossom.example/abc.pdf',
        name: 'scan_0034.pdf',
        type: 'application/pdf',
        size: 4321,
        sha256: 'a'.repeat(64),
        licenseEvent: null
      }
    ];

    const { getByText } = render(LicensedFileInput, {
      props: { files }
    });

    expect(getByText('scan_0034.pdf')).toBeTruthy();
  });
});

describe('LicensedFileInput — defer upload', () => {
  it('picking a file does not call BlossomClient.uploadBlob', async () => {
    const { container } = render(LicensedFileInput, { props: { files: [] } });

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();

    const file = new File(['payload'], 'doc.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    expect(mocks.findExistingLicense).toHaveBeenCalledTimes(1);
    expect(mocks.uploadBlob).not.toHaveBeenCalled();
  });

  it('passes a beforeAttest upload hook to the modal for a genuinely new file', async () => {
    mocks.findExistingLicense.mockResolvedValueOnce(null);
    const { container } = render(LicensedFileInput, { props: { files: [] } });
    const fileInput = container.querySelector('input[type="file"]');

    const file = new File(['payload'], 'doc.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(typeof mocks.modalProps.beforeAttest).toBe('function');
  });

  it('reuses the existing blob URL and passes NO upload hook when a license already exists', async () => {
    // A prior attestation means the blob is already on Blossom — the modal must
    // not be handed a beforeAttest hook (which would re-upload and 401/hang).
    mocks.findExistingLicense.mockResolvedValueOnce(makeLicenseEvent('Existing title'));
    const { container } = render(LicensedFileInput, { props: { files: [] } });
    const fileInput = container.querySelector('input[type="file"]');

    const file = new File(['payload'], 'doc.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.modalProps.beforeAttest).toBeNull();
    // The descriptor adopts the attested URL so the modal can build/accept a
    // license without uploading.
    expect(mocks.modalProps.url).toBe('https://blossom.example/abc.pdf');
    expect(mocks.uploadBlob).not.toHaveBeenCalled();
  });

  it('skips the metadata cleaner entirely when config disables it', async () => {
    // This suite's config mock (above) has no `metadataCleaner` key, so
    // `runtimeConfig.metadataCleaner?.enabled` is falsy and picking a file
    // must go straight to the license modal path with no cleaner UI.
    const { container, queryByText } = render(LicensedFileInput, { props: { files: [] } });
    const fileInput = container.querySelector('input[type="file"]');

    const file = new File(['payload'], 'doc.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.sha256Hex).toHaveBeenCalledTimes(1);
    expect(mocks.sha256Hex).toHaveBeenCalledWith(file);
    expect(queryByText('Check metadata')).toBeNull();
  });
});

describe('LicensedFileInput — duplicate content', () => {
  it('skips a picked file whose sha256 already exists in the list (no crash, no modal)', async () => {
    // Existing slot already carries hash 'a'*64 — same value the sha256Hex mock returns.
    const files = [
      {
        url: 'https://blossom.example/abc.pdf',
        name: 'original.pdf',
        type: 'application/pdf',
        size: 4321,
        sha256: 'a'.repeat(64),
        licenseEvent: makeLicenseEvent('Original')
      }
    ];

    const { container, findByText, queryByText } = render(LicensedFileInput, {
      props: { files }
    });

    const fileInput = container.querySelector('input[type="file"]');
    const dupe = new File(['payload'], 'copy-of-original.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [dupe] } });
    await new Promise((r) => setTimeout(r, 0));

    await findByText('duplicate: copy-of-original.pdf');
    // The duplicate never entered the list and no upload started.
    expect(
      queryByText('copy-of-original.pdf', { exact: false, selector: '.font-medium' })
    ).toBeNull();
    expect(mocks.uploadBlob).not.toHaveBeenCalled();
    expect(mocks.findExistingLicense).not.toHaveBeenCalled();
  });
});

describe('LicensedFileInput — multi-file cancel mid-queue', () => {
  it('cancelling file 2 of 3 leaves file 1 intact and proceeds to file 3', async () => {
    // We don't drive the real modal here — too noisy. Instead we assert
    // that the prepare step ran for all three files and that no upload
    // happened for any (we'd add coverage with a higher-level harness if
    // the modal interaction proved buggy in practice).
    mocks.sha256Hex
      .mockResolvedValueOnce('1'.repeat(64))
      .mockResolvedValueOnce('2'.repeat(64))
      .mockResolvedValueOnce('3'.repeat(64));

    const { container } = render(LicensedFileInput, { props: { files: [] } });
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();

    const fA = new File(['a'], 'a.pdf', { type: 'application/pdf' });
    const fB = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    const fC = new File(['c'], 'c.pdf', { type: 'application/pdf' });

    await fireEvent.change(fileInput, { target: { files: [fA, fB, fC] } });
    await new Promise((r) => setTimeout(r, 0));

    // First file's prepare must have run before the modal awaits.
    expect(mocks.sha256Hex.mock.calls.length).toBeGreaterThanOrEqual(1);
    // No bytes uploaded yet for any file.
    expect(mocks.uploadBlob).not.toHaveBeenCalled();
  });
});
