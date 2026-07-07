/**
 * Reactive hook for a profile-level NIP-05 trust status.
 *
 * Verifies every address of a profile via the cached `verifyNip05` and
 * aggregates the per-address results with `aggregateNip05Results`:
 * 'verified' as soon as one address checks out, 'pending' while requests are
 * in flight, 'unverified' when all failed or the profile has no address.
 */
import { verifyNip05, aggregateNip05Results } from '$lib/helpers/nip05-verify.js';

/**
 * @param {() => string} getPubkey - reactive getter for the profile pubkey
 * @param {() => string[]} getNip05s - reactive getter for all NIP-05 addresses
 * @returns {() => 'verified' | 'pending' | 'unverified'} reactive status getter
 */
export function useNip05Status(getPubkey, getNip05s) {
  let status = $state(/** @type {'verified' | 'pending' | 'unverified'} */ ('pending'));

  $effect(() => {
    const pubkey = getPubkey();
    const nip05s = getNip05s();

    if (!pubkey || nip05s.length === 0) {
      status = 'unverified';
      return;
    }

    status = 'pending';
    let cancelled = false;
    /** @type {Array<'verified' | 'mismatch' | 'error' | 'pending'>} */
    const results = nip05s.map(() => 'pending');

    nip05s.forEach((nip05, i) => {
      verifyNip05(nip05, pubkey).then((result) => {
        if (cancelled) return;
        results[i] = result;
        status = aggregateNip05Results(results);
      });
    });

    return () => {
      cancelled = true;
    };
  });

  return () => status;
}
