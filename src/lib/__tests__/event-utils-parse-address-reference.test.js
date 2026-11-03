/**
 * parseAddressReference - URL d-tag coordinate parsing
 *
 * Regression test for "Shares: a-tag coordinates split on every colon,
 * breaking URL d-tags": NIP-01 address coordinates are `<kind>:<pubkey>:<d>`,
 * but the `d` identifier may itself contain colons (e.g. a URL used as the
 * d-tag). Splitting on every colon and requiring exactly 3 parts rejects
 * those coordinates outright, which is why shared/reposted calendar events
 * with a URL d-tag fail to resolve (calendar-event-loader.svelte.js calls
 * this on every share's 'a' tag).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { parseAddressReference } from '../helpers/eventUtils.js';

const PUBKEY = 'a'.repeat(64);

describe('parseAddressReference', () => {
  it('parses a plain coordinate with a simple d-tag', () => {
    expect(parseAddressReference(`31923:${PUBKEY}:my-event`)).toEqual({
      kind: 31923,
      pubkey: PUBKEY,
      dTag: 'my-event'
    });
  });

  it('keeps the full d-tag when it contains colons (URL d-tag)', () => {
    const dTag = 'https://example.org/e/1';
    const parsed = parseAddressReference(`31923:${PUBKEY}:${dTag}`);
    expect(parsed).toEqual({ kind: 31923, pubkey: PUBKEY, dTag });
  });

  it('keeps a d-tag with multiple colons intact', () => {
    const dTag = 'urn:source:https://example.org/e/1';
    const parsed = parseAddressReference(`30142:${PUBKEY}:${dTag}`);
    expect(parsed).toEqual({ kind: 30142, pubkey: PUBKEY, dTag });
  });

  it('returns null when the kind is missing', () => {
    expect(parseAddressReference(`:${PUBKEY}:d`)).toBeNull();
  });

  it('returns null when the pubkey segment is empty', () => {
    expect(parseAddressReference('31923::d')).toBeNull();
  });

  it('returns null when there is no d-tag segment at all', () => {
    expect(parseAddressReference(`31923:${PUBKEY}`)).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseAddressReference('not-a-coordinate')).toBeNull();
  });
});
