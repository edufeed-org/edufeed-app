/** @vitest-environment jsdom */
/**
 * `useChatAttachments` — the upload queue behind every chat composer that
 * attaches files to a relay message (NIP-29 channels, community kind-9 chat):
 * files upload to the user's Blossom server one after another, each URL is
 * handed to the draft, and the NIP-92 imeta data waits in `pending()` until
 * a send that contains the URL goes out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const upload = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/chat-attachment-upload.js', () => ({
  uploadChatAttachment: (/** @type {any[]} */ ...a) => upload(...a)
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: (/** @type {any[]} */ ...a) => toast(...a) }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { blossom: { maxFileSize: 1000 } }
}));

import { useChatAttachments, appendUrlToDraft } from '$lib/stores/chat-attachments.svelte.js';

const signer = {
  getPublicKey: async () => 'a'.repeat(64),
  signEvent: async (/** @type {any} */ e) => e
};
const user = { pubkey: 'a'.repeat(64), signer };

/** @param {string} name @param {number} [size] */
function file(name, size = 10) {
  return new File([new Uint8Array(size)], name, { type: 'image/png' });
}

beforeEach(() => {
  upload.mockReset();
  toast.mockReset();
  upload.mockImplementation(async (/** @type {File} */ f) => ({
    url: `https://blossom.example/${f.name}`,
    type: f.type,
    sha256: 'f'.repeat(64),
    size: f.size,
    name: f.name
  }));
});

describe('useChatAttachments', () => {
  it('uploads files one after another and hands each URL to the draft in order', async () => {
    const att = useChatAttachments(() => user);
    /** @type {string[]} */
    const urls = [];
    /** @type {string[]} */
    const order = [];
    upload.mockImplementation(async (/** @type {File} */ f) => {
      order.push(`start ${f.name}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end ${f.name}`);
      return {
        url: `https://blossom.example/${f.name}`,
        type: f.type,
        sha256: 'f'.repeat(64),
        size: f.size,
        name: f.name
      };
    });
    const done = att.attach([file('a.png'), file('b.png')], (url) => urls.push(url));
    flushSync();
    expect(att.uploading).toBe(true);
    await done;
    expect(att.uploading).toBe(false);
    expect(urls).toEqual(['https://blossom.example/a.png', 'https://blossom.example/b.png']);
    expect(order).toEqual(['start a.png', 'end a.png', 'start b.png', 'end b.png']);
  });

  it('skips a file over the Blossom size limit with a toast and still uploads the rest', async () => {
    const att = useChatAttachments(() => user);
    /** @type {string[]} */
    const urls = [];
    await att.attach([file('big.png', 5000), file('ok.png')], (url) => urls.push(url));
    expect(urls).toEqual(['https://blossom.example/ok.png']);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][1]).toBe('error');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('reports a failed upload with a toast and finishes the batch', async () => {
    const att = useChatAttachments(() => user);
    upload.mockRejectedValueOnce(new Error('boom'));
    /** @type {string[]} */
    const urls = [];
    await att.attach([file('a.png'), file('b.png')], (url) => urls.push(url));
    expect(urls).toEqual(['https://blossom.example/b.png']);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(att.uploading).toBe(false);
  });

  it('uploads nothing without a signer', async () => {
    const att = useChatAttachments(() => null);
    const onUrl = vi.fn();
    await att.attach([file('a.png')], onUrl);
    expect(upload).not.toHaveBeenCalled();
    expect(onUrl).not.toHaveBeenCalled();
  });

  it('keeps uploaded attachments pending until a send carries their URL', async () => {
    const att = useChatAttachments(() => user);
    await att.attach([file('a.png'), file('b.png')], () => {});
    expect(att.pending().map((a) => a.url)).toEqual([
      'https://blossom.example/a.png',
      'https://blossom.example/b.png'
    ]);
    att.markSent('look https://blossom.example/a.png');
    expect(att.pending().map((a) => a.url)).toEqual(['https://blossom.example/b.png']);
  });
});

describe('appendUrlToDraft', () => {
  it('puts the URL on its own after existing text, or alone in an empty draft', () => {
    expect(appendUrlToDraft('', 'https://x/a.png')).toBe('https://x/a.png');
    expect(appendUrlToDraft('hi  ', 'https://x/a.png')).toBe('hi https://x/a.png');
  });
});
