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
  /** @type {any[]} */
  added: [],
  /** @type {any[]} */
  published: [],
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
  eventStore: { add: (/** @type {any} */ e) => mocks.added.push(e) },
  pool: {
    request: () => {
      throw new Error('pool.request should not be called directly in this test');
    }
  }
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (/** @type {any} */ e) => mocks.published.push(e)
}));

vi.mock('$lib/helpers/image-license.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/helpers/image-license.js'));
  return {
    ...actual,
    findExistingLicense: vi.fn(async () => mocks.existingLicense)
  };
});

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    build: async (/** @type {any} */ template) => ({
      ...template,
      created_at: 1000,
      pubkey: 'pubkey-mock'
    })
  })
}));

const { uploadWithAutoSelfLicense } = await import('../auto-self-license.js');

const signer = {
  pubkey: 'a1b2c3d4e5f6',
  signEvent: vi.fn(async (/** @type {any} */ template) => ({
    ...template,
    id: 'signed-id',
    sig: 'sig-mock'
  }))
};

beforeEach(() => {
  mocks.added.length = 0;
  mocks.published.length = 0;
  mocks.existingLicense = null;
  signer.signEvent.mockClear();
});

describe('uploadWithAutoSelfLicense', () => {
  it('uploads and returns the blob descriptor', async () => {
    const result = await uploadWithAutoSelfLicense(/** @type {any} */ (new Blob(['x'])), {
      signer,
      displayName: 'Jane',
      pubkey: signer.pubkey
    });
    expect(result.url).toBe('https://blossom.example/abc.jpg');
    expect(result.sha256).toBe('a'.repeat(64));
  });

  it('skips publishing when an existing license is found', async () => {
    mocks.existingLicense = { id: 'existing', kind: 1063 };
    await uploadWithAutoSelfLicense(/** @type {any} */ (new Blob(['x'])), {
      signer,
      displayName: 'Jane',
      pubkey: signer.pubkey
    });
    expect(signer.signEvent).not.toHaveBeenCalled();
    expect(mocks.published).toHaveLength(0);
  });

  it('publishes a kind 1063 self-credit attestation when no existing license', async () => {
    await uploadWithAutoSelfLicense(/** @type {any} */ (new Blob(['x'])), {
      signer,
      displayName: 'Jane Doe',
      pubkey: signer.pubkey
    });
    expect(signer.signEvent).toHaveBeenCalledTimes(1);
    expect(mocks.published).toHaveLength(1);
    // Note: publishEventOptimistic internally adds to eventStore; we no longer
    // call eventStore.add() explicitly from auto-self-license.

    const published = mocks.published[0];
    expect(published.kind).toBe(1063);
    const tagsByKey = Object.fromEntries(
      published.tags.map((/** @type {any[]} */ t) => [t[0], t[1]])
    );
    expect(tagsByKey.x).toBe('a'.repeat(64));
    expect(tagsByKey.url).toBe('https://blossom.example/abc.jpg');
    expect(tagsByKey.m).toBe('image/jpeg');
    expect(tagsByKey.license).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(tagsByKey.credit).toBe('Jane Doe');
    expect(tagsByKey.p).toBe(signer.pubkey);
  });

  it('falls back to truncated pubkey when displayName is empty', async () => {
    await uploadWithAutoSelfLicense(/** @type {any} */ (new Blob(['x'])), {
      signer,
      displayName: '',
      pubkey: 'abc123def456'
    });
    const published = mocks.published[0];
    const credit = published.tags.find((/** @type {any} */ t) => t[0] === 'credit')?.[1];
    expect(credit).toBe('abc123de');
  });

  it('returns the published license event in the result', async () => {
    const result = await uploadWithAutoSelfLicense(/** @type {any} */ (new Blob(['x'])), {
      signer,
      displayName: 'Jane',
      pubkey: signer.pubkey
    });
    expect(result.licenseEvent).toBeDefined();
    expect(result.licenseEvent?.kind).toBe(1063);
  });
});
