/** @vitest-environment node */
/**
 * buildGroupInviteMessage — Task A6. Pure formatter for the NIP-17 DM body
 * an npub invite sends: one greeting sentence, the app join URL, and — when
 * a naddr identifier is supplied — a `nostr:` line on its own line so
 * cross-client NIP-29 clients can act on it too.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/paraglide/messages', () => ({
  group_invite_dm_body: (/** @type {{name: string}} */ { name }) =>
    `You're invited to join ${name}. Open this link to join:`
}));

const { buildGroupInviteMessage } = await import('$lib/groups/invite-message.js');

describe('buildGroupInviteMessage', () => {
  it('includes the greeting sentence and the join URL', () => {
    const message = buildGroupInviteMessage({
      communityName: 'Bee Chat',
      joinUrl: 'https://edufeed.org/c/npub1abc?join=CODE123'
    });

    expect(message).toContain("You're invited to join Bee Chat. Open this link to join:");
    expect(message).toContain('https://edufeed.org/c/npub1abc?join=CODE123');
  });

  it('omits the nostr: line entirely when no naddr is given', () => {
    const message = buildGroupInviteMessage({
      communityName: 'Bee Chat',
      joinUrl: 'https://edufeed.org/c/npub1abc?join=CODE123'
    });

    expect(message).not.toContain('nostr:');
  });

  it('appends a nostr:naddr…?invite= line on its own line when naddr is present', () => {
    const message = buildGroupInviteMessage({
      communityName: 'Bee Chat',
      joinUrl: 'https://edufeed.org/c/npub1abc?join=CODE123',
      naddr: 'naddr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq?invite=CODE123'
    });

    const lines = message.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe(
      'nostr:naddr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq?invite=CODE123'
    );
    expect(message).toContain('?invite=');
  });

  it('naddr null/undefined behave the same as absent (no nostr: line)', () => {
    expect(
      buildGroupInviteMessage({ communityName: 'Bee', joinUrl: 'https://x', naddr: null })
    ).not.toContain('nostr:');
    expect(
      buildGroupInviteMessage({ communityName: 'Bee', joinUrl: 'https://x', naddr: undefined })
    ).not.toContain('nostr:');
  });
});
