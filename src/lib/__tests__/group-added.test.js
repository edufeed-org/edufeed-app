/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  groupIdOf,
  groupNameOf,
  resolveGroupAdded,
  resolveChannelMention,
  resolveChannelHref
} from '$lib/groups/group-added.js';
import { nip19 } from 'nostr-tools';
import { getNotificationType, getNotificationUrl } from '$lib/helpers/inbox.js';

const OWNER = 'a'.repeat(64);
const putUser = {
  kind: 9000,
  tags: [
    ['h', 'root1'],
    ['p', 'b'.repeat(64)]
  ]
};
const community = {
  kind: 10222,
  pubkey: OWNER,
  tags: [['membership', 'root1', 'wss://groups.example']]
};

describe('kind-9000 "added you" notifications', () => {
  it('is its own inbox type and leaves the target to the caller', () => {
    expect(getNotificationType(/** @type {any} */ (putUser))).toBe('groupAdded');
    expect(getNotificationUrl(/** @type {any} */ (putUser))).toBeNull();
    expect(getNotificationUrl(/** @type {any} */ (putUser), { groupAddedHref: '/c/x' })).toBe(
      '/c/x'
    );
  });

  it('reads the group id and the 39000 name', () => {
    expect(groupIdOf(putUser)).toBe('root1');
    expect(groupIdOf({ tags: [] })).toBeNull();
    expect(groupNameOf({ tags: [['name', ' Arbeitszimmer ']] })).toBe('Arbeitszimmer');
    expect(groupNameOf({ tags: [['name', '  ']] })).toBeNull();
  });

  it('points at the community whose membership pointer names the group', () => {
    const r = resolveGroupAdded({
      groupId: 'root1',
      relay: 'wss://groups.example',
      communikeyEvents: [community]
    });
    expect(r.communityPubkey).toBe(OWNER);
    expect(r.href).toMatch(/^\/c\/npub1/);
    expect(r.channel).toBe(false);
  });

  it('opens a channel inside its community when its parent is a known membership root', () => {
    const r = resolveGroupAdded({
      groupId: 'chan9',
      relay: 'wss://groups.example',
      communikeyEvents: [community],
      metadataEvent: {
        tags: [
          ['d', 'chan9'],
          ['name', 'Willkommen!'],
          ['parent', 'root1']
        ]
      }
    });
    expect(r.communityPubkey).toBe(OWNER);
    expect(r.href).toMatch(/^\/c\/npub1[a-z0-9]+\?view=channels&channel=chan9$/);
    expect(r.groupName).toBe('Willkommen!');
    // A channel row names the channel (and its community), not the community alone.
    expect(r.channel).toBe(true);
  });

  it('falls back to the group route on the host for foreign groups and unknown parents', () => {
    const foreign = resolveGroupAdded({
      groupId: 'chan9',
      relay: 'wss://groups.example',
      communikeyEvents: [community],
      metadataEvent: {
        tags: [
          ['d', 'chan9'],
          ['name', 'arbeitszimmer'],
          ['parent', 'someone-elses-root']
        ]
      }
    });
    expect(foreign.communityPubkey).toBeNull();
    expect(foreign.channel).toBe(true);
    expect(foreign.href).toMatch(/^\/groups\//);
    expect(foreign.groupName).toBe('arbeitszimmer');
    // No 39000 yet (still loading): nothing to follow, host route for now.
    const unknown = resolveGroupAdded({
      groupId: 'chan9',
      relay: 'wss://groups.example',
      communikeyEvents: [community]
    });
    expect(unknown.communityPubkey).toBeNull();
    expect(unknown.href).toMatch(/^\/groups\//);
    expect(resolveGroupAdded({ groupId: null, relay: null }).href).toBeNull();
  });
});

describe('kind-9 channel mention target', () => {
  it('opens the message in the channel on its host and names the channel', () => {
    const r = resolveChannelMention({
      groupId: 'chan9',
      relay: 'wss://groups.example',
      messageId: 'm1',
      metadataEvent: {
        tags: [
          ['d', 'chan9'],
          ['name', 'arbeitszimmer']
        ]
      }
    });
    expect(r.href).toMatch(/^\/groups\/.+\?message=m1$/);
    expect(r.groupName).toBe('arbeitszimmer');
  });

  it('opens the message inside the community page when the channel belongs to a known root', () => {
    const r = resolveChannelMention({
      groupId: 'chan9',
      relay: 'wss://groups.example',
      messageId: 'm1',
      communikeyEvents: [community],
      metadataEvent: {
        tags: [
          ['d', 'chan9'],
          ['name', 'Willkommen!'],
          ['parent', 'root1']
        ]
      }
    });
    expect(r.href).toMatch(/^\/c\/npub1[a-z0-9]+\?view=channels&channel=chan9&message=m1$/);
    expect(r.groupName).toBe('Willkommen!');
  });

  it('opens a message in the membership root itself on the community page', () => {
    const r = resolveChannelMention({
      groupId: 'root1',
      relay: 'wss://groups.example',
      messageId: 'm1',
      communikeyEvents: [community],
      metadataEvent: { tags: [['d', 'root1']] }
    });
    expect(r.href).toMatch(/^\/c\/npub1[a-z0-9]+\?view=channels&channel=root1&message=m1$/);
  });

  it('yields no target without a group id or a host', () => {
    expect(
      resolveChannelMention({ groupId: null, relay: 'wss://g', messageId: 'm' }).href
    ).toBeNull();
    expect(resolveChannelMention({ groupId: 'c', relay: null, messageId: 'm' }).href).toBeNull();
    expect(
      resolveChannelMention({ groupId: 'c', relay: 'wss://g', messageId: 'm' }).groupName
    ).toBeNull();
  });
});

describe('channel link (dashboard calls)', () => {
  const npub = nip19.npubEncode(OWNER);
  it("opens a community's root group as a channel of that community", () => {
    expect(
      resolveChannelHref({
        pointer: { id: 'root1', relay: 'wss://groups.example' },
        communikeyEvents: [community]
      })
    ).toBe(`/c/${npub}?view=channels&channel=root1`);
  });

  it('opens a sub-channel inside its community', () => {
    expect(
      resolveChannelHref({
        pointer: { id: 'chan', relay: 'wss://groups.example' },
        communikeyEvents: [community],
        metadataEvent: { tags: [['parent', 'root1']] }
      })
    ).toBe(`/c/${npub}?view=channels&channel=chan`);
  });

  it('falls back to the group route when no community is known', () => {
    expect(resolveChannelHref({ pointer: { id: 'chan', relay: 'wss://groups.example' } })).toMatch(
      /^\/groups\//
    );
  });

  it('ignores a community that names the channel on another relay', () => {
    expect(
      resolveChannelHref({
        pointer: { id: 'root1', relay: 'wss://other.example' },
        communikeyEvents: [community]
      })
    ).toMatch(/^\/groups\//);
  });
});

describe('which community a group belongs to (a kind 10222 is self-declared)', () => {
  const STRANGER = 'c'.repeat(64);
  const spoof = {
    kind: 10222,
    pubkey: STRANGER,
    tags: [['membership', 'root1', 'wss://groups.example']]
  };
  const args = { groupId: 'root1', relay: 'wss://groups.example' };

  it('prefers the community I joined over another one claiming the same group', () => {
    const r = resolveGroupAdded({
      ...args,
      communikeyEvents: [spoof, community],
      joinedPubkeys: [OWNER]
    });
    expect(r.communityPubkey).toBe(OWNER);
    const mention = resolveChannelMention({
      ...args,
      messageId: 'm',
      communikeyEvents: [spoof, community],
      joinedPubkeys: [OWNER]
    });
    expect(mention.href).toBe(
      `/c/${nip19.npubEncode(OWNER)}?view=channels&channel=root1&message=m`
    );
  });

  it('takes neither when two claim the group and I joined none of them', () => {
    const r = resolveGroupAdded({ ...args, communikeyEvents: [spoof, community] });
    expect(r.communityPubkey).toBeNull();
    expect(r.href).toMatch(/^\/groups\//);
    expect(
      resolveChannelMention({ ...args, messageId: 'm', communikeyEvents: [spoof, community] }).href
    ).toMatch(/^\/groups\/.*\?message=m$/);
  });

  it('still follows a single claim of a community I have not joined yet', () => {
    // "You were added" usually arrives before the community is on my list.
    expect(resolveGroupAdded({ ...args, communikeyEvents: [community] }).communityPubkey).toBe(
      OWNER
    );
  });

  it('ignores a claim that names the group on another relay', () => {
    const r = resolveGroupAdded({
      groupId: 'root1',
      relay: 'wss://other.example',
      communikeyEvents: [community],
      joinedPubkeys: [OWNER]
    });
    expect(r.communityPubkey).toBeNull();
    expect(r.href).toMatch(/^\/groups\//);
  });

  it('keeps a channel in the community I joined when a stranger claims it as a root', () => {
    const r = resolveGroupAdded({
      groupId: 'chan',
      relay: 'wss://groups.example',
      communikeyEvents: [
        { ...spoof, tags: [['membership', 'chan', 'wss://groups.example']] },
        community
      ],
      metadataEvent: {
        kind: 39000,
        tags: [
          ['d', 'chan'],
          ['parent', 'root1']
        ]
      },
      joinedPubkeys: [OWNER]
    });
    expect(r.communityPubkey).toBe(OWNER);
    expect(r.href).toBe(`/c/${nip19.npubEncode(OWNER)}?view=channels&channel=chan`);
  });
});
