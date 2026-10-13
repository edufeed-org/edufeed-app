// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  /** @type {Record<string, (file: any) => Promise<any>>} */
  servers: {},
  uploadServers: ['https://blossom.edufeed.org/', 'https://second.example'],
  publicServers: ['https://blossom.primal.net'],
  showToast: vi.fn(),
  markIneligible: vi.fn(),
  constructed: /** @type {string[]} */ ([])
}));

class FakeHTTPError extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
  }
}

vi.mock('blossom-client-sdk', () => ({
  BlossomClient: class {
    constructor(url) {
      this.url = url;
      mocks.constructed.push(url);
    }
    uploadBlob(file) {
      return mocks.servers[this.url](file);
    }
  }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: {} }));
vi.mock('$lib/services/blossom-settings-service.js', () => ({
  getBlossomUploadServers: () => mocks.uploadServers,
  getPublicBlossomServers: () => mocks.publicServers,
  isDefaultBlossomServer: (url) => url === 'https://blossom.edufeed.org/'
}));
vi.mock('$lib/stores/blossom-eligibility.svelte.js', () => ({
  markBlossomIneligible: (...a) => mocks.markIneligible(...a)
}));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: (...a) => mocks.showToast(...a) }));

const { uploadWithFallback, isBlossomAuthDenied } = await import('../blossom-upload.js');

const ok = (url) => async () => ({ url: `${url}abc`, sha256: 'abc', size: 1, type: 'image/png' });
const deny = (status, reason) => async () => {
  throw new FakeHTTPError(status, reason);
};
const signer = { signEvent: async (e) => e };
const file = new Blob(['x'], { type: 'image/png' });
const PUB = 'a'.repeat(64);

describe('isBlossomAuthDenied', () => {
  it('401/403 by status, nested response status, nothing else', () => {
    expect(isBlossomAuthDenied(new FakeHTTPError(401, 'x'))).toBe(true);
    expect(isBlossomAuthDenied(new FakeHTTPError(403, 'x'))).toBe(true);
    expect(isBlossomAuthDenied({ response: { status: 403 } })).toBe(true);
    expect(isBlossomAuthDenied(new FakeHTTPError(413, 'big'))).toBe(false);
    expect(isBlossomAuthDenied(new TypeError('network'))).toBe(false);
    expect(isBlossomAuthDenied(null)).toBe(false);
  });
});

describe('uploadWithFallback', () => {
  beforeEach(() => {
    mocks.servers = {};
    mocks.constructed = [];
    mocks.uploadServers = ['https://blossom.edufeed.org/', 'https://second.example'];
    mocks.showToast.mockReset();
    mocks.markIneligible.mockReset();
  });

  it('uploads to the first server without a toast', async () => {
    mocks.servers['https://blossom.edufeed.org/'] = ok('https://blossom.edufeed.org/');
    const res = await uploadWithFallback(file, { signer, userPubkey: PUB });
    expect(res.serverUrl).toBe('https://blossom.edufeed.org/');
    expect(res.fellBackFrom).toBeNull();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(mocks.markIneligible).not.toHaveBeenCalled();
  });

  it('a refusal by the deployment server falls to the next server and marks ineligible', async () => {
    mocks.servers['https://blossom.edufeed.org/'] = deny(
      401,
      'Pubkey not authorized by any storage rule'
    );
    mocks.servers['https://second.example'] = ok('https://second.example/');
    const res = await uploadWithFallback(file, { signer, userPubkey: PUB });
    expect(res.serverUrl).toBe('https://second.example');
    expect(res.fellBackFrom).toBe('https://blossom.edufeed.org/');
    expect(res.reason).toBe('Pubkey not authorized by any storage rule');
    expect(mocks.markIneligible).toHaveBeenCalledWith(PUB);
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(mocks.showToast.mock.calls[0][0]).toContain('second.example');
    expect(mocks.showToast.mock.calls[0][3].link.href).toBe('/settings#blossom-settings');
  });

  it('two refusals end on the public server', async () => {
    mocks.servers['https://blossom.edufeed.org/'] = deny(403, 'no');
    mocks.servers['https://second.example'] = deny(403, 'no');
    mocks.servers['https://blossom.primal.net'] = ok('https://blossom.primal.net/');
    const res = await uploadWithFallback(file, { signer, userPubkey: PUB });
    expect(res.serverUrl).toBe('https://blossom.primal.net');
    expect(mocks.constructed).toEqual([
      'https://blossom.edufeed.org/',
      'https://second.example',
      'https://blossom.primal.net'
    ]);
  });

  it('refused everywhere → rejects with the last refusal', async () => {
    mocks.servers['https://blossom.edufeed.org/'] = deny(403, 'first');
    mocks.servers['https://second.example'] = deny(403, 'second');
    mocks.servers['https://blossom.primal.net'] = deny(401, 'third');
    await expect(uploadWithFallback(file, { signer, userPubkey: PUB })).rejects.toThrow('third');
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('a non-auth failure is rethrown without trying further servers', async () => {
    mocks.servers['https://blossom.edufeed.org/'] = deny(413, 'too large');
    mocks.servers['https://second.example'] = ok('https://second.example/');
    await expect(uploadWithFallback(file, { signer, userPubkey: PUB })).rejects.toThrow(
      'too large'
    );
    expect(mocks.constructed).toEqual(['https://blossom.edufeed.org/']);
    expect(mocks.markIneligible).not.toHaveBeenCalled();
  });

  it('a refusal by a non-deployment server does not touch eligibility', async () => {
    mocks.uploadServers = ['https://mine.example'];
    mocks.servers['https://mine.example'] = deny(403, 'nope');
    mocks.servers['https://blossom.primal.net'] = ok('https://blossom.primal.net/');
    await uploadWithFallback(file, { signer, userPubkey: PUB });
    expect(mocks.markIneligible).not.toHaveBeenCalled();
  });

  it('silent suppresses the toast; explicit servers are honoured and deduped', async () => {
    mocks.servers['https://x.example'] = deny(401, 'x');
    mocks.servers['https://blossom.primal.net/'] = ok('https://blossom.primal.net/');
    const res = await uploadWithFallback(file, {
      signer,
      userPubkey: PUB,
      servers: ['https://x.example', 'https://blossom.primal.net/'],
      silent: true
    });
    expect(res.serverUrl).toBe('https://blossom.primal.net/');
    expect(mocks.constructed).toEqual(['https://x.example', 'https://blossom.primal.net/']);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});
