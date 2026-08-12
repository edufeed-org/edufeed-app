// Community application intake (Plan 4 Task 6).
//
// A moderated community's join form (kind 30168, referenced via the
// community's `application` pointer — community-membership.js) is answered
// with one NIP-44-encrypted 1069 copy PER REVIEWER, where "reviewer" means
// the root NIP-29 group's admins (kind 39001) — mirroring the deployment
// membership flow's per-admin fan-out (MembershipApplicationForm.svelte),
// just pointed at a different admin source. A single form address can be
// reached from several contexts (legacy single-copy public/private forms,
// the deployment-wide membership form, a community's own application form);
// isCommunityApplication is the switch the respond route uses to pick this
// path over the byte-identical legacy one.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { confirmGroupAdmins } from '$lib/groups/group-management.js';
import { getGroupAdmins } from 'applesauce-common/helpers/groups';
import { parseMembershipPointer, parseApplicationRef } from '$lib/groups/community-membership.js';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { buildATagWithHint, buildPTagsWithHints } from '$lib/services/publish-service.js';
import { buildResponseTags, nip44EncryptWith } from '$lib/helpers/forms.js';
import { unique } from '$lib/helpers/unique.js';

/**
 * Thrown by resolveReviewers when no admin pubkeys can be resolved for the
 * community's root group — empty roster, unreachable relay, or a community
 * with no membership pointer at all. `.code` lets callers switch on the
 * failure without string-matching the message; the UI translates it via
 * form_respond_no_reviewers.
 */
export class NoReviewersError extends Error {
  /** @param {string} [message] */
  constructor(message = 'No reviewers found for this community') {
    super(message);
    this.name = 'NoReviewersError';
    this.code = 'no-reviewers';
  }
}

/**
 * True iff the given form address is the community's OWN application form —
 * i.e. its `application` pointer (community-membership.js) resolves to it.
 * Everything else (a deployment membership form, an unrelated public form,
 * an address the community doesn't reference) is false, so those keep using
 * the legacy single-copy respond path.
 *
 * @param {string} formAddress
 * @param {{tags?: string[][]} | null | undefined} communityEvent
 * @returns {boolean}
 */
export function isCommunityApplication(formAddress, communityEvent) {
  const ref = parseApplicationRef(communityEvent);
  return !!ref && ref.address === formAddress;
}

/**
 * Whether a submit is safe to act on when it MIGHT be a community's own
 * application. `communityEvent === null` is ambiguous — it could mean "no
 * community involved" (communityId absent) or "the 10222 hasn't loaded yet"
 * (communityId present, event still in flight), and those two cases must
 * never be treated the same: guessing wrong on the second one means
 * encrypting a moderated community's application to the form author instead
 * of any of its actual reviewers, with the applicant never told. Pure —
 * carries no timers itself, so the caller supplies `timedOut`.
 *
 * - `'legacy'` — no communityId at all; nothing to wait for, proceed with
 *   the single-copy path unconditionally.
 * - `'ready'` — communityId is present AND its 10222 has resolved; safe to
 *   call isCommunityApplication and branch on its answer.
 * - `'waiting'` — communityId is present, its 10222 hasn't resolved yet, and
 *   the bounded wait hasn't elapsed. Submission must be blocked (disable/
 *   spinner), not silently downgraded to the legacy path.
 * - `'unresolved'` — the bounded wait elapsed with no 10222. Submission must
 *   surface a distinct error (form_respond_community_unresolved) instead of
 *   guessing.
 *
 * @param {{
 *   communityId: string | null | undefined,
 *   communityEvent: {tags?: string[][]} | null | undefined,
 *   timedOut: boolean
 * }} args
 * @returns {'ready' | 'waiting' | 'unresolved' | 'legacy'}
 */
export function applicationSubmitGate({ communityId, communityEvent, timedOut }) {
  if (!communityId) return 'legacy';
  if (communityEvent) return 'ready';
  return timedOut ? 'unresolved' : 'waiting';
}

/**
 * Resolve the reviewers for a moderated community's application: the root
 * group's admins (kind 39001), deduped. Always throws NoReviewersError
 * rather than propagating a raw relay/network error — the caller has exactly
 * one failure mode to handle (form_respond_no_reviewers), the same way
 * provisionRootGroup's admin check is fail-safe rather than fail-open.
 *
 * @param {{tags?: string[][]} | null | undefined} communityEvent
 * @returns {Promise<string[]>}
 */
export async function resolveReviewers(communityEvent) {
  const pointer = parseMembershipPointer(communityEvent);
  if (!pointer) throw new NoReviewersError();

  /** @type {import('nostr-tools').NostrEvent | null} */
  let adminsEvent;
  try {
    adminsEvent = await confirmGroupAdmins(pool.relay(pointer.relay), pointer.id);
  } catch {
    adminsEvent = null;
  }
  if (!adminsEvent) throw new NoReviewersError();

  const admins = getGroupAdmins(adminsEvent) ?? [];
  const pubkeys = unique(admins.map((admin) => admin.pubkey).filter(Boolean));
  if (pubkeys.length === 0) throw new NoReviewersError();
  return pubkeys;
}

/**
 * Build + sign one NIP-44 encrypted kind 1069 copy per reviewer. NIP-44 is
 * pairwise, so there is no single ciphertext or p-tag that serves every
 * reviewer — mirrors MembershipApplicationForm.svelte's per-admin loop.
 * Signing only; the caller publishes. Route wiring calls
 * `publishEvent(copy, [reviewerPubkey])` per copy — the plain outbox model,
 * NOT the `communityEvent` opt (copies carry no `h` tag and are never handed
 * a communityEvent, so no community-relay union applies). Actual reach is:
 * the reviewer's NIP-65 read relays, the applicant's NIP-65 write relays,
 * and the communikey app relays (kind 1069's app-relay category). Task 7's
 * approvals queue MUST read from that same set — anything narrower would
 * silently miss copies this code did deliver.
 *
 * @param {{
 *   formAddress: string,
 *   values: Record<string, string>,
 *   signer: import('applesauce-core/factories').EventSigner,
 *   reviewers: string[]
 * }} args
 * @returns {Promise<import('nostr-tools').NostrEvent[]>}
 */
export async function buildApplicationCopies({ formAddress, values, signer, reviewers }) {
  const responseTags = buildResponseTags(values);
  const plaintext = JSON.stringify(responseTags);
  const factory = createAppEventFactory({ signer });

  const [aTag, pTags] = await Promise.all([
    buildATagWithHint(formAddress),
    buildPTagsWithHints(reviewers)
  ]);

  // Signed sequentially and fully before any publish happens elsewhere — same
  // ordering guarantee as the deployment membership flow, so a failure partway
  // through encrypting/signing cannot leave one reviewer holding an
  // application no other reviewer ever gets a copy of.
  /** @type {import('nostr-tools').NostrEvent[]} */
  const signedCopies = [];
  for (const pTag of pTags) {
    const reviewer = pTag[1];
    /** @type {string[][]} */
    const tags = [aTag, pTag];
    const content = await nip44EncryptWith(signer, reviewer, plaintext);
    tags.push(['encrypted']);

    const template = await factory.build({ kind: 1069, tags, content });
    signedCopies.push(await factory.sign(template));
  }
  return signedCopies;
}
