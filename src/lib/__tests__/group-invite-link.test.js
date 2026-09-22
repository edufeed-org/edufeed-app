/** @vitest-environment node */
/**
 * parseGroupInvite — recognises the NIP-17 DM body buildGroupInviteMessage
 * writes (greeting, `/c/<npub>?join=<code>` URL, optional `nostr:naddr…?invite=`
 * line) so the thread can render it as an invite card and dm-trust can keep
 * it out of the requests folder. Pure: no network, no paraglide.
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { parseGroupInvite } from '$lib/groups/invite-link.js';

const COMMUNITY = 'c'.repeat(64);
const NPUB = nip19.npubEncode(COMMUNITY);
const NADDR = nip19.naddrEncode({
  kind: 39000,
  pubkey: 'd'.repeat(64),
  identifier: 'alpika',
  relays: ['wss://groups.edufeed.org']
});
const JOIN_URL = `https://dev.edufeed.org/c/${NPUB}?join=hMX6PYy4m37J`;

describe('parseGroupInvite', () => {
  it('parses the full invite body', () => {
    const content = `Du bist eingeladen, ALPIKA beizutreten. Öffne diesen Link:\n${JOIN_URL}\nnostr:${NADDR}?invite=hMX6PYy4m37J`;
    expect(parseGroupInvite(content)).toEqual({
      communityPubkey: COMMUNITY,
      code: 'hMX6PYy4m37J',
      joinUrl: JOIN_URL,
      naddr: `${NADDR}?invite=hMX6PYy4m37J`
    });
  });

  it('works without the naddr line', () => {
    const content = `You're invited to join Bee Chat. Open this link:\n${JOIN_URL}`;
    expect(parseGroupInvite(content)).toEqual({
      communityPubkey: COMMUNITY,
      code: 'hMX6PYy4m37J',
      joinUrl: JOIN_URL,
      naddr: null
    });
  });

  it('accepts any origin and a port', () => {
    const url = `http://localhost:5173/c/${NPUB}?join=abc23456789A`;
    expect(parseGroupInvite(`hi\n${url}`)?.joinUrl).toBe(url);
  });

  it('returns null for ordinary messages', () => {
    expect(parseGroupInvite('hallo')).toBeNull();
    expect(parseGroupInvite('')).toBeNull();
    expect(parseGroupInvite(undefined)).toBeNull();
    expect(parseGroupInvite(`see https://dev.edufeed.org/c/${NPUB}`)).toBeNull();
    expect(parseGroupInvite(`see https://dev.edufeed.org/c/${NPUB}?view=channels`)).toBeNull();
  });

  it('returns null when the npub does not decode', () => {
    expect(
      parseGroupInvite('https://dev.edufeed.org/c/npub1notvalid?join=abc23456789A')
    ).toBeNull();
  });
});
