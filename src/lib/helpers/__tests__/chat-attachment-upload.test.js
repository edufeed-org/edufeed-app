/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploadResult: /** @type {any} */ ({
    url: 'https://blossom.example/' + 'a'.repeat(64),
    sha256: 'a'.repeat(64),
    size: 1234,
    type: 'application/pdf'
  }),
  getActiveBlossomServer: vi.fn(() => 'https://blossom.example')
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
  getActiveBlossomServer: mocks.getActiveBlossomServer
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: () => {} }
}));

const { uploadChatAttachment, appendExtensionIfMissing } = await import(
  '../chat-attachment-upload.js'
);

const PUB = 'b'.repeat(64);
const signer = {
  getPublicKey: vi.fn(async () => PUB),
  signEvent: vi.fn(async (/** @type {any} */ t) => t)
};

beforeEach(() => {
  mocks.uploadResult = {
    url: 'https://blossom.example/' + 'a'.repeat(64),
    sha256: 'a'.repeat(64),
    size: 1234,
    type: 'application/pdf'
  };
  mocks.getActiveBlossomServer.mockClear();
  signer.getPublicKey.mockClear();
});

describe('appendExtensionIfMissing', () => {
  it('appends the filename extension to an extension-less blob URL', () => {
    expect(appendExtensionIfMissing('https://b.example/' + 'a'.repeat(64), 'notes.pdf')).toBe(
      'https://b.example/' + 'a'.repeat(64) + '.pdf'
    );
  });

  it('leaves a URL that already has an extension untouched', () => {
    expect(appendExtensionIfMissing('https://b.example/abc.jpg', 'photo.jpg')).toBe(
      'https://b.example/abc.jpg'
    );
  });

  it('leaves the URL untouched when the filename has no extension', () => {
    expect(appendExtensionIfMissing('https://b.example/abc', 'README')).toBe(
      'https://b.example/abc'
    );
  });

  it('returns invalid URLs unchanged', () => {
    expect(appendExtensionIfMissing('not a url', 'x.pdf')).toBe('not a url');
  });
});

describe('uploadChatAttachment', () => {
  const file = () => new File(['x'], 'worksheet.pdf', { type: 'application/pdf' });

  it('returns NIP-94-style fields with the extension appended to the URL', async () => {
    // Blossom URLs are content-addressed and often extension-less; Armada (and
    // our own renderer) detect media by extension, so append it.
    const result = await uploadChatAttachment(file(), { signer });
    expect(result).toEqual({
      url: 'https://blossom.example/' + 'a'.repeat(64) + '.pdf',
      type: 'application/pdf',
      sha256: 'a'.repeat(64),
      size: 1234,
      name: 'worksheet.pdf'
    });
  });

  it('resolves the pubkey via getPublicKey() for blossom server selection', async () => {
    await uploadChatAttachment(file(), { signer });
    expect(signer.getPublicKey).toHaveBeenCalled();
    expect(mocks.getActiveBlossomServer).toHaveBeenCalledWith(PUB, expect.anything());
  });

  it('falls back to the file type and size when the descriptor omits them', async () => {
    mocks.uploadResult = { url: 'https://blossom.example/abc.pdf', sha256: 'c'.repeat(64) };
    const result = await uploadChatAttachment(file(), { signer });
    expect(result.type).toBe('application/pdf');
    expect(result.size).toBe(1);
  });
});
