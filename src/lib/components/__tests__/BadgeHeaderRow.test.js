/**
 * BadgeHeaderRow Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BadgeHeaderRow from '../badges/BadgeHeaderRow.svelte';

vi.mock('$lib/paraglide/messages', () => ({
  profile_badges_view_all: () => 'View all'
}));

/** @param {string} id @param {string} [name] @param {string} [thumb] */
function makeBadge(id, name = 'Badge', thumb = '') {
  return {
    id,
    badgeName: name,
    badgeDescription: '',
    badgeImage: '',
    badgeThumb: thumb,
    issuerPubkey: 'issuer1',
    awardedAt: 1700000000,
    badgeAddress: `30009:issuer1:${id}`
  };
}

describe('BadgeHeaderRow', () => {
  it('renders badge thumbnails', () => {
    const badges = [
      makeBadge('b1', 'Badge 1', 'https://img.example/1.png'),
      makeBadge('b2', 'Badge 2', 'https://img.example/2.png')
    ];
    const { container } = render(BadgeHeaderRow, { props: { badges, onViewAll: () => {} } });
    const images = container.querySelectorAll('img');
    expect(images.length).toBe(2);
  });

  it('shows max 5 thumbnails + overflow count', () => {
    const badges = Array.from({ length: 8 }, (_, i) =>
      makeBadge(`b${i}`, `Badge ${i}`, `https://img.example/${i}.png`)
    );
    const { container, getByText } = render(BadgeHeaderRow, {
      props: { badges, onViewAll: () => {} }
    });
    const images = container.querySelectorAll('img');
    expect(images.length).toBe(5);
    expect(getByText('+3')).toBeTruthy();
  });

  it('calls onViewAll callback when clicked', async () => {
    const onViewAll = vi.fn();
    const badges = [makeBadge('b1', 'Badge 1', 'https://img.example/1.png')];
    const { getByText } = render(BadgeHeaderRow, { props: { badges, onViewAll } });
    const viewAllBtn = getByText((content) => content.includes('View all'));
    await fireEvent.click(viewAllBtn);
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when badges array is empty', () => {
    const { container } = render(BadgeHeaderRow, { props: { badges: [], onViewAll: () => {} } });
    expect(container.innerHTML).toBe('<!---->');
  });
});
