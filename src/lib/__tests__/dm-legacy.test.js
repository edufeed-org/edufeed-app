/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  LEGACY_CONVERSATION_PREFIX,
  toLegacyConversationId,
  isLegacyConversationId,
  stripLegacyConversationId,
  normalizeLegacyConversation,
  normalizeLegacyMessage,
  groupLegacyConversations,
  mergeDmConversations
} from '$lib/helpers/dm.js';

/** @param {{id: string, from: string, to: string, at: number}} o */
function kind4(o) {
  return {
    id: o.id,
    kind: 4,
    pubkey: o.from,
    created_at: o.at,
    content: 'CIPHER',
    tags: [['p', o.to]]
  };
}

describe('legacy conversation id helpers', () => {
  it('prefixes a base id', () => {
    expect(toLegacyConversationId('abc')).toBe(`${LEGACY_CONVERSATION_PREFIX}abc`);
  });

  it('detects a legacy id', () => {
    expect(isLegacyConversationId(toLegacyConversationId('abc'))).toBe(true);
    expect(isLegacyConversationId('abc')).toBe(false);
    expect(isLegacyConversationId(undefined)).toBe(false);
  });

  it('strips the prefix (and is a no-op for non-legacy ids)', () => {
    expect(stripLegacyConversationId(toLegacyConversationId('abc'))).toBe('abc');
    expect(stripLegacyConversationId('abc')).toBe('abc');
  });
});

describe('normalizeLegacyConversation', () => {
  it('prefixes the id, flags legacy, and substitutes decrypted lastMessage content', () => {
    const conv = {
      id: 'pubA:pubB',
      participants: ['pubA', 'pubB'],
      lastMessage: { id: 'e1', pubkey: 'pubB', created_at: 100, content: 'CIPHERTEXT==' }
    };
    const out = normalizeLegacyConversation(conv, 'hello world');
    expect(out.id).toBe(`${LEGACY_CONVERSATION_PREFIX}pubA:pubB`);
    expect(out.legacy).toBe(true);
    expect(out.participants).toEqual(['pubA', 'pubB']);
    expect(out.lastMessage.content).toBe('hello world');
    // original event id/timestamp preserved
    expect(out.lastMessage.id).toBe('e1');
    expect(out.lastMessage.created_at).toBe(100);
  });

  it('does not mutate the source lastMessage', () => {
    const conv = {
      id: 'x',
      participants: ['a', 'b'],
      lastMessage: { id: 'e1', content: 'CIPHER', created_at: 1 }
    };
    normalizeLegacyConversation(conv, 'plain');
    expect(conv.lastMessage.content).toBe('CIPHER');
  });
});

describe('normalizeLegacyMessage', () => {
  it('replaces content with the decrypted plaintext without mutating the source', () => {
    const ev = { id: 'e1', kind: 4, content: 'CIPHER', created_at: 5, tags: [] };
    const out = normalizeLegacyMessage(ev, 'plain');
    expect(out.content).toBe('plain');
    expect(out.kind).toBe(4);
    expect(ev.content).toBe('CIPHER');
  });

  it('defaults decryptFailed to false', () => {
    const ev = { id: 'e1', kind: 4, content: 'CIPHER', created_at: 5, tags: [] };
    expect(normalizeLegacyMessage(ev, 'plain').decryptFailed).toBe(false);
  });

  it('flags decryptFailed when the message could not be decrypted', () => {
    const ev = { id: 'e1', kind: 4, content: 'CIPHER', created_at: 5, tags: [] };
    const out = normalizeLegacyMessage(ev, '', true);
    expect(out.content).toBe('');
    expect(out.decryptFailed).toBe(true);
  });
});

describe('groupLegacyConversations', () => {
  const ME = 'me';
  const A = 'alice';
  const B = 'bob';

  it('groups inbound and outbound messages of one thread into a single conversation', () => {
    const msgs = [
      kind4({ id: 'in1', from: A, to: ME, at: 10 }),
      kind4({ id: 'out1', from: ME, to: A, at: 20 })
    ];
    const groups = groupLegacyConversations(msgs);
    expect(groups).toHaveLength(1);
    expect([...groups[0].participants].sort()).toEqual([A, ME].sort());
  });

  it('picks the newest message overall as lastMessage (including an outbound one)', () => {
    const msgs = [
      kind4({ id: 'in1', from: A, to: ME, at: 10 }),
      kind4({ id: 'out1', from: ME, to: A, at: 99 })
    ];
    const groups = groupLegacyConversations(msgs);
    expect(groups[0].lastMessage.id).toBe('out1');
    expect(groups[0].lastMessage.created_at).toBe(99);
  });

  it('surfaces a thread that only has outbound messages (one you started, no reply yet)', () => {
    const msgs = [kind4({ id: 'out1', from: ME, to: B, at: 5 })];
    const groups = groupLegacyConversations(msgs);
    expect(groups).toHaveLength(1);
    expect(groups[0].lastMessage.id).toBe('out1');
    expect([...groups[0].participants].sort()).toEqual([B, ME].sort());
  });

  it('keeps separate correspondents in separate conversations', () => {
    const msgs = [
      kind4({ id: 'a1', from: A, to: ME, at: 10 }),
      kind4({ id: 'b1', from: ME, to: B, at: 20 })
    ];
    const groups = groupLegacyConversations(msgs);
    expect(groups).toHaveLength(2);
  });

  it('tolerates empty/undefined input', () => {
    expect(groupLegacyConversations([])).toEqual([]);
    expect(groupLegacyConversations(undefined)).toEqual([]);
  });
});

describe('mergeDmConversations', () => {
  it('merges and sorts by lastMessage.created_at descending', () => {
    const wrapped = [
      { id: 'w1', participants: [], lastMessage: { created_at: 50 } },
      { id: 'w2', participants: [], lastMessage: { created_at: 200 } }
    ];
    const legacy = [{ id: 'l1', legacy: true, participants: [], lastMessage: { created_at: 100 } }];
    const merged = mergeDmConversations(wrapped, legacy);
    expect(merged.map((c) => c.id)).toEqual(['w2', 'l1', 'w1']);
  });

  it('tolerates empty/undefined inputs', () => {
    expect(mergeDmConversations(undefined, undefined)).toEqual([]);
    expect(mergeDmConversations([{ id: 'a', lastMessage: { created_at: 1 } }], undefined)).toEqual([
      { id: 'a', lastMessage: { created_at: 1 } }
    ]);
  });
});
