// Write side of attribution claims (data model: ./attribution-claims.js,
// wiki article `edufeed-attribution-claims`): the named person sends or
// withdraws a claim, the publisher accepts by re-publishing the content.
import { getSeenRelays } from 'applesauce-core/helpers';
import { plainTemplate } from './plain-template.js';
import { unique } from './unique.js';
import { getArticleRelays, getEducationalRelays } from './relay-helper.js';
import { deleteEvent } from './eventDeletion.js';
import {
  buildClaimTemplate,
  parseClaim,
  claimStatus,
  acceptClaimTags
} from './attribution-claims.js';
import { publishEvent } from '$lib/services/publish-service.js';
import { getPrimaryWriteRelay } from '$lib/services/relay-service.svelte.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

/** @param {any} event */
const seenRelays = (event) => Array.from(getSeenRelays(event) ?? []);

/**
 * Where the claims on `event` live — written to and read from the same set,
 * so the publisher finds a claim where the claimant put it: the relays the
 * content kind is read from plus the relays this copy was seen on. Resources
 * add the article relays: AMB relays index kind 30142 and may drop a 1985.
 * @param {any} event - the content (kind 30142 or 30023)
 * @returns {string[]}
 */
export function claimRelays(event) {
  const kindRelays =
    event.kind === 30142 ? [...getEducationalRelays(), ...getArticleRelays()] : getArticleRelays();
  return unique([...kindRelays, ...seenRelays(event)]);
}

/**
 * @param {any} signed
 * @param {string[]} taggedPubkeys
 * @param {string[]} additionalRelays
 */
async function publish(signed, taggedPubkeys, additionalRelays) {
  const result = await publishEvent(signed, taggedPubkeys, { additionalRelays });
  if (!result.success) throw new Error('No relay accepted the event');
  eventStore.add(signed);
  return signed;
}

/**
 * Ask the publisher of `event` to link a name-only credit to the active account.
 * @param {any} event - the content
 * @param {{ role: 'creator' | 'contributor', name: string }} credit
 * @param {any} activeUser
 * @returns {Promise<any>} the signed claim
 */
export async function publishClaim(event, { role, name }, activeUser) {
  const relays = claimRelays(event);
  const relayHint = seenRelays(event)[0] ?? relays[0] ?? '';
  const template = buildClaimTemplate(event, { role, name, relayHint });
  const signed = await activeUser.signer.signEvent(template);
  // The tagged publisher's read relays come from publishEvent's outbox union.
  return publish(signed, [event.pubkey], relays);
}

/**
 * Accept a claim: re-publish the content with the claimant linked. Only the
 * tags of the claimed credit change — the event is never rebuilt from a form.
 * @param {any} event - the content
 * @param {any} claimEvent - kind 1985
 * @param {any} activeUser - must be the publisher
 * @returns {Promise<any>} the new version of the content
 */
export async function acceptClaim(event, claimEvent, activeUser) {
  if (!activeUser?.pubkey || activeUser.pubkey !== event.pubkey) {
    throw new Error('Only the publisher can accept a claim');
  }
  // The page may hold an older copy (an acceptance a minute ago, an edit in
  // another tab); signing that one would silently undo the newer version.
  const d = event.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] ?? '';
  const current = eventStore.getReplaceable(event.kind, event.pubkey, d) ?? event;
  const claim = parseClaim(claimEvent);
  if (!claim || claimStatus(claim, current) !== 'open') throw new Error('Claim is not open');
  const tags = acceptClaimTags(current.tags, claim, await getPrimaryWriteRelay(claim.pubkey));
  if (!tags) throw new Error('Claim is not open');

  const signed = await activeUser.signer.signEvent(
    plainTemplate({
      kind: current.kind,
      content: current.content,
      tags,
      // A replaceable only wins with a later timestamp.
      created_at: Math.max(Math.floor(Date.now() / 1000), current.created_at + 1)
    })
  );
  return publish(signed, [claim.pubkey], seenRelays(current));
}

/**
 * Withdraw an own claim (NIP-09).
 * @param {any} claimEvent
 * @param {any} activeUser
 * @param {any} event - the content, for the relays the claim was sent to
 */
export async function withdrawClaim(claimEvent, activeUser, event) {
  const result = await deleteEvent(claimEvent, activeUser, {
    additionalRelays: claimRelays(event)
  });
  if (!result.success) throw new Error(result.error ?? 'Withdrawing the claim failed');
}
