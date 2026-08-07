import { describe, it, expect } from 'vitest';
import {
  getThreadRootId,
  buildReplyTags,
  buildThreadIndex,
  isThreadReply
} from '$lib/helpers/threading.js';

const ROOT = 'r'.repeat(64);
const PARENT = 'p'.repeat(64);
const OTHER = 'o'.repeat(64);

/**
 * @param {{id?: string, tags?: string[][], pubkey?: string, created_at?: number, content?: string}} over
 */
function msg(over = {}) {
  return {
    id: over.id ?? 'x'.repeat(64),
    pubkey: over.pubkey ?? 'a'.repeat(64),
    created_at: over.created_at ?? 1000,
    content: over.content ?? 'hi',
    tags: over.tags ?? [['h', 'beechat']]
  };
}

/** The 872-of-886 live shape: a top-level reply carries ONE `reply`-marked tag
 *  pointing at the thread root. */
const lonelyReply = (root = ROOT, over = {}) =>
  msg({
    tags: [
      ['h', 'beechat'],
      ['e', root, '', 'reply']
    ],
    ...over
  });

/** The 3-of-886 live shape: a nested reply carries the conformant NIP-10 pair. */
const nestedReply = (root = ROOT, parent = PARENT, over = {}) =>
  msg({
    tags: [
      ['h', 'beechat'],
      ['e', root, '', 'root'],
      ['e', parent, '', 'reply']
    ],
    ...over
  });

describe('getThreadRootId', () => {
  it('returns null for a message with no e tags at all', () => {
    expect(getThreadRootId(msg())).toBeNull();
  });

  it('reads the lone reply-marked tag as the root (the 872-event shape)', () => {
    expect(getThreadRootId(lonelyReply())).toBe(ROOT);
  });

  // The load-bearing case. On a nested reply the root tag and the reply tag
  // hold DIFFERENT ids, and a resolver that reads the reply tag would re-root
  // the thread one level down.
  it('prefers the root-marked tag over the reply-marked tag when both are present', () => {
    const event = nestedReply();
    expect(getThreadRootId(event)).toBe(ROOT);
    expect(getThreadRootId(event)).not.toBe(PARENT);
  });

  it('reads a lone root-marked tag (the NIP-10-conformant direct reply)', () => {
    expect(getThreadRootId(msg({ tags: [['e', ROOT, '', 'root']] }))).toBe(ROOT);
  });

  it('ignores e tags that carry no NIP-10 marker', () => {
    expect(getThreadRootId(msg({ tags: [['e', ROOT]] }))).toBeNull();
  });

  it('ignores non-e tags that happen to sit in the marker position', () => {
    expect(getThreadRootId(msg({ tags: [['q', ROOT, '', 'root']] }))).toBeNull();
  });

  it('treats an empty tag value as absent rather than as a root id', () => {
    expect(getThreadRootId(msg({ tags: [['e', '', '', 'root']] }))).toBeNull();
  });

  it('survives a message with no tags array', () => {
    expect(getThreadRootId({ id: 'a' })).toBeNull();
  });
});

describe('isThreadReply', () => {
  it('is false for a top-level message and true for either reply shape', () => {
    expect(isThreadReply(msg())).toBe(false);
    expect(isThreadReply(lonelyReply())).toBe(true);
    expect(isThreadReply(nestedReply())).toBe(true);
  });
});

describe('buildReplyTags', () => {
  // REGRESSION GUARD, NOT COVERAGE OF THE CHANGE: replying to a top-level
  // message emits the same single tag with or without root resolution, because
  // there the parent IS the root. This case is green at the base commit by
  // construction — it is here to prove the fix did not alter the 872-event
  // shape, and it must never be cited as evidence that root resolution works.
  it('[control] a reply to a top-level message keeps the single reply-marked tag', () => {
    expect(buildReplyTags(msg({ id: PARENT }))).toEqual([['e', PARENT, '', 'reply']]);
  });

  it('inherits the root of a lone-reply parent and emits the conformant pair', () => {
    expect(buildReplyTags(lonelyReply(ROOT, { id: PARENT }))).toEqual([
      ['e', ROOT, '', 'root'],
      ['e', PARENT, '', 'reply']
    ]);
  });

  // Depth 3. The clicked message already carries a root+reply pair; the new
  // reply must inherit ITS root, not adopt its parent as a new root.
  it('inherits the root of a nested parent, so depth 3 does not re-root', () => {
    const clicked = nestedReply(ROOT, OTHER, { id: PARENT });
    expect(buildReplyTags(clicked)).toEqual([
      ['e', ROOT, '', 'root'],
      ['e', PARENT, '', 'reply']
    ]);
  });

  it('returns no tags when there is nothing to reply to', () => {
    expect(buildReplyTags(null)).toEqual([]);
  });

  // A malformed event whose `e` tag names itself. Without the self-root guard
  // this emits a pair naming the same id twice — a message that is its own
  // root and its own parent.
  it('does not build a pair from a message that points at itself', () => {
    const selfRef = msg({ id: PARENT, tags: [['e', PARENT, '', 'reply']] });
    expect(buildReplyTags(selfRef)).toEqual([['e', PARENT, '', 'reply']]);
  });
});

describe('buildThreadIndex', () => {
  it('keeps a message with no replies in the timeline and gives it no thread', () => {
    const a = msg({ id: 'a', created_at: 1 });
    const index = buildThreadIndex([a]);
    expect(index.timeline).toEqual([a]);
    expect(index.replyCount('a')).toBe(0);
    expect(index.repliesFor('a')).toEqual([]);
  });

  it('lifts replies out of the timeline and files them under their root', () => {
    const root = msg({ id: ROOT, created_at: 1 });
    const r1 = lonelyReply(ROOT, { id: 'r1', created_at: 2 });
    const r2 = lonelyReply(ROOT, { id: 'r2', created_at: 3 });
    const index = buildThreadIndex([root, r1, r2]);
    expect(index.timeline.map((e) => e.id)).toEqual([ROOT]);
    expect(index.repliesFor(ROOT).map((e) => e.id)).toEqual(['r1', 'r2']);
    expect(index.replyCount(ROOT)).toBe(2);
  });

  it('files a nested reply under the thread root, not under its parent', () => {
    const root = msg({ id: ROOT, created_at: 1 });
    const r1 = lonelyReply(ROOT, { id: PARENT, created_at: 2 });
    const r2 = nestedReply(ROOT, PARENT, { id: 'deep', created_at: 3 });
    const index = buildThreadIndex([root, r1, r2]);
    expect(index.timeline.map((e) => e.id)).toEqual([ROOT]);
    expect(index.repliesFor(ROOT).map((e) => e.id)).toEqual([PARENT, 'deep']);
    expect(index.repliesFor(PARENT)).toEqual([]);
  });

  // Two replies in the same second is ordinary in chat. Without an explicit
  // tie-break the order is whatever the caller's list happened to be, so the
  // same thread can render differently on two surfaces of the same app.
  it('breaks a created_at tie deterministically, whichever order it is fed', () => {
    const root = msg({ id: ROOT, created_at: 1 });
    const a = lonelyReply(ROOT, { id: 'aaa', created_at: 5 });
    const b = lonelyReply(ROOT, { id: 'bbb', created_at: 5 });
    expect(
      buildThreadIndex([root, b, a])
        .repliesFor(ROOT)
        .map((e) => e.id)
    ).toEqual(['aaa', 'bbb']);
    expect(
      buildThreadIndex([root, a, b])
        .repliesFor(ROOT)
        .map((e) => e.id)
    ).toEqual(['aaa', 'bbb']);
  });

  // THE SHIPPED WRITER'S SHAPE. Before this branch, a reply-to-a-reply tagged
  // the message that was clicked, so it names a MID-THREAD message. Filing by
  // the named id put it under a parent that is itself filed away: in no
  // timeline, in no reachable thread, gone. Every such reply already exists on
  // any relay that does not validate thread ancestry.
  it('files a legacy reply-to-a-reply under the ultimate root, not its parent', () => {
    const root = msg({ id: ROOT, created_at: 1 });
    const first = lonelyReply(ROOT, { id: PARENT, created_at: 2 });
    const legacy = lonelyReply(PARENT, { id: 'legacy', created_at: 3 });
    const index = buildThreadIndex([root, first, legacy]);
    expect(index.timeline.map((e) => e.id)).toEqual([ROOT]);
    expect(index.repliesFor(ROOT).map((e) => e.id)).toEqual([PARENT, 'legacy']);
    // Nothing may hang off a message that is not in the timeline: only
    // timeline rows can open a panel, so such a thread is unreachable — and
    // the "N replies" link that advertises it is a trap.
    expect(index.replyCount(PARENT)).toBe(0);
  });

  it('walks a whole chain of legacy replies back to the same thread', () => {
    const root = msg({ id: ROOT, created_at: 1 });
    const a = lonelyReply(ROOT, { id: 'a', created_at: 2 });
    const b = lonelyReply('a', { id: 'b', created_at: 3 });
    const c = lonelyReply('b', { id: 'c', created_at: 4 });
    const index = buildThreadIndex([root, a, b, c]);
    expect(index.timeline.map((e) => e.id)).toEqual([ROOT]);
    expect(index.repliesFor(ROOT).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  // The invariant the whole trap reduces to, asserted over a mixed window.
  it('never files a message under something outside the timeline', () => {
    const root = msg({ id: ROOT, created_at: 1 });
    const first = lonelyReply(ROOT, { id: PARENT, created_at: 2 });
    const index = buildThreadIndex([
      root,
      first,
      lonelyReply(PARENT, { id: 'legacy', created_at: 3 }),
      nestedReply(ROOT, PARENT, { id: 'modern', created_at: 4 }),
      lonelyReply('missing', { id: 'orphan', created_at: 5 })
    ]);
    const inTimeline = new Set(index.timeline.map((e) => e.id));
    for (const event of [root, first, { id: 'legacy' }, { id: 'modern' }, { id: 'orphan' }]) {
      if (index.replyCount(event.id) > 0) expect(inTimeline.has(event.id)).toBe(true);
    }
    expect(index.replyCount(ROOT)).toBe(3);
  });

  // Witness found by differentially comparing the chain walk against a
  // variant over 729 enumerated windows: a reply to a SELF-REFERENCING
  // message. That parent stays in the timeline (the cycle guard puts it
  // there), so the reply belongs in its thread — not loose in the timeline
  // beside it.
  it('files a reply under a self-referencing parent, which is still a timeline row', () => {
    const selfRef = msg({ id: PARENT, tags: [['e', PARENT, '', 'reply']], created_at: 1 });
    const answer = lonelyReply(PARENT, { id: 'answer', created_at: 2 });
    const index = buildThreadIndex([selfRef, answer]);
    expect(index.timeline.map((e) => e.id)).toEqual([PARENT]);
    expect(index.repliesFor(PARENT).map((e) => e.id)).toEqual(['answer']);
  });

  // Malformed data, not a thread. Without a cycle guard the walk never ends.
  it('keeps a message whose thread link cycles in the timeline', () => {
    const a = msg({ id: 'a', tags: [['e', 'b', '', 'reply']], created_at: 1 });
    const b = msg({ id: 'b', tags: [['e', 'a', '', 'reply']], created_at: 2 });
    const index = buildThreadIndex([a, b]);
    expect(index.timeline.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  // A legacy reply whose parent is outside the window: the chain cannot be
  // walked, so it stays visible rather than being filed under a ghost.
  it('keeps a legacy reply visible when its parent is not loaded', () => {
    const root = msg({ id: ROOT, created_at: 1 });
    const index = buildThreadIndex([root, lonelyReply('not-loaded', { id: 'x', created_at: 2 })]);
    expect(index.timeline.map((e) => e.id)).toEqual([ROOT, 'x']);
  });

  it('orders replies oldest-first regardless of input order', () => {
    const root = msg({ id: ROOT, created_at: 1 });
    const late = lonelyReply(ROOT, { id: 'late', created_at: 9 });
    const early = lonelyReply(ROOT, { id: 'early', created_at: 2 });
    const index = buildThreadIndex([root, late, early]);
    expect(index.repliesFor(ROOT).map((e) => e.id)).toEqual(['early', 'late']);
  });

  // An orphan is a reply whose root is not in the loaded window (the relay
  // caps at 100). Dropping it loses the message entirely; keeping it in the
  // timeline is the only option that shows it at all.
  it('keeps a reply whose root is absent visible in the timeline', () => {
    const orphan = lonelyReply('missing-root', { id: 'orphan', created_at: 2 });
    const index = buildThreadIndex([orphan]);
    expect(index.timeline.map((e) => e.id)).toEqual(['orphan']);
    expect(index.replyCount('missing-root')).toBe(0);
  });

  it('does not treat a self-referencing e tag as a thread of its own', () => {
    const weird = msg({ id: 'self', tags: [['e', 'self', '', 'reply']], created_at: 1 });
    const index = buildThreadIndex([weird]);
    expect(index.timeline.map((e) => e.id)).toEqual(['self']);
    expect(index.replyCount('self')).toBe(0);
  });

  it('preserves timeline order of the roots it keeps', () => {
    const a = msg({ id: 'a', created_at: 1 });
    const b = msg({ id: 'b', created_at: 2 });
    const index = buildThreadIndex([a, b, lonelyReply('a', { id: 'ra', created_at: 3 })]);
    expect(index.timeline.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('handles an empty message list', () => {
    const index = buildThreadIndex([]);
    expect(index.timeline).toEqual([]);
    expect(index.replyCount('anything')).toBe(0);
  });
});
