/**
 * Bridge an RxJS observable into a Svelte 5 rune. Same pattern as the app's
 * loader/model hooks: call during component init, read via the returned getter.
 * @template T
 * @param {() => import('rxjs').Observable<T> | undefined} getObservable
 * @param {T} initial
 * @returns {() => T}
 */
export function useObservable(getObservable, initial) {
  let value = $state.raw(initial);
  $effect(() => {
    const observable = getObservable();
    if (!observable) {
      value = initial;
      return;
    }
    const subscription = observable.subscribe((next) => {
      value = next;
    });
    return () => subscription.unsubscribe();
  });
  return () => value;
}
