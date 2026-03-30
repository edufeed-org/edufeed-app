/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { getParentEventPointer, resolveThreadContext } from '$lib/helpers/threadContext.js';

const validPubkey = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';

function makeEvent(kind = 1, tags = [], id = 'abc123') {
  return {
    id,
    pubkey: validPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind,
    tags,
    content: 'test',
    sig: 'sig'
  };
}

describe('getParentEventPointer', () => {
  it('returns null for standalone note (no e-tags)', () => {
    const event = makeEvent(1, []);
    expect(getParentEventPointer(event)).toBeNull();
  });

  it('returns null for note with only non-reference tags', () => {
    const event = makeEvent(1, [
      ['t', 'nostr'],
      ['p', 'somepubkey']
    ]);
    expect(getParentEventPointer(event)).toBeNull();
  });

  it('returns reply target ID for NIP-10 reply marker', () => {
    const event = makeEvent(1, [
      ['e', 'rootid', '', 'root'],
      ['e', 'replyid', 'wss://relay.example.com', 'reply']
    ]);
    const result = getParentEventPointer(event);
    expect(result).not.toBeNull();
    expect(result.id).toBe('replyid');
  });

  it('preserves relay hint from reply marker', () => {
    const event = makeEvent(1, [
      ['e', 'rootid', '', 'root'],
      ['e', 'replyid', 'wss://relay.example.com', 'reply']
    ]);
    const result = getParentEventPointer(event);
    expect(result.relayHint).toBe('wss://relay.example.com');
  });

  it('returns root ID when only root marker present (direct reply to root)', () => {
    const event = makeEvent(1, [['e', 'rootid', 'wss://relay.example.com', 'root']]);
    const result = getParentEventPointer(event);
    expect(result).not.toBeNull();
    expect(result.id).toBe('rootid');
    expect(result.relayHint).toBe('wss://relay.example.com');
  });

  it('handles legacy positional e-tags (two e-tags, no markers)', () => {
    const event = makeEvent(1, [
      ['e', 'rootid'],
      ['e', 'replyid']
    ]);
    const result = getParentEventPointer(event);
    expect(result).not.toBeNull();
    // Legacy: last e-tag is the reply target
    expect(result.id).toBe('replyid');
  });

  it('handles single legacy positional e-tag', () => {
    const event = makeEvent(1, [['e', 'someid']]);
    const result = getParentEventPointer(event);
    expect(result).not.toBeNull();
    expect(result.id).toBe('someid');
  });

  it('returns null relay hint when no relay provided', () => {
    const event = makeEvent(1, [['e', 'rootid', '', 'root']]);
    const result = getParentEventPointer(event);
    expect(result.relayHint).toBeUndefined();
  });
});

describe('resolveThreadContext', () => {
  it('returns event as-is for non-special kinds', async () => {
    const event = makeEvent(11, [['h', 'community1']]);
    const fetchFn = vi.fn();
    const result = await resolveThreadContext(event, fetchFn);
    expect(result.event).toBe(event);
    expect(result.parentEvent).toBeUndefined();
    expect(result.focusCommentId).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('resolves kind 1111 comment via A tag to root thread', async () => {
    const rootEvent = makeEvent(11, [], 'root-event-id');
    const comment = makeEvent(
      1111,
      [
        ['A', `11:${validPubkey}:thread-id`, 'wss://relay.example.com'],
        ['K', '11']
      ],
      'comment-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(rootEvent);
    const result = await resolveThreadContext(comment, fetchFn);

    expect(result.event).toBe(rootEvent);
    expect(result.focusCommentId).toBe('comment-id');
    expect(fetchFn).toHaveBeenCalledOnce();
    // Should encode as naddr
    expect(fetchFn.mock.calls[0][0]).toMatch(/^naddr1/);
  });

  it('resolves kind 1111 comment via E tag when no A tag', async () => {
    const rootEvent = makeEvent(11, [], 'root-event-id');
    const eventId = 'a'.repeat(64);
    const comment = makeEvent(
      1111,
      [
        ['E', eventId, 'wss://relay.example.com'],
        ['K', '11']
      ],
      'comment-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(rootEvent);
    const result = await resolveThreadContext(comment, fetchFn);

    expect(result.event).toBe(rootEvent);
    expect(result.focusCommentId).toBe('comment-id');
    // Should encode as nevent
    expect(fetchFn.mock.calls[0][0]).toMatch(/^nevent1/);
  });

  it('falls back to E tag when A tag fetch returns null', async () => {
    const rootEvent = makeEvent(11, [], 'root-event-id');
    const eventId = 'b'.repeat(64);
    const comment = makeEvent(
      1111,
      [
        ['A', `31923:${validPubkey}:cal-event`, 'wss://relay.example.com'],
        ['E', eventId, 'wss://relay.example.com'],
        ['K', '11']
      ],
      'comment-id'
    );

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(null) // A tag fetch fails
      .mockResolvedValueOnce(rootEvent); // E tag fetch succeeds

    const result = await resolveThreadContext(comment, fetchFn);
    expect(result.event).toBe(rootEvent);
    expect(result.focusCommentId).toBe('comment-id');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('returns original comment when root cannot be resolved', async () => {
    const comment = makeEvent(
      1111,
      [['E', 'a'.repeat(64), 'wss://relay.example.com']],
      'comment-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(null);
    const result = await resolveThreadContext(comment, fetchFn);

    expect(result.event).toBe(comment);
    expect(result.focusCommentId).toBeUndefined();
  });

  it('resolves kind 1 parent event via NIP-10 references', async () => {
    const parentId = 'c'.repeat(64);
    const parentEvent = makeEvent(1, [], parentId);
    const reply = makeEvent(1, [['e', parentId, 'wss://relay.example.com', 'root']], 'reply-id');

    const fetchFn = vi.fn().mockResolvedValue(parentEvent);
    const result = await resolveThreadContext(reply, fetchFn);

    expect(result.event).toBe(reply);
    expect(result.parentEvent).toBe(parentEvent);
    expect(result.focusCommentId).toBeUndefined();
  });

  it('returns kind 1 without parentEvent when standalone', async () => {
    const note = makeEvent(1, [], 'note-id');
    const fetchFn = vi.fn();
    const result = await resolveThreadContext(note, fetchFn);

    expect(result.event).toBe(note);
    expect(result.parentEvent).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns kind 1 without parentEvent when parent fetch fails', async () => {
    const parentId = 'd'.repeat(64);
    const reply = makeEvent(1, [['e', parentId, '', 'root']], 'reply-id');

    const fetchFn = vi.fn().mockResolvedValue(null);
    const result = await resolveThreadContext(reply, fetchFn);

    expect(result.event).toBe(reply);
    expect(result.parentEvent).toBeUndefined();
  });

  // Kind 7 (reaction) resolution
  it('resolves kind 7 reaction via address pointer to target event', async () => {
    const targetEvent = makeEvent(31923, [], 'target-event-id');
    const reaction = makeEvent(
      7,
      [
        ['a', `31923:${validPubkey}:cal-event`, 'wss://relay.example.com'],
        ['e', 'e'.repeat(64)],
        ['p', validPubkey],
        ['k', '31923']
      ],
      'reaction-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(targetEvent);
    const result = await resolveThreadContext(reaction, fetchFn);

    expect(result.event).toBe(targetEvent);
    expect(result.scrollTo).toBe('reactions');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('resolves kind 7 reaction via event pointer when no address pointer', async () => {
    const targetEvent = makeEvent(1, [], 'target-event-id');
    const eventId = 'f'.repeat(64);
    const reaction = makeEvent(
      7,
      [
        ['e', eventId, 'wss://relay.example.com'],
        ['p', validPubkey]
      ],
      'reaction-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(targetEvent);
    const result = await resolveThreadContext(reaction, fetchFn);

    expect(result.event).toBe(targetEvent);
    expect(result.scrollTo).toBe('reactions');
  });

  it('returns original reaction when target fetch fails', async () => {
    const eventId = 'f'.repeat(64);
    const reaction = makeEvent(
      7,
      [
        ['e', eventId, 'wss://relay.example.com'],
        ['p', validPubkey]
      ],
      'reaction-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(null);
    const result = await resolveThreadContext(reaction, fetchFn);

    expect(result.event).toBe(reaction);
    expect(result.scrollTo).toBeUndefined();
  });

  // Kind 31925 (RSVP) resolution
  it('resolves kind 31925 RSVP to target calendar event', async () => {
    const calendarEvent = makeEvent(31923, [], 'cal-event-id');
    const rsvp = makeEvent(
      31925,
      [
        ['a', `31923:${validPubkey}:cal-event`, 'wss://relay.example.com'],
        ['d', 'rsvp-id'],
        ['p', validPubkey]
      ],
      'rsvp-event-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(calendarEvent);
    const result = await resolveThreadContext(rsvp, fetchFn);

    expect(result.event).toBe(calendarEvent);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('returns original RSVP when target fetch fails', async () => {
    const rsvp = makeEvent(
      31925,
      [
        ['a', `31923:${validPubkey}:cal-event`, 'wss://relay.example.com'],
        ['d', 'rsvp-id']
      ],
      'rsvp-event-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(null);
    const result = await resolveThreadContext(rsvp, fetchFn);

    expect(result.event).toBe(rsvp);
  });

  it('returns original RSVP when no address pointer found', async () => {
    const rsvp = makeEvent(31925, [['d', 'rsvp-id']], 'rsvp-event-id');

    const fetchFn = vi.fn();
    const result = await resolveThreadContext(rsvp, fetchFn);

    expect(result.event).toBe(rsvp);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
