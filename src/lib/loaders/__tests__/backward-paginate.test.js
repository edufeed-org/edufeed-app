/**
 * backwardPaginateRelay Tests
 *
 * The helper walks a single relay backward through `created_at` in fixed-size
 * pages until either the relay is exhausted (a page returns < pageSize events)
 * or maxRounds is reached. This guarantees authors with older `created_at`
 * surface even when a newer bulk-dump saturates the first page.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';
import { toArray } from 'rxjs/operators';

/**
 * Each call to timedPool returns a fresh Subject. The test drives it manually
 * (next/complete) so we can assert on filter shape, ordering, and round count.
 *
 * @type {Array<{ relays: string[], filter: any, subject: Subject<any> }>}
 */
let calls;

vi.mock('../base.js', () => ({
  timedPool: vi.fn((relays, filter) => {
    const subject = new Subject();
    calls.push({ relays, filter, subject });
    return subject.asObservable();
  })
}));

const { backwardPaginateRelay } = await import('../backward-paginate.js');

/**
 * Build n fake events with descending created_at starting at `from`.
 * @param {number} n
 * @param {number} from
 */
function makeEvents(n, from) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${from - i}`,
    created_at: from - i,
    kind: 31923,
    pubkey: 'deadbeef'.repeat(8),
    tags: [],
    content: '',
    sig: ''
  }));
}

/**
 * Synchronously emit an array of events on a subject and complete it.
 * @param {Subject<any>} subject
 * @param {any[]} events
 */
function emit(subject, events) {
  for (const e of events) subject.next(e);
  subject.complete();
}

describe('backwardPaginateRelay', () => {
  beforeEach(() => {
    calls = [];
  });

  it('completes after one round when the page returns fewer than pageSize events', async () => {
    const baseFilter = { kinds: [31923] };
    const collected = backwardPaginateRelay('wss://r.example', baseFilter, {
      pageSize: 100,
      maxRounds: 10
    })
      .pipe(toArray())
      .toPromise();

    // Drive: relay returns 50 events (< pageSize) → exhausted.
    expect(calls).toHaveLength(1);
    expect(calls[0].filter).toEqual({ kinds: [31923], limit: 100 });
    expect(calls[0].filter.until).toBeUndefined();
    emit(calls[0].subject, makeEvents(50, 1000));

    const result = await collected;
    expect(result).toHaveLength(50);
    expect(calls).toHaveLength(1); // No second round.
  });

  it('issues a second round with until=oldest-1 when the first round is full', async () => {
    const baseFilter = { kinds: [31923] };
    const collected = backwardPaginateRelay('wss://r.example', baseFilter, {
      pageSize: 5,
      maxRounds: 10
    })
      .pipe(toArray())
      .toPromise();

    // Round 1: 5 events with created_at 1000..996.
    expect(calls).toHaveLength(1);
    expect(calls[0].filter.limit).toBe(5);
    expect(calls[0].filter.until).toBeUndefined();
    emit(calls[0].subject, makeEvents(5, 1000));

    // Round 2: should request until = 996 - 1 = 995.
    expect(calls).toHaveLength(2);
    expect(calls[1].filter.until).toBe(995);
    expect(calls[1].filter.limit).toBe(5);

    // Round 2 returns 0 events → exhausted.
    calls[1].subject.complete();

    const result = await collected;
    expect(result).toHaveLength(5);
    expect(calls).toHaveLength(2);
  });

  it('stops after maxRounds even if every page is full', async () => {
    const baseFilter = { kinds: [31923] };
    const collected = backwardPaginateRelay('wss://r.example', baseFilter, {
      pageSize: 3,
      maxRounds: 4
    })
      .pipe(toArray())
      .toPromise();

    // Always emit 3 events so pagination keeps going until maxRounds=4.
    let cursor = 1000;
    for (let i = 0; i < 4; i++) {
      // Wait for the round to start.
      expect(calls).toHaveLength(i + 1);
      const batch = makeEvents(3, cursor);
      cursor = batch[batch.length - 1].created_at - 1;
      emit(calls[i].subject, batch);
    }

    const result = await collected;
    expect(result).toHaveLength(12);
    expect(calls).toHaveLength(4); // Capped at maxRounds.
  });

  it('preserves the baseFilter on every round (kinds, authors, etc.)', async () => {
    const baseFilter = { kinds: [31922, 31923], authors: ['abcd'] };
    const collected = backwardPaginateRelay('wss://r.example', baseFilter, {
      pageSize: 2,
      maxRounds: 3
    })
      .pipe(toArray())
      .toPromise();

    emit(calls[0].subject, makeEvents(2, 1000));
    emit(calls[1].subject, makeEvents(2, 800));
    calls[2].subject.complete();

    await collected;

    for (const c of calls) {
      expect(c.filter.kinds).toEqual([31922, 31923]);
      expect(c.filter.authors).toEqual(['abcd']);
    }
  });

  it('tears down the in-flight inner subscription on cancellation', async () => {
    const baseFilter = { kinds: [31923] };
    const sub = backwardPaginateRelay('wss://r.example', baseFilter, {
      pageSize: 5,
      maxRounds: 10
    }).subscribe();

    expect(calls).toHaveLength(1);
    // The inner Subject should currently have an observer.
    expect(calls[0].subject.observed).toBe(true);

    sub.unsubscribe();

    // After cancellation the inner sub is unsubscribed and no more rounds start.
    expect(calls[0].subject.observed).toBe(false);

    // Even if we now complete the original subject, no new round is issued.
    emit(calls[0].subject, makeEvents(5, 1000));
    expect(calls).toHaveLength(1);
  });

  it('uses default pageSize=100 and maxRounds=10 when opts omitted', async () => {
    backwardPaginateRelay('wss://r.example', { kinds: [31923] }).subscribe();
    expect(calls).toHaveLength(1);
    expect(calls[0].filter.limit).toBe(100);
  });
});
