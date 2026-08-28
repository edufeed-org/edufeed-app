/** @vitest-environment node */
// A tiny FIFO async mutex. cordn's client reads MLS state, awaits a network
// RPC, then writes the derived state back; the 3s poll does the same. Without
// serialization, a poll that ingests a Commit during send()'s await is
// clobbered when send resumes and writes its pre-Commit epoch — permanent
// group desync. This lock makes each such section run to completion before
// the next starts.
import { describe, it, expect } from 'vitest';
import { AsyncMutex } from '$lib/helpers/async-mutex.js';

describe('AsyncMutex', () => {
  it('runs sections one at a time, in the order they were requested', async () => {
    const mutex = new AsyncMutex();
    /** @type {string[]} */
    const log = [];
    const gate = /** @type {((value?: unknown) => void)[]} */ ([]);
    const blockOn = () => new Promise((resolve) => gate.push(resolve));

    const a = mutex.run(async () => {
      log.push('a:start');
      await blockOn();
      log.push('a:end');
    });
    const b = mutex.run(async () => {
      log.push('b:start');
      log.push('b:end');
    });

    // b must not have started while a holds the lock.
    await Promise.resolve();
    expect(log).toEqual(['a:start']);

    gate[0](); // release a
    await Promise.all([a, b]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('releases the lock even when a section throws, and surfaces the error', async () => {
    const mutex = new AsyncMutex();
    await expect(
      mutex.run(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // The lock is free: the next section runs.
    await expect(mutex.run(async () => 42)).resolves.toBe(42);
  });

  it('returns the section’s resolved value', async () => {
    const mutex = new AsyncMutex();
    await expect(mutex.run(async () => 'ok')).resolves.toBe('ok');
  });
});
