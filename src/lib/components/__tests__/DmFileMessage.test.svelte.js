// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * A kind-15 bubble: fetch the encrypted blob, decrypt it in the browser, show
 * an image inline or a download affordance. Failures must be visible, never a
 * blank bubble — the whole point of this work is that messages stop vanishing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  dm_file_decrypting: () => 'Decrypting…',
  dm_file_failed: () => 'File could not be decrypted',
  dm_file_download: () => 'Download',
  dm_file_image_alt: () => 'Image sent in this conversation'
}));
const decryptFileBytes = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/dm-file-crypto.js', () => ({
  decryptFileBytes,
  SUPPORTED_FILE_ALGORITHMS: ['aes-gcm']
}));

import DmFileMessage from '$lib/components/dm/DmFileMessage.svelte';

const rumor = (mime = 'image/png') => ({
  id: 'r1',
  kind: 15,
  content: 'https://blossom.example/a.bin',
  tags: [
    ['file-type', mime],
    ['encryption-algorithm', 'aes-gcm'],
    ['decryption-key', 'ab'.repeat(16)],
    ['decryption-nonce', 'cd'.repeat(6)],
    ['size', '1024']
  ]
});

// A second, distinct rumor — different URL and key — used to prove the
// effect tears down the previous fetch/decrypt when the prop changes.
const rumorB = (mime = 'image/png') => ({
  id: 'r2',
  kind: 15,
  content: 'https://blossom.example/b.bin',
  tags: [
    ['file-type', mime],
    ['encryption-algorithm', 'aes-gcm'],
    ['decryption-key', 'ef'.repeat(16)],
    ['decryption-nonce', 'cd'.repeat(6)],
    ['size', '2048']
  ]
});

beforeEach(() => {
  decryptFileBytes.mockReset();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(8)
  });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('DmFileMessage', () => {
  it('shows a spinner, then the decrypted image', async () => {
    decryptFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    render(DmFileMessage, { props: { rumor: rumor('image/png') } });
    expect(screen.getByTestId('dm-file-loading')).toBeTruthy();
    const img = await screen.findByTestId('dm-file-image');
    expect(img.getAttribute('src')).toBe('blob:fake');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://blossom.example/a.bin',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('offers a download for a non-image type', async () => {
    decryptFileBytes.mockResolvedValue(new Uint8Array([1]));
    render(DmFileMessage, { props: { rumor: rumor('application/pdf') } });
    const link = await screen.findByTestId('dm-file-download');
    expect(link.getAttribute('href')).toBe('blob:fake');
    expect(link.getAttribute('download')).toBeTruthy();
  });

  it('says so when decryption fails instead of rendering nothing', async () => {
    decryptFileBytes.mockRejectedValue(new Error('invalid MAC'));
    render(DmFileMessage, { props: { rumor: rumor() } });
    expect((await screen.findByTestId('dm-file-error')).textContent).toContain(
      'File could not be decrypted'
    );
  });

  it('says so when the download fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    render(DmFileMessage, { props: { rumor: rumor() } });
    expect(await screen.findByTestId('dm-file-error')).toBeTruthy();
  });

  it('reports an unusable rumor without calling the network', async () => {
    render(DmFileMessage, { props: { rumor: { ...rumor(), content: 'javascript:alert(1)' } } });
    expect(await screen.findByTestId('dm-file-error')).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('revokes the object URL on unmount', async () => {
    decryptFileBytes.mockResolvedValue(new Uint8Array([1]));
    const { unmount } = render(DmFileMessage, { props: { rumor: rumor() } });
    await screen.findByTestId('dm-file-image');
    unmount();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('revokes the previous object URL when the rumor prop changes', async () => {
    let counter = 0;
    globalThis.URL.createObjectURL = vi.fn(() => `blob:fake-${++counter}`);
    decryptFileBytes.mockResolvedValue(new Uint8Array([1]));

    const { rerender } = render(DmFileMessage, { props: { rumor: rumor('image/png') } });
    const imgA = await screen.findByTestId('dm-file-image');
    expect(imgA.getAttribute('src')).toBe('blob:fake-1');

    await rerender({ rumor: rumorB('image/png') });
    const imgB = await screen.findByTestId('dm-file-image');
    expect(imgB.getAttribute('src')).toBe('blob:fake-2');
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
  });

  it('does not let a stale rumor resolve after a newer one and overwrite its state', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:b');
    let resolveA;
    const deferredA = new Promise((resolve) => {
      resolveA = resolve;
    });
    // First decryptFileBytes call (for rumor A) hangs; second (for rumor B) resolves immediately.
    decryptFileBytes.mockImplementationOnce(() => deferredA);
    decryptFileBytes.mockImplementationOnce(() => Promise.resolve(new Uint8Array([2])));

    const { rerender } = render(DmFileMessage, { props: { rumor: rumor('image/png') } });
    expect(screen.getByTestId('dm-file-loading')).toBeTruthy();

    await rerender({ rumor: rumorB('image/png') });
    const img = await screen.findByTestId('dm-file-image');
    expect(img.getAttribute('src')).toBe('blob:b');
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);

    // Let rumor A's stale decrypt resolve after the fact — it must not repaint
    // over rumor B's already-rendered state, nor create a dangling object URL.
    resolveA(new Uint8Array([1]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByTestId('dm-file-image').getAttribute('src')).toBe('blob:b');
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  // The URL comes out of an unsigned rumor, so the fetch is bounded: cancelled
  // on teardown, capped at 25 MB, and the Blob never carries an attacker MIME
  // unless it is an image we render inline.
  describe('untrusted-URL hardening', () => {
    const MAX = 25 * 1024 * 1024;

    it('aborts the in-flight fetch when the component unmounts', async () => {
      /** @type {AbortSignal | undefined} */
      let signal;
      globalThis.fetch = vi.fn((_url, init) => {
        signal = init?.signal;
        return new Promise(() => {}); // never settles
      });
      const { unmount } = render(DmFileMessage, { props: { rumor: rumor() } });
      expect(signal?.aborted).toBe(false);
      unmount();
      expect(signal?.aborted).toBe(true);
    });

    it('refuses a file whose Content-Length is over the cap, before reading the body', async () => {
      const arrayBuffer = vi.fn(async () => new ArrayBuffer(8));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => String(MAX + 1) },
        arrayBuffer
      });
      render(DmFileMessage, { props: { rumor: rumor() } });
      expect(await screen.findByTestId('dm-file-error')).toBeTruthy();
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(decryptFileBytes).not.toHaveBeenCalled();
    });

    it('refuses a lying Content-Length: the received body is capped too', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => '10' },
        arrayBuffer: async () => new ArrayBuffer(MAX + 1)
      });
      render(DmFileMessage, { props: { rumor: rumor() } });
      expect(await screen.findByTestId('dm-file-error')).toBeTruthy();
      expect(decryptFileBytes).not.toHaveBeenCalled();
    });

    it('gives the download Blob application/octet-stream, not the rumor MIME', async () => {
      /** @type {Blob | undefined} */
      let blob;
      globalThis.URL.createObjectURL = vi.fn((b) => {
        blob = b;
        return 'blob:fake';
      });
      decryptFileBytes.mockResolvedValue(new Uint8Array([1]));
      render(DmFileMessage, { props: { rumor: rumor('text/html') } });
      await screen.findByTestId('dm-file-download');
      expect(blob?.type).toBe('application/octet-stream');
    });

    it('keeps the real MIME only for the inline image', async () => {
      /** @type {Blob | undefined} */
      let blob;
      globalThis.URL.createObjectURL = vi.fn((b) => {
        blob = b;
        return 'blob:fake';
      });
      decryptFileBytes.mockResolvedValue(new Uint8Array([1]));
      render(DmFileMessage, { props: { rumor: rumor('image/png') } });
      await screen.findByTestId('dm-file-image');
      expect(blob?.type).toBe('image/png');
    });
  });

  describe('alt text', () => {
    it('uses the rumor alt tag when present', async () => {
      decryptFileBytes.mockResolvedValue(new Uint8Array([1]));
      const withAlt = rumor('image/png');
      withAlt.tags.push(['alt', 'a hand-drawn map']);
      render(DmFileMessage, { props: { rumor: withAlt } });
      expect((await screen.findByTestId('dm-file-image')).getAttribute('alt')).toBe(
        'a hand-drawn map'
      );
    });

    it('falls back to a translated generic string', async () => {
      decryptFileBytes.mockResolvedValue(new Uint8Array([1]));
      render(DmFileMessage, { props: { rumor: rumor('image/png') } });
      expect((await screen.findByTestId('dm-file-image')).getAttribute('alt')).toBe(
        'Image sent in this conversation'
      );
    });
  });
});
