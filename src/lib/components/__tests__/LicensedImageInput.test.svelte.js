/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import LicensedImageInput from '$lib/components/shared/LicensedImageInput.svelte';

const mockUploadBlob = vi.fn();
vi.mock('blossom-client-sdk', () => ({
  BlossomClient: class MockBlossomClient {
    constructor() {}
    /** @param {...any} args */
    uploadBlob(...args) {
      return mockUploadBlob(...args);
    }
  }
}));

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
  getActiveBlossomServer: () => 'https://blossom.example'
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
  eventStore: { add: vi.fn() }
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    /** @param {any} template */
    build: async (template) => ({ ...template, created_at: 1000, pubkey: 'b'.repeat(64) })
  })
}));

function makeFile(name = 'test.jpg', type = 'image/jpeg', size = 100) {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe('LicensedImageInput', () => {
  beforeEach(() => {
    mockUploadBlob.mockReset();
    mockSignEvent.mockClear();
    mockPublish.mockReset();
    mockLicenseForHash = null;
  });

  it('uploads a file, opens the license modal when no license exists, publishes on save', async () => {
    const hash = 'a'.repeat(64);
    mockUploadBlob.mockResolvedValue({
      url: `https://blossom.example/${hash}.jpg`,
      sha256: hash,
      size: 100,
      type: 'image/jpeg'
    });

    let state = $state({ imageUrl: '', imageWasUploaded: false, licenseEvent: null });
    const { getByTestId, getByLabelText } = render(LicensedImageInput, {
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

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [makeFile()] } });

    await waitFor(() => expect(state.imageWasUploaded).toBe(true));
    expect(state.imageUrl).toContain(hash);
    expect(getByTestId('license-modal')).toBeTruthy();

    const licenseSelect = getByLabelText(/License/);
    await fireEvent.change(licenseSelect, {
      target: { value: 'https://creativecommons.org/licenses/by/4.0/' }
    });
    const creditInput = getByLabelText(/Credit/);
    await fireEvent.input(creditInput, { target: { value: 'Jane Doe' } });

    const saveBtn = getByTestId('license-modal-save');
    await fireEvent.click(saveBtn);

    await waitFor(() => expect(mockPublish).toHaveBeenCalled());
    const [signedEvent] = mockPublish.mock.calls[0];
    expect(signedEvent.kind).toBe(1063);
    expect(signedEvent.tags).toEqual(
      expect.arrayContaining([
        ['x', hash],
        ['license', 'https://creativecommons.org/licenses/by/4.0/'],
        ['credit', 'Jane Doe']
      ])
    );
  });

  it('does NOT auto-open the modal for a pasted URL', async () => {
    const hash = 'd'.repeat(64);
    let state = $state({ imageUrl: '', imageWasUploaded: true, licenseEvent: null });
    const { getByTestId, queryByTestId } = render(LicensedImageInput, {
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

    const urlInput = getByTestId('licensed-image-url-input');
    await fireEvent.input(urlInput, { target: { value: `https://blossom.example/${hash}.jpg` } });
    await fireEvent.blur(urlInput);

    await waitFor(() => expect(state.imageWasUploaded).toBe(false));
    expect(queryByTestId('license-modal')).toBeNull();
  });

  it('passes a non-Blossom URL through with no modal and no hash', async () => {
    let state = $state({ imageUrl: '', imageWasUploaded: false, licenseEvent: null });
    const { getByTestId, queryByTestId } = render(LicensedImageInput, {
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

    const urlInput = getByTestId('licensed-image-url-input');
    await fireEvent.input(urlInput, { target: { value: 'https://wikipedia.org/foo.jpg' } });
    await fireEvent.blur(urlInput);

    expect(queryByTestId('license-modal')).toBeNull();
    expect(state.licenseEvent).toBeNull();
  });

  it('cancel on the license modal clears imageUrl, imageWasUploaded, licenseEvent and does not publish', async () => {
    const hash = 'a'.repeat(64);
    mockUploadBlob.mockResolvedValue({
      url: `https://blossom.example/${hash}.jpg`,
      sha256: hash,
      size: 100,
      type: 'image/jpeg'
    });

    let state = $state({ imageUrl: '', imageWasUploaded: false, licenseEvent: null });
    const { getByTestId } = render(LicensedImageInput, {
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
      errors: {},
      activeUserDisplayName: 'Tester'
    });

    const fileInput = getByTestId('licensed-image-file-input');
    await fireEvent.change(fileInput, { target: { files: [makeFile()] } });

    // Wait for upload to complete and the mandatory modal to appear.
    await waitFor(() => expect(state.imageWasUploaded).toBe(true));
    const modal = getByTestId('license-modal');
    expect(modal).toBeTruthy();

    // Cancel button is the first button in .modal-action (Save has the testid).
    const modalActionButtons = modal.querySelectorAll('.modal-action button');
    const cancelBtn = /** @type {HTMLButtonElement} */ (modalActionButtons[0]);
    expect(cancelBtn).toBeTruthy();
    await fireEvent.click(cancelBtn);

    // Cancel must wipe the upload state and not publish/sign anything.
    await waitFor(() => {
      expect(state.imageUrl).toBe('');
      expect(state.imageWasUploaded).toBe(false);
      expect(state.licenseEvent).toBeNull();
    });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockSignEvent).not.toHaveBeenCalled();
  });

  it('"I am the creator" autofills credit and adds a p tag', async () => {
    const hash = 'e'.repeat(64);
    mockUploadBlob.mockResolvedValue({
      url: `https://blossom.example/${hash}.jpg`,
      sha256: hash,
      size: 100,
      type: 'image/jpeg'
    });

    let state = $state({ imageUrl: '', imageWasUploaded: false, licenseEvent: null });
    const { getByTestId, getByLabelText } = render(LicensedImageInput, {
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
      errors: {},
      activeUserDisplayName: 'Jane Doe'
    });

    await fireEvent.change(getByTestId('licensed-image-file-input'), {
      target: { files: [makeFile()] }
    });
    await waitFor(() => expect(getByTestId('license-modal')).toBeTruthy());

    await fireEvent.click(getByLabelText(/I am the creator/));
    const creditInput = /** @type {HTMLInputElement} */ (getByLabelText(/Credit/));
    expect(creditInput.value).toBe('Jane Doe');

    await fireEvent.change(getByLabelText(/License/), {
      target: { value: 'https://creativecommons.org/licenses/by/4.0/' }
    });
    await fireEvent.click(getByTestId('license-modal-save'));

    await waitFor(() => expect(mockPublish).toHaveBeenCalled());
    const [signedEvent] = mockPublish.mock.calls[0];
    expect(signedEvent.tags).toEqual(
      expect.arrayContaining([
        ['p', 'b'.repeat(64)],
        ['credit', 'Jane Doe']
      ])
    );
  });
});
