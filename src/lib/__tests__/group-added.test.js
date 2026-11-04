/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  groupIdOf,
  groupNameOf,
  resolveGroupAdded,
  resolveChannelMention
} from '$lib/groups/group-added.js';
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
