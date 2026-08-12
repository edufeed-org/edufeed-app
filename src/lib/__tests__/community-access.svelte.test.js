/** @vitest-environment jsdom */
// src/lib/__tests__/community-access.svelte.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const legacy = {
  isLoading: false,
  canPublish: vi.fn(() => 'legacy-canPublish'),
  getMembers: vi.fn(() => ['legacy-member']),
  getAllowedAuthors: vi.fn(() => ['legacy-author']),
  getFormRef: vi.fn(() => 'legacy-form')
};
let rosterState;

vi.mock('$lib/stores/profile-list-access.svelte.js', () => ({
  useProfileListAccess: vi.fn(() => legacy)
}));
vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: vi.fn(() => () => rosterState)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return { pubkey: ACTIVE };
    }
  }
}));

const ACTIVE = 'b'.repeat(64);
const OWNER = 'f'.repeat(64);
const TEACHER = 'a'.repeat(64);
const RELAY = 'wss://groups.example.com';

const { useCommunityAccess } = await import('$lib/stores/community-access.svelte.js');

const moderatedEvent = {
  kind: 10222,
  pubkey: OWNER,
  tags: [
    ['membership', 'root1', RELAY],
    ['application', `30168:${OWNER}:beitritt`, RELAY],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'role', 'lehrkraft'],
    ['content', 'Calendar'],
    ['k', '31922'],
    ['access', 'members'],
    ['content', 'Forum'],
    ['k', '11']
  ]
};
const openEvent = {
  kind: 10222,
  pubkey: OWNER,
  tags: [
    ['content', 'Forum'],
    ['k', '11']
  ]
};

beforeEach(() => {
  rosterState = {
    pointer: { id: 'root1', relay: RELAY },
    refresh: vi.fn(),
    members: new Set([ACTIVE, TEACHER]),
    admins: [{ pubkey: TEACHER, roles: ['lehrkraft'] }],
    isLoading: false,
    isMember: (pk) => new Set([ACTIVE, TEACHER]).has(pk),
    rolesOf: (pk) => (pk === TEACHER ? ['lehrkraft'] : [])
  };
  vi.clearAllMocks();
});

describe('useCommunityAccess — moderated communities', () => {
  const access = useCommunityAccess(
    () => moderatedEvent,
    () => [RELAY]
  );

  it('answers canPublish from the roster (active user is member, not lehrkraft)', () => {
    expect(access.canPublish('Calendar')).toBe(true);
    expect(access.canPublish('Learning')).toBe(false);
    expect(access.canPublish('Forum')).toBe(true); // tier all
    expect(legacy.canPublish).not.toHaveBeenCalled();
  });

  it('getAllowedAuthors: null for open sections, roster-derived otherwise', () => {
    expect(access.getAllowedAuthors('Forum')).toBeNull();
    expect(access.getAllowedAuthors('Calendar')).toEqual(
      expect.arrayContaining([OWNER, ACTIVE, TEACHER])
    );
    expect(access.getAllowedAuthors('Learning')).toEqual(expect.arrayContaining([OWNER, TEACHER]));
    expect(access.getAllowedAuthors('Learning')).not.toContain(ACTIVE);
    expect(access.getAllowedAuthors('NoSuchSection')).toBeNull();
  });

  it('getMembers: roster members for gated sections, empty for open ones', () => {
    expect(access.getMembers('Calendar')).toEqual(expect.arrayContaining([ACTIVE, TEACHER]));
    expect(access.getMembers('Forum')).toEqual([]);
  });

  it('getFormRef: the community-level application address for gated sections only', () => {
    expect(access.getFormRef('Calendar')).toBe(`30168:${OWNER}:beitritt`);
    expect(access.getFormRef('Forum')).toBeNull();
  });

  it('isLoading follows the roster', () => {
    rosterState = { ...rosterState, isLoading: true };
    expect(access.isLoading).toBe(true);
  });
});

describe('useCommunityAccess — open/legacy communities delegate wholesale', () => {
  const access = useCommunityAccess(
    () => openEvent,
    () => [RELAY]
  );
  it('delegates every method to useProfileListAccess', () => {
    expect(access.canPublish('Forum')).toBe('legacy-canPublish');
    expect(access.getMembers('Forum')).toEqual(['legacy-member']);
    expect(access.getAllowedAuthors('Forum')).toEqual(['legacy-author']);
    expect(access.getFormRef('Forum')).toBe('legacy-form');
    expect(access.isLoading).toBe(false);
  });
});
