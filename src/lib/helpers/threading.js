/**
 * NIP-10 thread resolution for kind-9 chat.
 *
 * Measured against `wss://edufeed.communities.buzz.xyz` (1000 kind-9 events,
 * 886 carrying an `e` tag): Buzz writes a top-level reply as a SINGLE
 * `reply`-marked tag pointing at the thread root (872 events), and a reply to
 * a reply as the conformant NIP-10 pair — `root` plus `reply`, with different
 * ids (3 events). Those are the two shapes this module reads and writes.
 *
 * The lone-`reply`-marks-the-root form is non-conformant (NIP-10 says a direct
 * reply to the root takes a single `root`-marked tag); we match it deliberately
 * because it is what our users' 872 live replies are, and a correct-but-
 * invisible thread is worse than a non-conformant visible one.
 *
 * Only MARKED `e` tags are read. NIP-10's deprecated positional scheme is not
 * honoured here: an unmarked `e` on a kind 9 is as likely to be a quote or a
 * reaction target as a thread link, and no live event on our relay uses it.
 */

/** NIP-10 marker sits in the fourth slot of an `e` tag. */
const MARKER = 3;

/**
 * @param {any} message
 * @param {string} marker
 * @returns {string | null}
 */
function markedETagValue(message, marker) {
  const tag = message?.tags?.find(
    (/** @type {string[]} */ t) => t[0] === 'e' && t[MARKER] === marker
  );
  return tag?.[1] || null;
}

/**
 * The id of the thread this message belongs to, or null if it starts one.
 *
 * A `root` marker wins over a `reply` marker: on a nested reply the two hold
 * different ids, and reading the `reply` tag there would re-root the thread at
 * the parent.
 * @param {any} message
 * @returns {string | null}
 */
export function getThreadRootId(message) {
  return markedETagValue(message, 'root') ?? markedETagValue(message, 'reply');
}

/**
 * True when the message hangs off a thread rather than starting one.
 * @param {any} message
 */
export function isThreadReply(message) {
  return getThreadRootId(message) !== null;
}

/**
 * The `e` tags for a reply to `replyTo`, in the shape Buzz writes.
 *
 * Replying to a top-level message emits one `reply`-marked tag (parent IS the
 * root). Replying to anything that already sits in a thread emits the
 * conformant pair, inheriting the ROOT of the clicked message — not adopting
 * the clicked message as a new root, which is what re-rooted threads at every
 * level below the first.
 * @param {any} replyTo the message being replied to, tags included
 * @returns {string[][]}
 */
export function buildReplyTags(replyTo) {
  if (!replyTo?.id) return [];
  const root = getThreadRootId(replyTo);
  if (!root || root === replyTo.id) return [['e', replyTo.id, '', 'reply']];
  return [
    ['e', root, '', 'root'],
    ['e', replyTo.id, '', 'reply']
  ];
}

/**
 * @typedef {Object} ThreadIndex
 * @property {any[]} timeline messages that belong in the main timeline
 * @property {(rootId: string) => any[]} repliesFor replies to a thread, oldest first
 * @property {(rootId: string) => number} replyCount
 */

/**
 * Follow the thread link upwards until it reaches a message that starts a
 * thread. Returns that message's id, or null when `event` starts one itself.
 *
 * The single tag a message carries is NOT reliably the thread root. The
 * writer this branch replaces tagged the message that was CLICKED, so a
 * reply-to-a-reply written by the shipped app names a mid-thread message, and
 * every such reply already exists on any relay that does not validate thread
 * ancestry. Filing by the named id alone would put those replies under a
 * parent that is itself filed away — leaving them in no timeline and in no
 * reachable thread.
 * @param {any} event
 * @param {Map<string, any>} byId every message in the window
 * @returns {string | null}
 */
function resolveThreadRoot(event, byId) {
  const first = getThreadRootId(event);
  if (!first || first === event.id) return null;
  const seen = new Set([event.id]);
  let currentId = first;
  for (;;) {
    // A cycle is malformed data, not a thread. Bail to the timeline rather
    // than loop: the message is at least readable there.
    if (seen.has(currentId)) return null;
    seen.add(currentId);
    const parent = byId.get(currentId);
    // Named but not loaded: the orphan case, which the caller keeps visible.
    if (!parent) return currentId;
    const next = getThreadRootId(parent);
    if (!next || next === parent.id) return parent.id;
    currentId = next;
  }
}

/**
 * Split a message list into the main timeline and per-thread reply lists.
 *
 * A reply is lifted out of the timeline only when the root it resolves to is
 * present in the same list. The relay window is capped (limit 100), so a reply
 * whose root scrolled out would otherwise vanish entirely — an orphan stays in
 * the timeline, where it is at least readable.
 *
 * Because every reply resolves to the END of its chain, and the end of a chain
 * is by construction a message that starts a thread, nothing is ever filed
 * under a message that is not itself in the timeline.
 * @param {any[]} messages in timeline order (oldest first)
 * @returns {ThreadIndex}
 */
export function buildThreadIndex(messages) {
  /** @type {Map<string, any>} */
  const byId = new Map(messages.filter((event) => event?.id).map((event) => [event.id, event]));
  /** @type {Map<string, any[]>} */
  const replies = new Map();
  /** @type {any[]} */
  const timeline = [];

  for (const event of messages) {
    // A self-reference is not a thread: it would file the message under
    // itself and hide it from the timeline that is meant to show it.
    const root = resolveThreadRoot(event, byId);
    if (!root || !byId.has(root)) {
      timeline.push(event);
      continue;
    }
    const bucket = replies.get(root);
    if (bucket) bucket.push(event);
    else replies.set(root, [event]);
  }

  // Same-second messages are ordinary in chat, so created_at alone leaves the
  // order of a tie up to whatever the caller happened to hand us. Break on id:
  // arbitrary, but the same on every render and on every client.
  for (const bucket of replies.values()) {
    bucket.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  return {
    timeline,
    repliesFor: (rootId) => replies.get(rootId) ?? [],
    replyCount: (rootId) => replies.get(rootId)?.length ?? 0
  };
}
