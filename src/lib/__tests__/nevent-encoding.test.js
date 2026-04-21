/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  getPointerForEvent,
  encodeDecodeResult,
  decodeEventPointer,
  getEventPointerForEvent
} from 'applesauce-core/helpers';

describe('nevent encoding/decoding with applesauce helpers', () => {
  const mockEvent = {
    id: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
    pubkey: 'aaa111bbb222ccc333ddd444eee555fff666aaa111bbb222ccc333ddd444eee5',
    kind: 11,
    created_at: 1700000000,
    tags: [
      ['h', 'fff000eee111ddd222ccc333bbb444aaa555fff000eee111ddd222ccc333bbb4'],
      ['title', 'Test Thread']
    ],
    content: 'Hello world',
    sig: '0'.repeat(128)
  };

  const relayHints = ['wss://relay1.example.com', 'wss://relay2.example.com'];

  it('roundtrips kind 11 event through getPointerForEvent + encodeDecodeResult + decodeEventPointer', () => {
    const pointer = getPointerForEvent(mockEvent, relayHints);
    expect(pointer).toBeDefined();
    expect(pointer.type).toBe('nevent');

    const encoded = encodeDecodeResult(pointer);
    expect(encoded).toMatch(/^nevent1/);

    const decoded = decodeEventPointer(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe(mockEvent.id);
    expect(decoded?.relays).toEqual(relayHints);
  });

  it('getEventPointerForEvent returns EventPointer with relays', () => {
    const pointer = getEventPointerForEvent(mockEvent, relayHints);
    expect(pointer.id).toBe(mockEvent.id);
    expect(pointer.relays).toEqual(relayHints);
    expect(pointer.author).toBe(mockEvent.pubkey);
    expect(pointer.kind).toBe(11);
  });

  it('decodeEventPointer returns null for invalid strings', () => {
    expect(decodeEventPointer('invalid')).toBeNull();
    expect(decodeEventPointer('npub1abc')).toBeNull();
    expect(decodeEventPointer('naddr1abc')).toBeNull();
    expect(decodeEventPointer('')).toBeNull();
  });

  it('decodeEventPointer handles note1 strings', () => {
    const noteEncoded = nip19.noteEncode(mockEvent.id);
    const decoded = decodeEventPointer(noteEncoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe(mockEvent.id);
  });

  it('encodes without relay hints when none provided', () => {
    const pointer = getPointerForEvent(mockEvent);
    const encoded = encodeDecodeResult(pointer);
    expect(encoded).toMatch(/^nevent1/);

    const decoded = decodeEventPointer(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe(mockEvent.id);
    // Relays should be empty or undefined
    expect(decoded?.relays?.length || 0).toBe(0);
  });
});
