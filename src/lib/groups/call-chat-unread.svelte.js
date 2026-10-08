// "Are there call chat messages you have not seen?" — the marker behind the
// unread dots on the call chat tab, the stage's chat button and the dock.
//
// Its own tiny module rather than state inside livekit-connection: that
// service pulls livekit-client (~300KB) into whatever imports it, and
// GroupChat (which draws the tab dot) must not. livekit-connection reports
// each message from someone ELSE here (your own never count); the call chat
// panel registers while it is actually on screen (trackOnScreen — mounted is
// not enough, the /c layout keeps hidden copies), and while any view is on
// screen every message is seen as it arrives.
//
// Counts, not timestamps: a replay to a late joiner carries the sender's
// older send time, and those messages are just as unseen as live ones.

let received = $state(0);
let seen = $state(0);
// Mentions of me (or of everyone) that arrived while no chat was on screen:
// a stronger signal than an ordinary unread (count badge instead of a dot,
// a toast), cleared the same way.
let mentions = $state(0);
/** Chat views on screen right now. Bookkeeping, never rendered. */
let views = 0;

/** A message from someone else arrived. */
export function noteCallChatReceived() {
  received++;
  if (views > 0) seen = received;
}

/**
 * A message from someone else mentioned me. Counts only while no chat view
 * is on screen; returns whether it counted (then the caller may toast).
 */
export function noteCallChatMention() {
  if (views > 0) return false;
  mentions++;
  return true;
}

/**
 * A call chat view is on screen. Returns the matching unregister (safe to
 * call twice); leaving also counts as having seen what was there.
 * @returns {() => void}
 */
export function registerCallChatView() {
  views++;
  seen = received;
  mentions = 0;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    views--;
    seen = received;
    mentions = 0;
  };
}

/** A new call (or none): nothing is unread. */
export function resetCallChatUnread() {
  received = 0;
  seen = 0;
  mentions = 0;
}

/** @returns {{ readonly count: number, readonly mentions: number }} */
export function getCallChatUnread() {
  return {
    get count() {
      return Math.max(0, received - seen);
    },
    get mentions() {
      return mentions;
    }
  };
}
