/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readImageDimensions } from '$lib/helpers/image-dimensions.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readImageDimensions', () => {
  it('returns undefined for non-image files', async () => {
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    expect(await readImageDimensions(file)).toBeUndefined();
  });

  it('reads WxH through createImageBitmap when available', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 640, height: 480, close }))
    );
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    expect(await readImageDimensions(file)).toBe('640x480');
    expect(close).toHaveBeenCalled();
  });

  it('falls back to undefined when neither decoder yields a size', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 0, height: 0 }))
    );
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    expect(await readImageDimensions(file)).toBeUndefined();
  });
});
