// @ts-nocheck
/**
 * InteractivePackageInput — default icon injection.
 *
 * Every wrapped .xdc archive must ship an icon (spec requirement). When the
 * uploaded package has none (a fresh .html wrap, or an .h5p wrap — which
 * namespaces the original package under h5p/ so even an H5P package with
 * its own icon won't surface one at the top level), the component fetches
 * the app's default icon and injects it before the icon-extraction/upload
 * path runs — so `beforeAttest` uploads it alongside the package with no
 * further changes needed.
 *
 * This mocks LicenseModal (like LicensedFileInput.test.js does) to capture
 * the `beforeAttest` hook and invoke it directly, observing the resulting
 * Blossom uploads rather than poking component internals.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(async (file) => ({
    url: `https://blossom.example/${file.name}`,
    sha256: 'a'.repeat(64),
    size: file.size,
    type: file.type
  })),
  findExistingLicense: vi.fn(async () => null),
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
vi.mock('$lib/helpers/blossom-trust.js', () => ({
  reconcileBlobUrlScheme: (u) => u
}));
vi.mock('$lib/helpers/image-license.js', async (importOriginal) => ({
  ...(await importOriginal()),
  findExistingLicense: mocks.findExistingLicense
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'pk', signEvent: vi.fn() } }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn(), model: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) },
  pool: {
    request: () => {
      throw new Error('not expected');
    }
  }
}));
vi.mock('../shared/LicenseModal.svelte', () => ({
  default: function (_anchor, props) {
    mocks.modalProps = props;
  }
}));

import InteractivePackageInput from '../educational/InteractivePackageInput.svelte';

function pick(container, file) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return fireEvent.change(input);
}

beforeEach(() => {
  mocks.uploadBlob.mockClear();
  mocks.findExistingLicense.mockClear();
  mocks.modalProps = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (String(url).endsWith('/icon-192x192.png')) {
        return new Response(new Uint8Array([1, 2, 3, 4]));
      }
      return new Response('not found', { status: 404 });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('InteractivePackageInput — default icon injection', () => {
  it('fetches the app default icon and uploads it for an .html wrap with no icon of its own', async () => {
    const { container } = render(InteractivePackageInput, { props: { value: null } });
    await pick(container, new File(['<p>hi</p>'], 'quiz.html', { type: 'text/html' }));
    // Two async hops beyond the file read (default-icon fetch, then its
    // arrayBuffer()) — a single macrotask tick isn't always enough for both
    // to settle before we drive beforeAttest ourselves.
    await new Promise((r) => setTimeout(r, 20));

    expect(typeof mocks.modalProps.beforeAttest).toBe('function');
    await mocks.modalProps.beforeAttest();

    // Two uploads: the injected default icon, then the package itself.
    expect(mocks.uploadBlob).toHaveBeenCalledTimes(2);
    const iconCall = mocks.uploadBlob.mock.calls.find(([f]) => f.name === 'icon.png');
    expect(iconCall).toBeTruthy();
    expect(iconCall[0].type).toBe('image/png');
  });
});
