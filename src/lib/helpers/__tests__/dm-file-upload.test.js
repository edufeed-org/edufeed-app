/** @vitest-environment jsdom */
/**
 * `uploadEncryptedDmFile` — the send side of NIP-17 kind-15 file messages:
 * the file is AES-GCM encrypted in the browser and ONLY the ciphertext goes
 * to the user's Blossom server, as an opaque octet stream. What comes back is
 * exactly what `SendWrappedFile` needs for the rumor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploaded: /** @type {Blob | null} */ (null),
  uploadResult: /** @type {any} */ ({}),
  getActiveBlossomServer: vi.fn(() => 'https://blossom.example')
}));

vi.mock('blossom-client-sdk', () => ({
  BlossomClient: class {
    constructor() {}
    /** @param {Blob} blob */
    async uploadBlob(blob) {
      mocks.uploaded = blob;
      return { ...mocks.uploadResult, size: blob.size };
    }
  }
}));
vi.mock('$lib/services/blossom-settings-service.js', () => ({
  getActiveBlossomServer: mocks.getActiveBlossomServer
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: { add: () => {} } }));

const { uploadEncryptedDmFile } = await import('../dm-file-upload.js');
const { decryptFileBytes } = await import('../dm-file-crypto.js');

const PUB = 'b'.repeat(64);
const HASH = 'c'.repeat(64);
const signer = {
  getPublicKey: vi.fn(async () => PUB),
  signEvent: vi.fn(async (/** @type {any} */ t) => t)
};

beforeEach(() => {
  mocks.uploaded = null;
  mocks.uploadResult = {
    url: `https://blossom.example/${HASH}`,
    sha256: HASH,
    type: 'application/octet-stream'
  };
  mocks.getActiveBlossomServer.mockClear();
});

describe('uploadEncryptedDmFile', () => {
  it('uploads only ciphertext, as an opaque blob, and returns the material to decrypt it', async () => {
    const file = new File(['a pasted screenshot'], 'shot.png', { type: 'image/png' });
    const info = await uploadEncryptedDmFile(file, { signer });

    expect(mocks.uploaded).toBeInstanceOf(Blob);
    const blob = /** @type {Blob} */ (mocks.uploaded);
    expect(blob.type).toBe('application/octet-stream');
    const sent = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(sent)).not.toContain('pasted');
    const plain = await decryptFileBytes(sent, info);
    expect(new TextDecoder().decode(plain)).toBe('a pasted screenshot');

    expect(info).toMatchObject({
      url: `https://blossom.example/${HASH}`,
      fileType: 'image/png',
      algorithm: 'aes-gcm',
      hash: HASH,
      size: sent.byteLength,
      name: 'shot.png'
    });
    expect(info.key).toMatch(/^[0-9a-f]{64}$/);
    expect(info.nonce).toMatch(/^[0-9a-f]{24}$/);
  });

  it('picks the Blossom server by the signer pubkey and keeps the URL extension-less', async () => {
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    const info = await uploadEncryptedDmFile(file, { signer });
    expect(mocks.getActiveBlossomServer).toHaveBeenCalledWith(PUB, expect.anything());
    // The receiver fetches and decrypts by hash; a `.pdf` suffix would only
    // invite the host to serve ciphertext as a document.
    expect(info.url).toBe(`https://blossom.example/${HASH}`);
  });

  it('falls back to application/octet-stream for a file without a type', async () => {
    const file = new File(['x'], 'blob');
    const info = await uploadEncryptedDmFile(file, { signer });
    expect(info.fileType).toBe('application/octet-stream');
  });
});
