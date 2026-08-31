/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { watchAccountRemovals } from '$lib/concord/account-removal-watcher.js';

/** @param {{id: string, pubkey: string}[]} initial */
function makeManagerMock(initial) {
  const accounts$ = new BehaviorSubject(initial);
  return {
    accounts$,
    getAccounts: () => accounts$.value,
    /** @param {{id: string, pubkey: string}[]} next */
    emit: (next) => accounts$.next(next)
  };
}

const alice = { id: 'acct-a', pubkey: 'pk-alice' };
const bob = { id: 'acct-b', pubkey: 'pk-bob' };
// Same pubkey as alice under a different account instance (extension + bunker)
const aliceBunker = { id: 'acct-a2', pubkey: 'pk-alice' };

describe('watchAccountRemovals', () => {
  it('wipes the pubkey of a removed account', () => {
    const mock = makeManagerMock([alice, bob]);
    const wipe = vi.fn().mockResolvedValue(undefined);
    const sub = watchAccountRemovals({ ...mock, wipe });

    mock.emit([bob]); // alice removed

    expect(wipe).toHaveBeenCalledTimes(1);
    expect(wipe).toHaveBeenCalledWith('pk-alice');
    sub.unsubscribe();
  });

  it('does not wipe on the initial BehaviorSubject replay', () => {
    const mock = makeManagerMock([alice, bob]);
    const wipe = vi.fn().mockResolvedValue(undefined);
    // BehaviorSubject replays [alice, bob] on subscribe — equals the
    // pre-subscribe snapshot, so the diff must be empty.
    const sub = watchAccountRemovals({ ...mock, wipe });

    expect(wipe).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('does not wipe when the accounts list is unchanged (account switch)', () => {
    const mock = makeManagerMock([alice, bob]);
    const wipe = vi.fn().mockResolvedValue(undefined);
    const sub = watchAccountRemovals({ ...mock, wipe });

    // Switching active$ never touches accounts$; even a spurious re-emit of
    // the same membership (new array identity) must not trigger a wipe.
    mock.emit([alice, bob]);
    mock.emit([{ ...alice }, { ...bob }]);

    expect(wipe).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('does not wipe when the pubkey survives under another account instance', () => {
    const mock = makeManagerMock([alice, aliceBunker]);
    const wipe = vi.fn().mockResolvedValue(undefined);
    const sub = watchAccountRemovals({ ...mock, wipe });

    mock.emit([aliceBunker]); // acct-a removed, but pk-alice still logged in

    expect(wipe).not.toHaveBeenCalled();

    mock.emit([]); // last instance of pk-alice gone → now wipe
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(wipe).toHaveBeenCalledWith('pk-alice');
    sub.unsubscribe();
  });

  it('wipes once per pubkey on sequential logout-all removals', () => {
    const mock = makeManagerMock([alice, bob]);
    const wipe = vi.fn().mockResolvedValue(undefined);
    const sub = watchAccountRemovals({ ...mock, wipe });

    // "Logout all" removes accounts one by one → one accounts$ emission each
    mock.emit([bob]);
    mock.emit([]);

    expect(wipe).toHaveBeenCalledTimes(2);
    expect(wipe).toHaveBeenNthCalledWith(1, 'pk-alice');
    expect(wipe).toHaveBeenNthCalledWith(2, 'pk-bob');
    sub.unsubscribe();
  });

  it('logs instead of throwing when the wipe rejects', async () => {
    const mock = makeManagerMock([alice]);
    const wipe = vi.fn().mockRejectedValue(new Error('idb boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sub = watchAccountRemovals({ ...mock, wipe });

    expect(() => mock.emit([])).not.toThrow();
    await Promise.resolve(); // let the rejection handler run
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(
      'concord: failed to wipe local data on logout',
      expect.any(Error)
    );
    errorSpy.mockRestore();
    sub.unsubscribe();
  });

  it('stops reacting after unsubscribe', () => {
    const mock = makeManagerMock([alice]);
    const wipe = vi.fn().mockResolvedValue(undefined);
    const sub = watchAccountRemovals({ ...mock, wipe });

    sub.unsubscribe();
    mock.emit([]);

    expect(wipe).not.toHaveBeenCalled();
  });
});
