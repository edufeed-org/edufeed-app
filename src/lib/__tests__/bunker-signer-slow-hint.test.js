/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { wrapBunkerSigner } from '$lib/stores/accounts.svelte.js';
import { SignerTimeoutError } from '$lib/helpers/signer-wait.js';

afterEach(() => {
  vi.useRealTimers();
});

/** @param {(template: any) => Promise<any>} sign */
const makeSigner = (sign) => ({ getPublicKey: async () => 'pk', signEvent: sign });

describe('wrapBunkerSigner slow-sign hint', () => {
  it('fires onSlow while the bunker is still thinking', async () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();
    const signer = wrapBunkerSigner(
      makeSigner(() => new Promise(() => {})),
      90_000,
      { slowMs: 8000, onSlow }
    );
    signer.signEvent({ kind: 1 }).catch(() => {});
    await vi.advanceTimersByTimeAsync(8000);
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for a prompt answer', async () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();
    const signer = wrapBunkerSigner(
      makeSigner(async () => ({ id: 'x' })),
      90_000,
      { slowMs: 8000, onSlow }
    );
    await signer.signEvent({ kind: 1 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('times out with a SignerTimeoutError (not the "remote app reported" wrapper)', async () => {
    vi.useFakeTimers();
    const signer = wrapBunkerSigner(
      makeSigner(() => new Promise(() => {})),
      1000,
      { slowMs: 500, onSlow: () => {} }
    );
    const caught = signer.signEvent({ kind: 1 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await caught;
    expect(err).toBeInstanceOf(SignerTimeoutError);
  });
});
