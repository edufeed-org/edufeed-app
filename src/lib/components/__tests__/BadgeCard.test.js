/**
 * BadgeCard Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import BadgeCard from '../badges/BadgeCard.svelte';

vi.mock('$lib/paraglide/messages', () => ({}));
vi.mock('$lib/helpers/calendar.js', () => ({
  formatCalendarDate: () => 'Jan 15, 2024'
}));
vi.mock('applesauce-core/helpers', () => ({
  getProfilePicture: (/** @type {any} */ profile) => profile?.picture || null,
  getDisplayName: (/** @type {any} */ profile, /** @type {any} */ fallback) =>
    profile?.name || fallback
}));
// Stub complex child components
function StubComponent() {}
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: StubComponent }));

const baseBadge = {
  id: 'award1',
  badgeName: 'Gold Star',
  badgeDescription: 'Awarded for excellence',
  badgeImage: 'https://img.example/gold.png',
  badgeThumb: 'https://img.example/gold-thumb.png',
  issuerPubkey: 'issuer1',
  awardedAt: 1705363200,
  badgeAddress: '30009:issuer1:gold-star'
};

describe('BadgeCard', () => {
  it('renders badge name and description', () => {
    const { getByText } = render(BadgeCard, { props: { badge: baseBadge } });
    expect(getByText('Gold Star')).toBeTruthy();
    expect(getByText('Awarded for excellence')).toBeTruthy();
  });

  it('renders issuer name when profile provided', () => {
    const issuerProfile = { name: 'Badge Authority', picture: null };
    const { getByText } = render(BadgeCard, {
      props: { badge: baseBadge, issuerProfile }
    });
    expect(getByText('Badge Authority')).toBeTruthy();
  });

  it('renders award date', () => {
    const { getByText } = render(BadgeCard, { props: { badge: baseBadge } });
    expect(getByText('Jan 15, 2024')).toBeTruthy();
  });

  it('shows gradient fallback when no image', () => {
    const badgeNoImage = { ...baseBadge, badgeImage: '', badgeThumb: '' };
    const { container } = render(BadgeCard, { props: { badge: badgeNoImage } });
    // Should have gradient fallback div
    const fallback = container.querySelector('[class*="bg-gradient"]');
    expect(fallback).toBeTruthy();
  });
});
