/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  LEGACY_CONVERSATION_PREFIX,
  toLegacyConversationId,
  isLegacyConversationId,
  stripLegacyConversationId,
  normalizeLegacyConversation,
  normalizeLegacyMessage,
  mergeDmConversations
} from '$lib/helpers/dm.js';

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
