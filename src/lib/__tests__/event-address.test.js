/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { eventAddress, eventCoordinate } from '$lib/helpers/event-address.js';

const PK = 'a'.repeat(64);
const article = { kind: 30023, pubkey: PK, tags: [['d', 'my-article']] };

describe('eventAddress', () => {
  it('is kind:pubkey:d for addressable kinds and null otherwise', () => {
    expect(eventAddress(article)).toBe(`30023:${PK}:my-article`);
    expect(eventAddress({ kind: 1, pubkey: PK, tags: [['d', 'x']] })).toBeNull();
    expect(eventAddress({ kind: 10002, pubkey: PK, tags: [] })).toBeNull();
    expect(eventAddress({ ...article, tags: [] })).toBeNull();
    expect(eventAddress({ ...article, pubkey: '' })).toBeNull();
    expect(eventAddress(null)).toBeNull();
  });

  it('keeps an empty d tag and colons inside d', () => {
    expect(eventAddress({ ...article, tags: [['d', '']] })).toBe(`30023:${PK}:`);
    expect(eventAddress({ ...article, tags: [['d', 'https://x/y']] })).toBe(
      `30023:${PK}:https://x/y`
    );
  });

  it('does not touch the event', () => {
    const event = { ...article };
    eventAddress(event);
    expect(Object.getOwnPropertySymbols(event)).toEqual([]);
  });
});

describe('eventCoordinate', () => {
  it('builds kind:pubkey:d without a kind check', () => {
    expect(eventCoordinate(article)).toBe(`30023:${PK}:my-article`);
    expect(eventCoordinate({ kind: 1, pubkey: PK, tags: [['d', 'x']] })).toBe(`1:${PK}:x`);
  });

  it('treats a missing d tag or missing tags as the empty identifier', () => {
    expect(eventCoordinate({ ...article, tags: [] })).toBe(`30023:${PK}:`);
    expect(eventCoordinate({ kind: 30023, pubkey: PK })).toBe(`30023:${PK}:`);
  });
});
