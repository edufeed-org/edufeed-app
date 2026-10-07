// @ts-nocheck
/** @vitest-environment node */
// The call chat's wire format (LiveKit data, topic edufeed.call.chat): one
// place that says what a payload may carry and what a receiver keeps.
import { describe, it, expect } from 'vitest';
import {
  newCallChatId,
  nonceFor,
  parseCallChatPayload,
  toCallChatPayload,
  CALL_CHAT_MAX_CHARS
} from '$lib/groups/call-chat-payload.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newCallChatId / nonceFor', () => {
  it('makes a v4 uuid and derives a legacy nonce (<= 32 chars) from it', () => {
    const id = newCallChatId();
    expect(id).toMatch(UUID_RE);
    expect(newCallChatId()).not.toBe(id);
    const n = nonceFor(id);
    expect(n).toBe(id.replace(/-/g, ''));
    expect(n.length).toBeLessThanOrEqual(32);
  });
});

describe('parseCallChatPayload', () => {
  const base = { t: 'chat', text: 'hallo', n: 'n1' };

  it('accepts the legacy shape without an id', () => {
    expect(parseCallChatPayload(base)).toEqual({ text: 'hallo', n: 'n1' });
  });

  it('keeps a well-formed id and trims the text', () => {
    const id = newCallChatId();
    expect(parseCallChatPayload({ ...base, id, text: '  hi  ' })).toEqual({
      id,
      text: 'hi',
      n: 'n1'
    });
  });

  it('drops a malformed id but keeps the message', () => {
    expect(parseCallChatPayload({ ...base, id: 'x'.repeat(80) })).toEqual({
      text: 'hallo',
      n: 'n1'
    });
    expect(parseCallChatPayload({ ...base, id: 'has spaces' })).toEqual({ text: 'hallo', n: 'n1' });
    expect(parseCallChatPayload({ ...base, id: 42 })).toEqual({ text: 'hallo', n: 'n1' });
  });

  it.each([
    ['wrong type', { ...base, t: 'react' }],
    ['no text', { t: 'chat', n: 'n1' }],
    ['blank text', { ...base, text: '   ' }],
    ['too long', { ...base, text: 'x'.repeat(CALL_CHAT_MAX_CHARS + 1) }],
    ['no nonce', { t: 'chat', text: 'hi' }],
    ['nonce too long', { ...base, n: 'x'.repeat(33) }],
    ['not an object', 'hi'],
    ['null', null]
  ])('rejects %s', (_label, raw) => {
    expect(parseCallChatPayload(raw)).toBeNull();
  });

  it('passes a finite ts through and drops anything else', () => {
    expect(parseCallChatPayload({ ...base, ts: 1234 }).ts).toBe(1234);
    expect(parseCallChatPayload({ ...base, ts: 'now' }).ts).toBeUndefined();
    expect(parseCallChatPayload({ ...base, ts: Infinity }).ts).toBeUndefined();
  });

  // NIP-30 custom emojis travel as [shortcode, url] pairs: a data message has
  // no `emoji` tags. Same rules as call reactions (https image, sane code).
  it('keeps valid custom emoji pairs and drops the rest', () => {
    const parsed = parseCallChatPayload({
      ...base,
      emoji: [
        ['party', 'https://cdn.example/party.png'],
        ['bad url', 'https://cdn.example/x.png'],
        ['http', 'http://cdn.example/x.png'],
        'nope',
        ['party', 'https://cdn.example/dupe.png']
      ]
    });
    expect(parsed.emoji).toEqual([['party', 'https://cdn.example/party.png']]);
  });

  it('omits emoji when none survive or the field is not an array', () => {
    expect(parseCallChatPayload({ ...base, emoji: [] }).emoji).toBeUndefined();
    expect(parseCallChatPayload({ ...base, emoji: 'x' }).emoji).toBeUndefined();
  });

  it('caps the emoji list at 20 pairs', () => {
    const emoji = Array.from({ length: 25 }, (_, i) => [`e${i}`, `https://cdn.example/${i}.png`]);
    expect(parseCallChatPayload({ ...base, emoji }).emoji).toHaveLength(20);
  });

  // Reserved for the reply / mention / private-message features: parsed
  // here so every client agrees on the shapes.
  it('keeps replyTo + replyPreview when well-formed', () => {
    const replyTo = newCallChatId();
    const parsed = parseCallChatPayload({
      ...base,
      replyTo,
      replyPreview: { n: 'Bea', text: 'erste Zeile' }
    });
    expect(parsed.replyTo).toBe(replyTo);
    expect(parsed.replyPreview).toEqual({ n: 'Bea', text: 'erste Zeile' });
  });

  it('drops a malformed replyTo / replyPreview and truncates a long preview', () => {
    expect(parseCallChatPayload({ ...base, replyTo: 'nope nope' }).replyTo).toBeUndefined();
    expect(parseCallChatPayload({ ...base, replyPreview: 'x' }).replyPreview).toBeUndefined();
    expect(
      parseCallChatPayload({ ...base, replyPreview: { n: 'Bea' } }).replyPreview
    ).toBeUndefined();
    const long = parseCallChatPayload({
      ...base,
      replyPreview: { n: 'N'.repeat(100), text: 'line one\nline two ' + 'x'.repeat(300) }
    }).replyPreview;
    expect(long.n).toHaveLength(64);
    expect(long.text).toBe('line one');
    const longLine = parseCallChatPayload({
      ...base,
      replyPreview: { n: 'Bea', text: 'x'.repeat(300) }
    }).replyPreview;
    expect(longLine.text).toHaveLength(200);
  });

  it('keeps mentions as unique identity strings (or "*" for everyone)', () => {
    const me = 'a'.repeat(64) + ':1';
    const parsed = parseCallChatPayload({ ...base, mentions: [me, me, '*', 42, 'x'.repeat(200)] });
    expect(parsed.mentions).toEqual([me, '*']);
    expect(parseCallChatPayload({ ...base, mentions: [] }).mentions).toBeUndefined();
    expect(parseCallChatPayload({ ...base, mentions: 'me' }).mentions).toBeUndefined();
  });

  it('keeps a private recipient identity', () => {
    const to = 'c'.repeat(64) + ':2';
    expect(parseCallChatPayload({ ...base, to }).to).toBe(to);
    expect(parseCallChatPayload({ ...base, to: '' }).to).toBeUndefined();
    expect(parseCallChatPayload({ ...base, to: 'x'.repeat(200) }).to).toBeUndefined();
  });

  it('ignores unknown fields', () => {
    expect(parseCallChatPayload({ ...base, future: 1 })).toEqual({ text: 'hallo', n: 'n1' });
  });
});

describe('toCallChatPayload', () => {
  it('rebuilds the wire shape from a kept message (replay)', () => {
    const id = newCallChatId();
    const record = {
      id,
      identity: 'a'.repeat(64) + ':1',
      n: nonceFor(id),
      text: 'hi',
      at: 1234,
      emoji: [['party', 'https://cdn.example/party.png']],
      replyTo: 'r',
      replyPreview: { n: 'Bea', text: 'x' },
      mentions: ['*']
    };
    expect(toCallChatPayload(record, { ts: true })).toEqual({
      t: 'chat',
      id,
      text: 'hi',
      n: record.n,
      ts: 1234,
      emoji: record.emoji,
      replyTo: 'r',
      replyPreview: record.replyPreview,
      mentions: ['*']
    });
  });

  it('leaves out ts for a live send, and empty optional fields', () => {
    const id = newCallChatId();
    expect(toCallChatPayload({ id, identity: 'x', n: nonceFor(id), text: 'hi', at: 5 })).toEqual({
      t: 'chat',
      id,
      text: 'hi',
      n: nonceFor(id)
    });
  });

  it('does not put a legacy local key on the wire as an id', () => {
    const payload = toCallChatPayload({ id: 'a'.repeat(64) + ':1:n1', n: 'n1', text: 'hi', at: 1 });
    expect(payload.id).toBeUndefined();
  });
});
