// jsdom 27 lacks Blob.prototype.arrayBuffer and crypto.subtle, so this test
// runs in node where both Web Crypto and Blob are natively available.
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../sha256.js';

describe('sha256Hex', () => {
  it('returns the canonical SHA-256 hex of "abc"', async () => {
    // Known vector: SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const blob = new Blob(['abc'], { type: 'text/plain' });
    const hex = await sha256Hex(blob);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('returns 64 hex characters for the empty blob', async () => {
    const blob = new Blob([]);
    const hex = await sha256Hex(blob);
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('handles binary blobs', async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x10, 0x20]);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const hex = await sha256Hex(blob);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
