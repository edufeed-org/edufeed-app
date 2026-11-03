// @ts-nocheck
/**
 * QrScanner — rear camera → decoder loop → `onResult`, with a picked-image
 * fallback when there is no camera to be had (issue 9f7816e3).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  decode: vi.fn(),
  grabVideoFrame: vi.fn(),
  imageFileToImageData: vi.fn(),
  getUserMedia: vi.fn(),
  stop: vi.fn()
}));
vi.mock('$lib/helpers/qr-decoder.js', () => ({
  createQrDecoder: vi.fn(async () => ({ engine: 'native', decode: h.decode })),
  grabVideoFrame: h.grabVideoFrame,
  imageFileToImageData: h.imageFileToImageData
}));

import QrScanner from '../profile/QrScanner.svelte';

const FRAME = { data: new Uint8ClampedArray(4), width: 1, height: 1 };

beforeEach(() => {
  h.decode.mockReset();
  h.grabVideoFrame.mockReset().mockReturnValue(FRAME);
  h.imageFileToImageData.mockReset().mockResolvedValue(FRAME);
  h.stop.mockReset();
  h.getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop: h.stop }] });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: h.getUserMedia },
    configurable: true
  });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  delete navigator.mediaDevices;
});

function renderScanner(onResult = vi.fn(() => true)) {
  const onCancel = vi.fn();
  const utils = render(QrScanner, { onResult, onCancel, intervalMs: 0 });
  return { onResult, onCancel, ...utils };
}

describe('<QrScanner>', () => {
  it('asks for the rear camera, hands the first code to onResult and stops once it is handled', async () => {
    h.decode.mockResolvedValue('nostr:npub1abc');
    const { onResult } = renderScanner();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('nostr:npub1abc'));
    expect(h.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ facingMode: 'environment' }) })
    );
    await waitFor(() => expect(h.stop).toHaveBeenCalled());
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('keeps scanning after a rejected code and does not report the same code twice in a row', async () => {
    h.decode.mockResolvedValueOnce('junk').mockResolvedValueOnce('junk').mockResolvedValue('good');
    const onResult = vi.fn((text) => text === 'good');
    renderScanner(onResult);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('good'));
    expect(onResult.mock.calls.map(([t]) => t)).toEqual(['junk', 'good']);
  });

  it('explains a refused camera and offers the picture fallback', async () => {
    const err = new Error('nope');
    err.name = 'NotAllowedError';
    h.getUserMedia.mockRejectedValue(err);
    const { findByTestId } = renderScanner();
    const notice = await findByTestId('qr-scanner-error');
    expect(notice.textContent).toMatch(/Kamera|camera/i);
    expect(await findByTestId('qr-scanner-file')).toBeTruthy();
  });

  it('decodes a picked image', async () => {
    h.getUserMedia.mockRejectedValue(Object.assign(new Error(), { name: 'NotFoundError' }));
    h.decode.mockResolvedValue('npub1frompicture');
    const { onResult, findByTestId } = renderScanner();
    const input = await findByTestId('qr-scanner-file');
    const file = new File(['x'], 'code.png', { type: 'image/png' });
    await fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('npub1frompicture'));
    expect(h.imageFileToImageData).toHaveBeenCalledWith(file, expect.anything());
  });

  it('releases the camera when unmounted', async () => {
    h.decode.mockResolvedValue(null);
    const { unmount } = renderScanner();
    await waitFor(() => expect(h.getUserMedia).toHaveBeenCalled());
    await waitFor(() => expect(h.grabVideoFrame).toHaveBeenCalled());
    unmount();
    expect(h.stop).toHaveBeenCalled();
  });
});
