/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import LicensedImageInput from '$lib/components/shared/LicensedImageInput.svelte';

vi.mock('blossom-client-sdk', () => ({ BlossomClient: class {} }));
vi.mock('$lib/helpers/sha256.js', () => ({ sha256Hex: async () => 'a'.repeat(64) }));
vi.mock('$lib/helpers/image-license.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/helpers/image-license.js'));
  return { ...actual, findExistingLicense: vi.fn(async () => null) };
});
const mockSignEvent = vi.fn(async (template) => ({
  ...template,
  id: 'signed-id',
  pubkey: 'b'.repeat(64),
  sig: 'c'.repeat(128)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return { pubkey: 'b'.repeat(64), signEvent: mockSignEvent };
    }
  }
}));
vi.mock('$lib/services/blossom-settings-service.js', () => ({
  getActiveBlossomServer: () => 'https://blossom.example',
  getBlossomUploadServers: () => ['https://blossom.example'],
  getPublicBlossomServers: () => [],
  isDefaultBlossomServer: () => false
}));
vi.mock('$app/navigation', () => ({ goto: () => {} }));
vi.mock('$lib/stores/blossom-eligibility.svelte.js', () => ({
  isBlossomEligible: () => true,
  refreshBlossomEligibility: async () => {}
}));
const mockPublish = vi.fn();
vi.mock('$lib/services/publish-service.js', () => ({
  /** @param {...any} args */
  publishEventOptimistic: (...args) => mockPublish(...args)
}));
/** @type {import('nostr-tools').NostrEvent | null} */
let mockLicenseForHash = null;
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseForHash: () => () => mockLicenseForHash
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { blossom: { maxFileSize: 5 * 1024 * 1024 } }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() },
  pool: { request: vi.fn(() => ({ pipe: vi.fn(() => ({ subscribe: vi.fn() })) })) }
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    /** @param {any} template */
    build: async (template) => ({ ...template, created_at: 1000, pubkey: 'b'.repeat(64) })
  })
}));

const EXTERNAL_URL = 'https://www.brot-fuer-die-welt.de/bilder/kampagne.jpg';
const HASH = 'f'.repeat(64);

/** @param {{ ok?: boolean, body?: any }} [opts] */
function stubImageHash({
  ok = true,
  body = { sha256: HASH, size: 4321, mime: 'image/jpeg' }
} = {}) {
  const fetchMock = vi.fn(async (/** @type {string} */ _url) => ({
    ok,
    status: ok ? 200 : 502,
    json: async () => body
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderInput() {
  let state = $state({ imageUrl: '', imageWasUploaded: false, licenseEvent: null });
  const utils = render(LicensedImageInput, {
    get imageUrl() {
      return state.imageUrl;
    },
    set imageUrl(v) {
      state.imageUrl = v;
    },
    get imageWasUploaded() {
      return state.imageWasUploaded;
    },
    set imageWasUploaded(v) {
      state.imageWasUploaded = v;
    },
    get licenseEvent() {
      return state.licenseEvent;
    },
    set licenseEvent(v) {
      state.licenseEvent = v;
    },
    errors: {}
  });
  return { state, ...utils };
}

/** @param {ReturnType<typeof renderInput>} r */
async function pasteExternalUrl(r) {
  const urlInput = r.getByTestId('licensed-image-url-input');
  await fireEvent.input(urlInput, { target: { value: EXTERNAL_URL } });
  await fireEvent.blur(urlInput);
}

describe('LicensedImageInput — external image URLs', () => {
  beforeEach(() => {
    mockPublish.mockReset();
    mockSignEvent.mockClear();
    mockLicenseForHash = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hashes a pasted external URL via /api/image-hash and offers to attest a license', async () => {
    const fetchMock = stubImageHash();
    const r = renderInput();
    await pasteExternalUrl(r);

    await waitFor(() => expect(r.getByTestId('licensed-image-attest-external')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/image-hash?url=${encodeURIComponent(EXTERNAL_URL)}`
    );
    // No modal until the user asks for it; the URL still passes through.
    expect(r.queryByTestId('license-modal')).toBeNull();
    expect(r.state.imageUrl).toBe(EXTERNAL_URL);
    expect(r.state.imageWasUploaded).toBe(false);
  });

  it('attests the external URL with the server-computed hash, mime and size', async () => {
    stubImageHash();
    const r = renderInput();
    await pasteExternalUrl(r);
    await waitFor(() => expect(r.getByTestId('licensed-image-attest-external')).toBeTruthy());

    await fireEvent.click(r.getByTestId('licensed-image-attest-external'));
    await waitFor(() => expect(r.getByTestId('license-modal')).toBeTruthy());

    await fireEvent.change(r.getByLabelText(/License/), {
      target: { value: 'https://creativecommons.org/licenses/by/4.0/' }
    });
    await fireEvent.input(r.getByLabelText(/Credit/), { target: { value: 'Brot für die Welt' } });
    await fireEvent.click(r.getByTestId('license-modal-disclosure'));
    await fireEvent.click(r.getByTestId('license-modal-save'));

    await waitFor(() => expect(mockPublish).toHaveBeenCalled());
    const [signedEvent] = mockPublish.mock.calls[0];
    expect(signedEvent.kind).toBe(1063);
    expect(signedEvent.tags).toEqual(
      expect.arrayContaining([
        ['url', EXTERNAL_URL],
        ['x', HASH],
        ['m', 'image/jpeg'],
        ['size', '4321'],
        ['credit', 'Brot für die Welt']
      ])
    );
    // Nothing was uploaded: the image stays where it is.
    expect(r.state.imageUrl).toBe(EXTERNAL_URL);
    expect(r.state.imageWasUploaded).toBe(false);
  });

  it('keeps the pasted URL when the user cancels the license modal', async () => {
    stubImageHash();
    const r = renderInput();
    await pasteExternalUrl(r);
    await waitFor(() => expect(r.getByTestId('licensed-image-attest-external')).toBeTruthy());

    await fireEvent.click(r.getByTestId('licensed-image-attest-external'));
    await waitFor(() => expect(r.getByTestId('license-modal')).toBeTruthy());
    const cancelBtn = /** @type {HTMLButtonElement} */ (
      r.getByTestId('license-modal').querySelectorAll('.modal-action button')[0]
    );
    await fireEvent.click(cancelBtn);

    await waitFor(() => expect(r.queryByTestId('license-modal')).toBeNull());
    expect(r.state.imageUrl).toBe(EXTERNAL_URL);
    expect(r.getByTestId('licensed-image-attest-external')).toBeTruthy();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('shows the existing license instead of the button when one exists for the hash', async () => {
    stubImageHash();
    mockLicenseForHash = /** @type {any} */ ({
      id: 'lic',
      kind: 1063,
      pubkey: 'b'.repeat(64),
      created_at: 1,
      content: '',
      sig: '',
      tags: [
        ['x', HASH],
        ['url', EXTERNAL_URL],
        ['license', 'https://de.wikipedia.org/wiki/Urheberrecht_(Deutschland)'],
        ['credit', 'Brot für die Welt']
      ]
    });
    const r = renderInput();
    await pasteExternalUrl(r);

    await waitFor(() => expect(r.state.licenseEvent).not.toBeNull());
    expect(r.queryByTestId('licensed-image-attest-external')).toBeNull();
  });

  it('degrades silently when the hash endpoint fails', async () => {
    stubImageHash({ ok: false, body: null });
    const r = renderInput();
    await pasteExternalUrl(r);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.queryByTestId('licensed-image-attest-external')).toBeNull();
    expect(r.queryByTestId('license-modal')).toBeNull();
    expect(r.state.imageUrl).toBe(EXTERNAL_URL);
    expect(r.state.licenseEvent).toBeNull();
  });

  it('does not call the endpoint for Blossom URLs (hash comes from the URL)', async () => {
    const fetchMock = stubImageHash();
    const r = renderInput();
    const urlInput = r.getByTestId('licensed-image-url-input');
    await fireEvent.input(urlInput, { target: { value: `https://blossom.example/${HASH}.jpg` } });
    await fireEvent.blur(urlInput);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.queryByTestId('licensed-image-attest-external')).toBeNull();
  });
});
