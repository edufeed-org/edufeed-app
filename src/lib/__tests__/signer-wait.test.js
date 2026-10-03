/** @vitest-environment node */
/**
 * Remote-signer waits (laoc, 2026-10-03): a phone in energy saver mode holds
 * NIP-46 requests back, so a bunker signature can take minutes or never come.
 * The app can't detect the mode, so it reacts to slowness instead: a hint
 * after a few seconds, a typed timeout error the UI can explain.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$lib/paraglide/messages', () => ({
  signer_slow_hint: () => 'slow',
  signer_slow_hint_mobile: () => 'slow-mobile',
  signer_timeout_hint: () => 'timeout',
  signer_timeout_hint_mobile: () => 'timeout-mobile'
}));

const {
  SignerTimeoutError,
  rejectAfter,
  notifyWhenSlow,
  isLikelyMobile,
  slowSignHintText,
  signerTimeoutText,
  trackSlowSign,
  subscribeSlowSigns
} = await import('$lib/helpers/signer-wait.js');

afterEach(() => {
  vi.useRealTimers();
});

describe('rejectAfter', () => {
  it('rejects with a SignerTimeoutError when the promise never settles', async () => {
    vi.useFakeTimers();
    const p = rejectAfter(new Promise(() => {}), 1000, 'Signing the event');
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await caught;
    expect(err).toBeInstanceOf(SignerTimeoutError);
    expect(err.message).toContain('did not respond');
  });

  it('passes the value through when the promise settles in time', async () => {
    await expect(rejectAfter(Promise.resolve(7), 1000, 'x')).resolves.toBe(7);
  });
});

describe('notifyWhenSlow', () => {
  it('calls onSlow once the promise is still pending after `ms`', async () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();
    notifyWhenSlow(new Promise(() => {}), 8000, onSlow);
    await vi.advanceTimersByTimeAsync(7999);
    expect(onSlow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the promise settles (or fails) first', async () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();
    notifyWhenSlow(Promise.resolve('ok'), 8000, onSlow);
    notifyWhenSlow(Promise.reject(new Error('no')), 8000, onSlow);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onSlow).not.toHaveBeenCalled();
  });
});

describe('isLikelyMobile', () => {
  it.each([
    [{ userAgentData: { mobile: true }, userAgent: '' }, true],
    [{ userAgentData: { mobile: false }, userAgent: 'Android' }, false],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' }, true],
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, true],
    // iPadOS reports a desktop Mac UA, but a Mac has no touch points
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }, true],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }, false],
    [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, false],
    [undefined, false]
  ])('%o → %s', (nav, expected) => {
    expect(isLikelyMobile(/** @type {any} */ (nav))).toBe(expected);
  });
});

describe('hint texts', () => {
  it('mention energy saver mode only on mobile', () => {
    expect(slowSignHintText(true)).toBe('slow-mobile');
    expect(slowSignHintText(false)).toBe('slow');
    expect(signerTimeoutText(true)).toBe('timeout-mobile');
    expect(signerTimeoutText(false)).toBe('timeout');
  });
});

describe('slow sign tracking', () => {
  it('counts a tracked signature until it settles', async () => {
    /** @type {number[]} */
    const seen = [];
    const stop = subscribeSlowSigns((n) => seen.push(n));
    /** @type {(v?: unknown) => void} */
    let finish = () => {};
    const p = new Promise((r) => (finish = r));
    trackSlowSign(p);
    finish();
    await p;
    await Promise.resolve();
    stop();
    expect(seen).toEqual([0, 1, 0]);
  });
});
