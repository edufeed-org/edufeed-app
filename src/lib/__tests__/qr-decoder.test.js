// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { createQrDecoder } from '$lib/helpers/qr-decoder.js';

const frame = { data: new Uint8ClampedArray(4), width: 1, height: 1 };

/** A stand-in for the browser's BarcodeDetector constructor. */
function fakeDetectorClass(formats, detect) {
  return class {
    static getSupportedFormats() {
      return Promise.resolve(formats);
    }
    detect = detect;
  };
}

describe('createQrDecoder', () => {
  it('uses the native BarcodeDetector when it can read QR codes', async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: 'nostr:npub1abc' }]);
    const loadJsQr = vi.fn();
    const decoder = await createQrDecoder({
      BarcodeDetector: fakeDetectorClass(['qr_code', 'ean_13'], detect),
      loadJsQr
    });
    expect(decoder.engine).toBe('native');
    await expect(decoder.decode(frame)).resolves.toBe('nostr:npub1abc');
    expect(detect).toHaveBeenCalledWith(frame);
    expect(loadJsQr).not.toHaveBeenCalled();
  });

  it('answers null for a frame without a code', async () => {
    const decoder = await createQrDecoder({
      BarcodeDetector: fakeDetectorClass(['qr_code'], vi.fn().mockResolvedValue([])),
      loadJsQr: vi.fn()
    });
    await expect(decoder.decode(frame)).resolves.toBeNull();
  });

  it('falls back to jsQR when the browser has no BarcodeDetector', async () => {
    const jsQR = vi.fn().mockReturnValue({ data: 'npub1xyz' });
    const decoder = await createQrDecoder({
      BarcodeDetector: undefined,
      loadJsQr: () => Promise.resolve(jsQR)
    });
    expect(decoder.engine).toBe('jsqr');
    await expect(decoder.decode(frame)).resolves.toBe('npub1xyz');
    expect(jsQR).toHaveBeenCalledWith(frame.data, 1, 1, expect.anything());
  });

  it('falls back to jsQR when the native detector cannot read QR codes', async () => {
    const decoder = await createQrDecoder({
      BarcodeDetector: fakeDetectorClass(['ean_13'], vi.fn()),
      loadJsQr: () => Promise.resolve(vi.fn().mockReturnValue(null))
    });
    expect(decoder.engine).toBe('jsqr');
    await expect(decoder.decode(frame)).resolves.toBeNull();
  });

  it('treats a failing native detect as "no code" instead of throwing', async () => {
    const decoder = await createQrDecoder({
      BarcodeDetector: fakeDetectorClass(['qr_code'], vi.fn().mockRejectedValue(new Error('x'))),
      loadJsQr: vi.fn()
    });
    await expect(decoder.decode(frame)).resolves.toBeNull();
  });
});
