// @ts-nocheck
/**
 * LicensedFileInput — detectInteractive path: .h5p/.xdc packages run through
 * the interactive-upload pipeline before the normal hash/license flow; .html
 * asks first; default (no prop) leaves everything a plain file.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const PKG_BYTES = new Uint8Array([1, 2, 3]);
const ICON_BYTES = new Uint8Array([4, 5, 6]);

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(),
  findExistingLicense: vi.fn(async () => null),
  sha256Hex: vi.fn(async () => 'b'.repeat(64)),
  prepareInteractivePackage: vi.fn(),
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
  runtimeConfig: { blossom: { maxFileSize: 100 * 1024 * 1024 } }
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

vi.mock('$lib/webxdc/interactive-upload.js', async () => {
  const actual = await vi.importActual('$lib/webxdc/interactive-detect.js');
  return {
    isInteractiveCandidate: actual.isInteractiveCandidate,
    prepareInteractivePackage: mocks.prepareInteractivePackage,
    SIZE_WARN_BYTES: 50 * 1024 * 1024
  };
});

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
  licensed_file_input_duplicate_file: ({ name }) => `duplicate: ${name}`,
  interactive_input_invalid: () => 'invalid package',
  interactive_input_too_large: () => 'too large',
  interactive_input_preview: () => 'Preview',
  interactive_badge: () => 'Interactive',
  interactive_html_confirm_question: () => 'Treat as interactive app?',
  interactive_html_confirm_yes: () => 'Wrap as app',
  interactive_html_confirm_no: () => 'Plain file'
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

function preparedPackage(overrides = {}) {
  return {
    file: new File([PKG_BYTES], 'peace-quiz.xdc', { type: 'application/x-webxdc' }),
    bytes: PKG_BYTES,
    name: 'Peace Quiz',
    iconBytes: ICON_BYTES,
    iconMime: 'image/png',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    credit: 'Jane Doe',
    source: 'https://example.org/original',
    sizeWarning: false,
    ...overrides
  };
}

beforeEach(() => {
  mocks.uploadBlob.mockReset();
  mocks.uploadBlob.mockImplementation(async (file) => ({
    url: `https://blossom.example/${file.name}`,
    sha256: file.name.endsWith('.xdc') ? 'c'.repeat(64) : 'd'.repeat(64),
    size: file.size,
    type: file.type
  }));
  mocks.findExistingLicense.mockClear();
  mocks.findExistingLicense.mockResolvedValue(null);
  mocks.sha256Hex.mockClear();
  mocks.prepareInteractivePackage.mockReset();
  mocks.prepareInteractivePackage.mockResolvedValue(preparedPackage());
  mocks.modalProps = null;
});

async function pick(container, file) {
  const fileInput = container.querySelector('input[type="file"]');
  await fireEvent.change(fileInput, { target: { files: [file] } });
  // pipeline + hash + license lookup are chained promises
  await new Promise((r) => setTimeout(r, 10));
}

describe('LicensedFileInput — detectInteractive off (default)', () => {
  it('treats a .xdc like any other file, pipeline never runs', async () => {
    const { container } = render(LicensedFileInput, { props: { files: [] } });
    await pick(container, new File(['x'], 'app.xdc'));

    expect(mocks.prepareInteractivePackage).not.toHaveBeenCalled();
    expect(mocks.modalProps.mime).not.toBe('application/x-webxdc');
  });
});

describe('LicensedFileInput — detectInteractive on', () => {
  it('runs .h5p through the pipeline and opens the modal with prefill + webxdc mime', async () => {
    const { container } = render(LicensedFileInput, {
      props: { files: [], detectInteractive: true }
    });
    await pick(container, new File(['x'], 'quiz.h5p'));

    expect(mocks.prepareInteractivePackage).toHaveBeenCalledTimes(1);
    expect(mocks.modalProps.mime).toBe('application/x-webxdc');
    expect(mocks.modalProps.fileName).toBe('peace-quiz.xdc');
    expect(mocks.modalProps.initialTitle).toBe('Peace Quiz');
    expect(mocks.modalProps.initialLicense).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(mocks.modalProps.initialCredit).toBe('Jane Doe');
    expect(mocks.modalProps.initialSource).toBe('https://example.org/original');
    expect(mocks.modalProps.attestExtras?.alt).toBe('Webxdc app: Peace Quiz');
  });

  it('hashes the normalized .xdc, not the original upload', async () => {
    const { container } = render(LicensedFileInput, {
      props: { files: [], detectInteractive: true }
    });
    await pick(container, new File(['x'], 'quiz.h5p'));

    const hashed = mocks.sha256Hex.mock.calls[0][0];
    expect(hashed.name).toBe('peace-quiz.xdc');
  });

  it('beforeAttest uploads icon first, then the package with webxdc mime', async () => {
    const { container } = render(LicensedFileInput, {
      props: { files: [], detectInteractive: true }
    });
    await pick(container, new File(['x'], 'quiz.h5p'));

    const result = await mocks.modalProps.beforeAttest();

    expect(mocks.uploadBlob).toHaveBeenCalledTimes(2);
    expect(mocks.uploadBlob.mock.calls[0][0].name).toBe('icon.png');
    expect(mocks.uploadBlob.mock.calls[1][0].name).toBe('peace-quiz.xdc');
    expect(result.mime).toBe('application/x-webxdc');
  });

  it('keeps the x-webxdc mime even when the Blossom server sniffs the blob as a zip', async () => {
    // Some Blossom servers (e.g. haven) content-sniff uploads and report
    // application/zip for the wrapped package — that must not clobber the
    // slot's mime, or the resource loses its m/x tags, player, and shelf.
    mocks.uploadBlob.mockImplementation(async (file) => ({
      url: `https://blossom.example/${'e'.repeat(64)}.zip`,
      sha256: 'e'.repeat(64),
      size: file.size,
      type: 'application/zip'
    }));
    const { container, findByText } = render(LicensedFileInput, {
      props: { files: [], detectInteractive: true }
    });
    await pick(container, new File(['x'], 'quiz.h5p'));

    await mocks.modalProps.beforeAttest();

    await findByText('application/x-webxdc', { exact: false });
  });

  it('shows the pipeline error and keeps the list clean when the package is invalid', async () => {
    mocks.prepareInteractivePackage.mockRejectedValueOnce(new Error('Invalid package'));
    const { container, findByText } = render(LicensedFileInput, {
      props: { files: [], detectInteractive: true }
    });
    await pick(container, new File(['x'], 'broken.xdc'));

    await findByText('invalid package');
    expect(mocks.modalProps.open).toBe(false);
    expect(mocks.sha256Hex).not.toHaveBeenCalled();
  });

  it('asks before wrapping a .html file and wraps on confirm', async () => {
    const { container, findByText } = render(LicensedFileInput, {
      props: { files: [], detectInteractive: true }
    });
    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, {
      target: { files: [new File(['<html></html>'], 'game.html', { type: 'text/html' })] }
    });

    const yes = await findByText('Wrap as app');
    await fireEvent.click(yes);
    await new Promise((r) => setTimeout(r, 10));

    expect(mocks.prepareInteractivePackage).toHaveBeenCalledTimes(1);
    expect(mocks.modalProps.mime).toBe('application/x-webxdc');
  });

  it('uploads a declined .html as a plain file', async () => {
    const { container, findByText } = render(LicensedFileInput, {
      props: { files: [], detectInteractive: true }
    });
    const fileInput = container.querySelector('input[type="file"]');
    await fireEvent.change(fileInput, {
      target: { files: [new File(['<html></html>'], 'game.html', { type: 'text/html' })] }
    });

    const no = await findByText('Plain file');
    await fireEvent.click(no);
    await new Promise((r) => setTimeout(r, 10));

    expect(mocks.prepareInteractivePackage).not.toHaveBeenCalled();
    expect(mocks.modalProps.fileName).toBe('game.html');
  });

  it('shows the interactive badge on a webxdc file row', async () => {
    const files = [
      {
        url: 'https://blossom.example/peace-quiz.xdc',
        name: 'peace-quiz.xdc',
        type: 'application/x-webxdc',
        size: 3,
        sha256: 'c'.repeat(64),
        licenseEvent: null
      }
    ];
    const { getByText } = render(LicensedFileInput, {
      props: { files, detectInteractive: true }
    });
    expect(getByText('Interactive')).toBeTruthy();
  });
});
