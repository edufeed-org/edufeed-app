/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  // @ts-expect-error
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

const mocks = vi.hoisted(() => ({
  /** @type {any} */
  existingLicense: null,
  uploadResult: /** @type {any} */ ({
    url: 'https://blossom.example/abc.jpg',
    sha256: 'a'.repeat(64),
    size: 1234,
    type: 'image/jpeg'
  })
}));

vi.mock('blossom-client-sdk', () => ({
  BlossomClient: class {
    constructor() {}
    async uploadBlob() {
      return mocks.uploadResult;
    }
  }
}));

vi.mock('$lib/services/blossom-settings-service.js', () => ({
  getActiveBlossomServer: () => 'https://blossom.example'
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: () => {} },
  pool: {
    request: () => {
      throw new Error('pool.request not expected here');
    }
  }
}));

vi.mock('$lib/helpers/image-license.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/helpers/image-license.js'));
  return {
    ...actual,
    findExistingLicense: vi.fn(async () => mocks.existingLicense)
  };
});

const { uploadAndFindLicense } = await import('../upload-and-find-license.js');

const signer = {
  pubkey: 'a1b2c3d4e5f6',
  signEvent: vi.fn(async (/** @type {any} */ template) => ({
    ...template,
    id: 'signed-id',
    sig: 'sig'
  }))
};

beforeEach(() => {
  mocks.existingLicense = null;
  signer.signEvent.mockClear();
});

describe('uploadAndFindLicense', () => {
  it('returns the blob descriptor + null when no existing license', async () => {
    const result = await uploadAndFindLicense(/** @type {any} */ (new Blob(['x'])), { signer });
    expect(result.url).toBe('https://blossom.example/abc.jpg');
    expect(result.sha256).toBe('a'.repeat(64));
    expect(result.existingLicense).toBeNull();
  });

  it('returns the existing license when findExistingLicense resolves one', async () => {
    mocks.existingLicense = { id: 'existing', kind: 1063 };
    const result = await uploadAndFindLicense(/** @type {any} */ (new Blob(['x'])), { signer });
    expect(result.existingLicense?.id).toBe('existing');
  });

  it('never signs or publishes', async () => {
    await uploadAndFindLicense(/** @type {any} */ (new Blob(['x'])), { signer });
    expect(signer.signEvent).not.toHaveBeenCalled();
  });
});
