/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { resolveThreadContext } from '$lib/helpers/threadContext.js';

const validPubkey = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';

/**
 * @param {number} [kind]
 * @param {string[][]} [tags]
 * @param {string} [id]
 */
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

describe('resolveThreadContext', () => {
  it('returns event as-is for non-special kinds', async () => {
    const event = makeEvent(11, [['h', 'community1']]);
    const fetchFn = vi.fn();
    const result = await resolveThreadContext(event, fetchFn);
    expect(result.event).toBe(event);
    expect(result.focusCommentId).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // Kind 1111 (comment) resolution
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

  it('returns original comment with parentPointer (nevent) when E-tag root cannot be resolved', async () => {
    const eventId = 'a'.repeat(64);
    const comment = makeEvent(
      1111,
      [
        ['E', eventId, 'wss://relay.example.com'],
        ['K', '11']
      ],
      'comment-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(null);
    const result = await resolveThreadContext(comment, fetchFn);

    expect(result.event).toBe(comment);
    expect(result.focusCommentId).toBeUndefined();
    expect(result.parentPointer).toBeDefined();
    expect(result.parentPointer).toMatch(/^nevent1/);
  });

  it('returns original comment with parentPointer (naddr) when A-tag root cannot be resolved', async () => {
    const comment = makeEvent(
      1111,
      [
        ['A', `31923:${validPubkey}:cal-event`, 'wss://relay.example.com'],
        ['K', '31923']
      ],
      'comment-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(null);
    const result = await resolveThreadContext(comment, fetchFn);

    expect(result.event).toBe(comment);
    expect(result.focusCommentId).toBeUndefined();
    expect(result.parentPointer).toBeDefined();
    expect(result.parentPointer).toMatch(/^naddr1/);
  });

  it('does NOT return parentPointer when kind 1111 root resolves successfully', async () => {
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
    expect(result.parentPointer).toBeUndefined();
  });

  // Kind 1 (text note) resolution — resolves to ROOT event
  it('resolves kind 1 reply to root event with focusCommentId', async () => {
    const rootId = 'c'.repeat(64);
    const rootEvent = makeEvent(1, [], rootId);
    const reply = makeEvent(1, [['e', rootId, 'wss://relay.example.com', 'root']], 'reply-id');

    const fetchFn = vi.fn().mockResolvedValue(rootEvent);
    const result = await resolveThreadContext(reply, fetchFn);

    expect(result.event).toBe(rootEvent);
    expect(result.focusCommentId).toBe('reply-id');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('resolves kind 1 deep reply to root (not parent)', async () => {
    const rootId = 'c'.repeat(64);
    const parentId = 'd'.repeat(64);
    const rootEvent = makeEvent(1, [], rootId);
    const deepReply = makeEvent(
      1,
      [
        ['e', rootId, 'wss://relay.example.com', 'root'],
        ['e', parentId, 'wss://relay2.example.com', 'reply']
      ],
      'deep-reply-id'
    );

    const fetchFn = vi.fn().mockResolvedValue(rootEvent);
    const result = await resolveThreadContext(deepReply, fetchFn);

    expect(result.event).toBe(rootEvent);
    expect(result.focusCommentId).toBe('deep-reply-id');
    // Should fetch the ROOT, not the parent
    const fetchedNevent = fetchFn.mock.calls[0][0];
    expect(fetchedNevent).toMatch(/^nevent1/);
  });

  it('returns kind 1 reply with parentPointer when root fetch fails', async () => {
    const rootId = 'd'.repeat(64);
    const reply = makeEvent(1, [['e', rootId, 'wss://relay.example.com', 'root']], 'reply-id');

    const fetchFn = vi.fn().mockResolvedValue(null);
    const result = await resolveThreadContext(reply, fetchFn);

    expect(result.event).toBe(reply);
    expect(result.focusCommentId).toBeUndefined();
    expect(result.parentPointer).toBeDefined();
    expect(result.parentPointer).toMatch(/^nevent1/);
  });

  it('returns standalone kind 1 note as-is', async () => {
    const note = makeEvent(1, [], 'note-id');
    const fetchFn = vi.fn();
    const result = await resolveThreadContext(note, fetchFn);

    expect(result.event).toBe(note);
    expect(result.focusCommentId).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
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
