/** @vitest-environment node */
// src/lib/__tests__/group-roles.test.js
import { describe, it, expect } from 'vitest';
import {
  PUBLISHER_ROLE,
  hasModerationRole,
  isPublisherOnly,
  roleOptionsFromAdmins,
  withPublisherRole,
  withoutPublisherRole
} from '$lib/groups/roles.js';

describe('hasModerationRole', () => {
  it('recognises the moderation tokens, including the relay-assigned king', () => {
    expect(hasModerationRole(['admin'])).toBe(true);
    expect(hasModerationRole(['moderator'])).toBe(true);
    expect(hasModerationRole(['king'])).toBe(true);
    expect(hasModerationRole(['Admin'])).toBe(true);
  });

  it('is false for publishers and for custom community roles', () => {
    expect(hasModerationRole([PUBLISHER_ROLE])).toBe(false);
    expect(hasModerationRole(['lehrkraft'])).toBe(false);
    expect(hasModerationRole([])).toBe(false);
    expect(hasModerationRole(undefined)).toBe(false);
  });

  it('a publisher who is also an admin still moderates', () => {
    expect(hasModerationRole(['publisher', 'admin'])).toBe(true);
  });
});

describe('isPublisherOnly', () => {
  it('is true only when the publisher role carries no moderation role alongside it', () => {
    expect(isPublisherOnly(['publisher'])).toBe(true);
    expect(isPublisherOnly(['publisher', 'lehrkraft'])).toBe(true);
    expect(isPublisherOnly(['publisher', 'admin'])).toBe(false);
    expect(isPublisherOnly(['admin'])).toBe(false);
    expect(isPublisherOnly([])).toBe(false);
  });
});

describe('withPublisherRole / withoutPublisherRole', () => {
  it('adds the role without disturbing the others, and never duplicates it', () => {
    expect(withPublisherRole(['lehrkraft'])).toEqual(['lehrkraft', 'publisher']);
    expect(withPublisherRole(['publisher'])).toEqual(['publisher']);
    expect(withPublisherRole([])).toEqual(['publisher']);
    expect(withPublisherRole(undefined)).toEqual(['publisher']);
  });

  it('removes only the publisher role, case-insensitively, keeping the rest', () => {
    expect(withoutPublisherRole(['admin', 'publisher'])).toEqual(['admin']);
    expect(withoutPublisherRole(['Publisher'])).toEqual([]);
    expect(withoutPublisherRole(['admin'])).toEqual(['admin']);
    expect(withoutPublisherRole(undefined)).toEqual([]);
  });

  it('returns a new array — a 9000 put-user must not mutate the roster in place', () => {
    const roles = ['admin'];
    expect(withPublisherRole(roles)).not.toBe(roles);
    expect(roles).toEqual(['admin']);
  });
});

describe('roleOptionsFromAdmins', () => {
  it('always seeds admin and publisher, even with an empty roster', () => {
    expect(roleOptionsFromAdmins([])).toEqual(['admin', PUBLISHER_ROLE]);
    expect(roleOptionsFromAdmins(undefined)).toEqual(['admin', PUBLISHER_ROLE]);
  });

  it('collects custom roles from every admin, deduplicated, existing roles first', () => {
    const admins = [
      { pubkey: 'a', roles: ['lehrkraft', 'admin'] },
      { pubkey: 'b', roles: ['lehrkraft'] }
    ];
    expect(roleOptionsFromAdmins(admins)).toEqual(['lehrkraft', 'admin', PUBLISHER_ROLE]);
  });

  it('tolerates roster entries without a roles array', () => {
    expect(roleOptionsFromAdmins([{ pubkey: 'a' }])).toEqual(['admin', PUBLISHER_ROLE]);
  });
});
