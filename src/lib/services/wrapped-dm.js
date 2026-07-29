/**
 * Sending a NIP-17 wrapped DM, with both relay-list prerequisites.
 *
 * Two things have to be true before a gift wrap can reach anyone, and neither
 * is the action's job:
 *
 *   1. The *recipient's* kind 10050 must be in the EventStore. SendWrappedMessage
 *      resolves participant relays via `castUser(pubkey).directMessageRelays$`,
 *      which reads the store and never hits the network — without a prefetch the
 *      wrap falls through to the public fallback relays (see dm-recipient-relays.js).
 *   2. The *sender* should have a kind 10050 of their own, or the reply has
 *      nowhere to land (see dm-relay-backfill.js).
 *
 * Every send site had to remember both. Three of the four forgot the first one,
 * so calendar invites, metadata feedback and membership approvals were all
 * routed to relays the recipient never chose. This is the one place that knows.
 */
import { ensureDmRelayList } from '$lib/services/dm-relay-backfill.js';
import { ensureRecipientDmRelays } from '$lib/services/dm-recipient-relays.js';
import { actionRunnerOptimistic } from '$lib/stores/action-runner.svelte.js';
import { SendWrappedMessage } from 'applesauce-actions/actions';

/**
 * Send a NIP-17 wrapped DM, making sure both relay lists are in place first.
 *
 * The relay bookkeeping is best-effort — a hung lookup relay must not swallow
 * the message — but the send itself is not: callers surface its rejection.
 *
 * @param {string | string[]} recipients - Pubkey(s) the wrap is addressed to.
 *   Passed to the action verbatim; applesauce accepts either shape.
 * @param {string} content - Message body. Ignored when `opts.args` is given.
 * @param {object} [opts]
 * @param {any} [opts.action] - Action to run (default `SendWrappedMessage`).
 * @param {any[]} [opts.args] - Full argument list for a non-default action,
 *   e.g. `[replyingTo, content]` for `ReplyToWrappedMessage`.
 * @returns {Promise<any>} whatever the action runner returns
 */
export async function sendWrappedDm(recipients, content, opts = {}) {
  const { action = SendWrappedMessage, args } = opts;
  const pubkeys = (Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean);

  // Disjoint work — our own list vs. theirs — so run both at once. Neither may
  // block the send: relay bookkeeping failing is not a reason to lose a message.
  await Promise.allSettled([ensureDmRelayList(), ensureRecipientDmRelays(pubkeys)]);

  return actionRunnerOptimistic.run(action, ...(args ?? [recipients, content]));
}
