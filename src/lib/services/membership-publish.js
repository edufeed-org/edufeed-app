/**
 * Membership application routing and applicant reachability (kind 1069).
 *
 * A membership application carries the applicant's real name, affiliation and
 * motivation. The generic outbox publisher is wrong for it, exactly as it is
 * for gift wraps (see gift-wrap-publish.js): an applicant with no kind 10002
 * falls through to the public fallback relays, so a copy of every application
 * lands on relays nobody chose for it — how 13 applications ended up on
 * nos.lol before 2026-07-28. Publishing a default relay list first does not
 * help either, because the default list IS the fallback list.
 *
 * So applications go to the app-managed communikey relays and nowhere else.
 * That is where both sides already read them from: the admin panel via
 * formResponseLoader and the applicant via useMembershipGrantState, both over
 * getCommunikeyRelays().
 *
 * Reachability is the other half. An approval is answered with a NIP-17 DM, so
 * an applicant without a kind 10050 gets that reply routed to their read relays
 * (again the public fallbacks) instead of their DM inbox. ensureApplicantRelayLists
 * settles both lists before the application goes out.
 *
 * Both backfills publish a *replaceable* event, so each one is gated on proof
 * of absence rather than on an empty answer: a lookup that timed out looks
 * identical to a user with no list, and defaulting on that would overwrite a
 * relay list we simply never received.
 */
import { pool as defaultPool } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { getCommunikeyRelays as defaultGetCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import {
  fetchRelayListResolution as defaultFetchRelayListResolution,
  invalidateRelayListCache as defaultInvalidateRelayListCache
} from '$lib/services/relay-service.svelte.js';
import { publishDefaultRelayList as defaultPublishDefaultRelayList } from '$lib/services/relay-list-backfill.js';
import { ensureDmRelayList as defaultEnsureDmRelayList } from '$lib/services/dm-relay-backfill.js';
import { getDmRelayCheckStatus as defaultGetDmRelayCheckStatus } from '$lib/services/dm-service.svelte.js';

/** Per-relay publish timeout, matching the other publishers. */
const PUBLISH_TIMEOUT_MS = 5000;

/**
 * The relays a membership application may be published to.
 *
 * @param {object} [deps]
 * @param {() => string[]} [deps.getAppRelays]
 * @param {() => string[]} [deps.getCommunikeyRelays]
 * @returns {string[]}
 */
export function getApplicationRelays(deps = {}) {
  const {
    getAppRelays = () => getAppRelaysForCategory('communikey'),
    getCommunikeyRelays = defaultGetCommunikeyRelays
  } = deps;

  const appRelays = [...new Set((getAppRelays() || []).filter(Boolean))];
  if (appRelays.length > 0) return appRelays;

  // A deployment with no dedicated communikey relay has no private place to
  // put applications. Losing every application is worse than the wider reach,
  // so fall back to the same set both sides read from — loudly.
  console.warn(
    '[membership] no communikey relay configured — publishing applications to the fallback relay set'
  );
  return [...new Set((getCommunikeyRelays() || []).filter(Boolean))];
}

/**
 * Publish one signed application copy to the application relays only.
 *
 * @param {import('nostr-tools').NostrEvent} signedEvent
 * @param {object} [deps]
 * @param {any} [deps.pool]
 * @param {() => string[]} [deps.getAppRelays]
 * @param {() => string[]} [deps.getCommunikeyRelays]
 * @returns {Promise<{ success: boolean, relays: string[], successCount: number }>}
 */
export async function publishApplicationCopy(signedEvent, deps = {}) {
  const { pool = defaultPool } = deps;
  const relays = getApplicationRelays(deps);
  if (relays.length === 0) {
    return { success: false, relays: [], successCount: 0 };
  }

  const results = await Promise.allSettled(
    relays.map(async (url) => {
      // relay.publish RESOLVES with {ok:false} on rejection; it only throws on
      // connection/timeout errors.
      const response = await pool.relay(url).publish(signedEvent, { timeout: PUBLISH_TIMEOUT_MS });
      if (response && response.ok === false) {
        console.warn(`[membership] relay ${url} rejected the application:`, response.message);
        return false;
      }
      return true;
    })
  );
  const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { success: successCount > 0, relays, successCount };
}

/**
 * Make sure the applicant is routable and reachable before they apply: a
 * kind 10002 so their content has a home, and a kind 10050 so the approval DM
 * lands in a real inbox. Never throws — relay bookkeeping must not block the
 * application itself.
 *
 * @param {object} [deps]
 * @param {any} [deps.account]
 * @param {(pubkey: string) => Promise<{relayList: {writeRelays: string[], readRelays: string[]} | null, outcome: string}>} [deps.fetchRelayListResolution]
 * @param {(pubkey: string) => void} [deps.invalidateRelayListCache]
 * @param {(signer: any) => Promise<any>} [deps.publishDefaultRelayList]
 * @param {() => Promise<void>} [deps.ensureDmRelayList]
 * @param {() => string} [deps.getDmRelayCheckStatus]
 * @returns {Promise<void>}
 */
export async function ensureApplicantRelayLists(deps = {}) {
  const {
    account = manager.active,
    fetchRelayListResolution = defaultFetchRelayListResolution,
    invalidateRelayListCache = defaultInvalidateRelayListCache,
    publishDefaultRelayList = defaultPublishDefaultRelayList,
    ensureDmRelayList = defaultEnsureDmRelayList,
    getDmRelayCheckStatus = defaultGetDmRelayCheckStatus
  } = deps;

  const pubkey = account?.pubkey;
  const signer = account?.signer;
  if (!pubkey || !signer) return;

  try {
    // Backfilling publishes a replaceable event, so an unproven absence is not
    // good enough: a lookup that merely timed out would supersede a real list
    // we never saw. Only a confirmed 'absent', or a list that is present but
    // empty (equally unroutable, and proof in itself), earns a default one.
    const { relayList, outcome } = await fetchRelayListResolution(pubkey);
    const declared = (relayList?.writeRelays?.length || 0) + (relayList?.readRelays?.length || 0);
    if (declared === 0 && outcome !== 'unknown') {
      await publishDefaultRelayList(signer);
      // The empty-list case is cached for 5 minutes; drop it so the publish
      // below and everything after sees the fresh 10002.
      invalidateRelayListCache(pubkey);
    } else if (outcome === 'unknown') {
      console.warn('[membership] kind 10002 lookup did not settle — not backfilling');
    }
  } catch (err) {
    console.warn('[membership] kind 10002 check/backfill failed:', err);
  }

  try {
    // Same rule on the DM side. ensureDmRelayList reads the EventStore only, so
    // on its own it cannot tell "no kind 10050" from "not fetched yet". The DM
    // service already runs a settle-aware self-check at login against the
    // user's own write relays plus the indexers — the very check that drives
    // the app's missing-DM-relay nudge. Reuse its verdict: only 'absent' is
    // conclusive enough to publish over.
    const dmStatus = getDmRelayCheckStatus();
    if (dmStatus === 'absent') {
      await ensureDmRelayList();
    } else if (dmStatus !== 'present') {
      console.warn(`[membership] kind 10050 self-check is '${dmStatus}' — not backfilling`);
    }
  } catch (err) {
    console.warn('[membership] kind 10050 backfill failed:', err);
  }
}
