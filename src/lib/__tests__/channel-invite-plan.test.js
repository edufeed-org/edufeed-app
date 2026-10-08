/** @vitest-environment node */
// Issue wcm40ukc: inviting someone who is not a community member into a
// channel of a moderated community. The plan seats outsiders on the root
// group (community admission) before the channel; members only get the
// channel seat; self never needs one.
import { describe, it, expect } from 'vitest';
import { channelInvitePlan } from '$lib/groups/channel-invite-plan.js';

const ME = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const OUTSIDER = 'c'.repeat(64);
const ROOT = { id: 'root-1', relay: 'wss://groups.example/' };

describe('channelInvitePlan', () => {
  it('admits outsiders to the root group and seats everyone on the channel', () => {
    expect(
      channelInvitePlan({
        selected: [MEMBER, OUTSIDER, OUTSIDER, ME],
        self: ME,
        rootPointer: ROOT,
        rootMembers: new Set([ME, MEMBER])
      })
    ).toEqual({ channel: [MEMBER, OUTSIDER], root: [OUTSIDER] });
  });

  it('admits nobody when the community has no root group', () => {
    expect(
      channelInvitePlan({ selected: [OUTSIDER], self: ME, rootPointer: null, rootMembers: [] })
    ).toEqual({ channel: [OUTSIDER], root: [] });
  });

  it('treats an unknown roster as "nobody is a member yet" (the relay answers already-member harmlessly)', () => {
    expect(
      channelInvitePlan({ selected: [MEMBER], self: ME, rootPointer: ROOT, rootMembers: undefined })
    ).toEqual({ channel: [MEMBER], root: [MEMBER] });
  });

  it('ignores malformed selections', () => {
    expect(
      channelInvitePlan({
        selected: /** @type {any} */ (['', null, OUTSIDER]),
        self: ME,
        rootPointer: ROOT,
        rootMembers: []
      })
    ).toEqual({ channel: [OUTSIDER], root: [OUTSIDER] });
  });
});
