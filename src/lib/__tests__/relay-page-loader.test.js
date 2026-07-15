/**
 * relay-page-loader tests — page-loading state machine for the relay feed.
 * The wrapped loader observable may never complete, so pages finalize via
 * complete/error or a safety timeout, and in-flight pages can be cancelled.
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject, EMPTY } from 'rxjs';
import { createRelayPageLoader } from '../helpers/relay-page-loader.js';

describe('createRelayPageLoader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Collects onChange calls; returns { pager, changes, settles } */
  function setup(timeout = 4000) {
    /** @type {{loading: boolean, exhausted: boolean, settled: boolean}[]} */
    const changes = [];
    const pager = createRelayPageLoader({
      timeout,
      onChange: (state) => changes.push({ ...state })
    });
    const settles = () => changes.filter((c) => c.settled);
    return { pager, changes, settles };
  }

  it('finalizes via the safety timeout when the observable never completes', () => {
    const { pager, settles } = setup();
    const subject = new Subject();
    pager.loadPage(() => subject.asObservable());

    subject.next({ id: '1' });
    subject.next({ id: '2' });
    subject.next({ id: '3' });
    expect(settles()).toHaveLength(0);

    vi.advanceTimersByTime(4000);
    expect(settles()).toEqual([{ loading: false, exhausted: false, settled: true }]);
    expect(subject.observed).toBe(false); // REQ closed
  });

  it('marks exhausted when a page yields zero events and times out', () => {
    const { pager, settles } = setup();
    const subject = new Subject();
    pager.loadPage(() => subject.asObservable());

    vi.advanceTimersByTime(4000);
    expect(settles()).toEqual([{ loading: false, exhausted: true, settled: true }]);
  });

  it('finalizes immediately on complete; the later timer produces no second settle', () => {
    const { pager, settles } = setup();
    const subject = new Subject();
    pager.loadPage(() => subject.asObservable());

    subject.next({ id: '1' });
    subject.complete();
    expect(settles()).toEqual([{ loading: false, exhausted: false, settled: true }]);

    vi.advanceTimersByTime(10000);
    expect(settles()).toHaveLength(1); // idempotent finalize
  });

  it('no-ops while a page is loading', () => {
    const { pager, changes } = setup();
    const subjectA = new Subject();
    const subjectB = new Subject();
    pager.loadPage(() => subjectA.asObservable());
    const countAfterFirst = changes.length;

    pager.loadPage(() => subjectB.asObservable());
    expect(changes.length).toBe(countAfterFirst); // guard: still loading
    expect(subjectB.observed).toBe(false);
  });

  it('no-ops after exhaustion', () => {
    const { pager, changes } = setup();
    const subjectA = new Subject();
    pager.loadPage(() => subjectA.asObservable());
    vi.advanceTimersByTime(4000); // zero events → exhausted

    const countAfterExhaust = changes.length;
    const subjectB = new Subject();
    pager.loadPage(() => subjectB.asObservable());
    expect(changes.length).toBe(countAfterExhaust);
    expect(subjectB.observed).toBe(false);
  });

  it('no-ops when the loader fn is undefined', () => {
    const { pager, changes } = setup();
    pager.loadPage(undefined);
    expect(changes).toHaveLength(0);
  });

  it('relay switch: reset() unsticks the guard and the stale page cannot settle for the new relay', () => {
    const { pager, settles } = setup();

    // Relay A: page in flight, events already emitted but not settled
    const subjectA = new Subject();
    pager.loadPage(() => subjectA.asObservable());
    subjectA.next({ id: 'a1' });
    subjectA.next({ id: 'a2' });

    // User switches to relay B within the 4s window
    pager.reset();
    expect(subjectA.observed).toBe(false); // A's REQ closed on reset

    // Relay B loads despite A never settling (guard not stuck)
    const subjectB = new Subject();
    pager.loadPage(() => subjectB.asObservable());
    expect(subjectB.observed).toBe(true);

    // Only ONE settle fires — page B's — and exhaustion reflects B's count
    vi.advanceTimersByTime(4000);
    expect(settles()).toEqual([{ loading: false, exhausted: true, settled: true }]);
  });

  it('survives a synchronously-completing observable (settles once, exhausted)', () => {
    const { pager, settles } = setup();
    // EMPTY completes during subscribe(), before sub/timer are assigned
    pager.loadPage(() => EMPTY);
    expect(settles()).toEqual([{ loading: false, exhausted: true, settled: true }]);
    vi.advanceTimersByTime(10000);
    expect(settles()).toHaveLength(1);
  });

  it('cancel() mid-flight clears loading without settling or exhausting', () => {
    const { pager, changes, settles } = setup();
    const subject = new Subject();
    pager.loadPage(() => subject.asObservable());

    pager.cancel();
    const last = changes[changes.length - 1];
    expect(last).toEqual({ loading: false, exhausted: false, settled: false });
    expect(subject.observed).toBe(false);

    // Stale timer must not fire after cancellation
    vi.advanceTimersByTime(10000);
    expect(settles()).toHaveLength(0);
  });
});
