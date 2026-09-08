/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { groupIdOf, groupNameOf, resolveGroupAdded } from '$lib/groups/group-added.js';
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

  it('falls back to the group route on the host for channels and foreign groups', () => {
    const r = resolveGroupAdded({
      groupId: 'chan9',
      relay: 'wss://groups.example',
      communikeyEvents: [community],
      metadataEvent: {
        tags: [
          ['d', 'chan9'],
          ['name', 'arbeitszimmer']
        ]
      }
    });
    expect(r.communityPubkey).toBeNull();
    expect(r.href).toMatch(/^\/groups\//);
    expect(r.groupName).toBe('arbeitszimmer');
    expect(resolveGroupAdded({ groupId: null, relay: null }).href).toBeNull();
  });
});
