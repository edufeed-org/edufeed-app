// @ts-nocheck
/**
 * Hints that tell two people of the same name apart on search cards:
 * FollowedByLine ("Gefolgt von Anna, Jörg und 3 weiteren") and
 * EducatorChips (Bildungsbereich + subjects from the edufeed profile).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import FollowedByLine from '../people/FollowedByLine.svelte';
import EducatorChips from '../people/EducatorChips.svelte';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);

const profiles = vi.hoisted(() => ({ map: new Map(), one: null }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => profiles.map
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => profiles.one
}));
vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));
vi.mock('$lib/paraglide/messages', () => ({
  people_followed_by: ({ names }) => `Followed by ${names}`,
  people_followed_by_more: ({ names, count }) => `Followed by ${names} and ${count} more`
}));

const concept = (id, de) => ({ id, prefLabel: { de } });

beforeEach(() => {
  profiles.map = new Map([
    [A, { display_name: 'Anna' }],
    [B, { name: 'joerg' }]
  ]);
  profiles.one = null;
});

describe('FollowedByLine', () => {
  it('names two followers and counts the rest', () => {
    const { container } = render(FollowedByLine, { props: { followers: [A, B, C, D] } });
    expect(container.textContent?.trim()).toBe('Followed by Anna, joerg and 2 more');
  });

  it('names one or two without a count', () => {
    const { container } = render(FollowedByLine, { props: { followers: [A] } });
    expect(container.textContent?.trim()).toBe('Followed by Anna');
  });

  it('falls back to a short npub for an unknown follower', () => {
    const { container } = render(FollowedByLine, { props: { followers: [C] } });
    expect(container.textContent).toMatch(/Followed by npub1\w+…\w+/);
  });

  it('renders nothing without followers', () => {
    const { container } = render(FollowedByLine, { props: { followers: [] } });
    expect(container.querySelector('[data-testid="followed-by"]')).toBeNull();
  });
});

describe('EducatorChips', () => {
  it('shows the levels and up to three subjects, counting the rest', () => {
    profiles.one = {
      edufeed: {
        educationalLevels: [concept('l1', 'Hochschule')],
        subjects: ['Mathe', 'Physik', 'Chemie', 'Biologie'].map((s) => concept(s, s))
      }
    };
    const { container } = render(EducatorChips, { props: { pubkey: A } });
    const chips = [...container.querySelectorAll('.badge')].map((b) => b.textContent?.trim());
    expect(chips).toEqual(['Hochschule', 'Mathe', 'Physik', 'Chemie', '+1']);
  });

  it('renders nothing for a profile without edufeed fields', () => {
    profiles.one = { name: 'x' };
    const { container } = render(EducatorChips, { props: { pubkey: A } });
    expect(container.querySelector('[data-testid="educator-chips"]')).toBeNull();
  });
});
