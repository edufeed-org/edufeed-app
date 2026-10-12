// @ts-nocheck
/** @vitest-environment node */
/**
 * resubscribing() — a standing relay subscription that comes back after the
 * pool gives up: reopened after a delay that doubles up to a cap and resets
 * once events flow again; stopping cancels everything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { resubscribing } from '$lib/groups/relay-subscription.js';

describe('resubscribing', () => {
  let streams;
  let open;
  beforeEach(() => {
    vi.useFakeTimers();
    streams = [];
    open = vi.fn(() => {
      const s = new Subject();
      streams.push(s);
      return s;
    });
  });
  afterEach(() => vi.useRealTimers());

  it('passes events through and reopens after an error, 5 s then doubling to 60 s', () => {
    const next = vi.fn();
    resubscribing(open, { next });
    expect(open).toHaveBeenCalledTimes(1);
    streams[0].next({ kind: 1 });
    expect(next).toHaveBeenCalledWith({ kind: 1 });
    streams[0].error(new Error('closed'));
    vi.advanceTimersByTime(4_999);
    expect(open).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledTimes(2);
    streams[1].error(new Error('closed'));
    vi.advanceTimersByTime(10_000);
    expect(open).toHaveBeenCalledTimes(3);
    streams[2].error(new Error('closed'));
    vi.advanceTimersByTime(20_000);
    expect(open).toHaveBeenCalledTimes(4);
    streams[3].error(new Error('closed'));
    vi.advanceTimersByTime(40_000);
    expect(open).toHaveBeenCalledTimes(5);
    streams[4].error(new Error('closed'));
    vi.advanceTimersByTime(60_000);
    expect(open).toHaveBeenCalledTimes(6);
    streams[5].error(new Error('closed'));
    vi.advanceTimersByTime(60_000);
    expect(open).toHaveBeenCalledTimes(7);
  });

  it('an event on a reopened subscription resets the delay', () => {
    resubscribing(open, { next: () => {} });
    streams[0].error(new Error('closed'));
    vi.advanceTimersByTime(5_000);
    streams[1].error(new Error('closed'));
    vi.advanceTimersByTime(10_000);
    expect(open).toHaveBeenCalledTimes(3);
    streams[2].next({ kind: 1 });
    streams[2].error(new Error('closed'));
    vi.advanceTimersByTime(5_000);
    expect(open).toHaveBeenCalledTimes(4);
  });

  it('reports the error to the caller and treats a completed stream like an error', () => {
    const error = vi.fn();
    resubscribing(open, { next: () => {}, error });
    streams[0].error(new Error('closed'));
    expect(error).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    streams[1].complete();
    vi.advanceTimersByTime(10_000);
    expect(open).toHaveBeenCalledTimes(3);
  });

  it('stop unsubscribes and cancels a pending reopen', () => {
    const stop = resubscribing(open, { next: () => {} });
    expect(streams[0].observed).toBe(true);
    streams[0].error(new Error('closed'));
    stop();
    vi.advanceTimersByTime(60_000);
    expect(open).toHaveBeenCalledTimes(1);
    const stop2 = resubscribing(open, { next: () => {} });
    stop2();
    expect(streams[1].observed).toBe(false);
  });

  it('EOSE markers pass through without resetting the delay', () => {
    const next = vi.fn();
    resubscribing(open, { next });
    streams[0].error(new Error('closed'));
    vi.advanceTimersByTime(5_000);
    streams[1].next('EOSE');
    expect(next).toHaveBeenCalledWith('EOSE');
    streams[1].error(new Error('closed'));
    vi.advanceTimersByTime(5_000);
    expect(open).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5_000);
    expect(open).toHaveBeenCalledTimes(3);
  });
});
