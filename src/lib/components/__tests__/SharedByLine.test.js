/**
 * SharedByLine Component Tests
 *
 * Tests for displaying stacked avatars with compact shared label.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

import SharedByLine from '../shared/SharedByLine.svelte';

// --- Mocks ---

vi.mock('$lib/components/icons', () => ({
  RepostIcon: function StubComponent() {}
}));

vi.mock('../shared/ProfileAvatar.svelte', () => ({
  default: function StubProfileAvatar() {}
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('$lib/paraglide/messages', () => ({
  community_shared_multiple_suffix: () => 'shared',
  community_shared_all_label: (/** @type {{ count: number }} */ params) =>
    `Shared by ${params.count} people`
}));

// Stub useUserProfile since ProfileCard uses it
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  hexToNpub: (/** @type {string} */ hex) => `npub${hex.slice(0, 8)}`
}));

vi.mock('../shared/ProfileCard.svelte', () => ({
  default: function StubProfileCard() {}
}));

vi.mock('../shared/HoverCard.svelte', async () => {
  const mock = await import('./__mocks__/HoverCardMock.svelte');
  return { default: mock.default };
});

const pk1 = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222';
const pk2 = 'bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333';
const pk3 = 'cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333dddd4444';
const pk4 = 'dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333dddd4444eeee5555';

describe('SharedByLine', () => {
  it('renders "shared" suffix for single sharer', () => {
    const profiles = new Map([[pk1, { name: 'Alice' }]]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1], authorProfiles: profiles }
    });

    expect(container.textContent).toContain('shared');
  });

  it('does not render individual names inline', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2], authorProfiles: profiles }
    });

    expect(container.textContent).not.toContain('Alice');
    expect(container.textContent).not.toContain('Bob');
    expect(container.textContent).toContain('shared');
  });

  it('shows up to 3 avatars without overflow for 3 sharers', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }],
      [pk3, { name: 'Charlie' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2, pk3], authorProfiles: profiles }
    });

    // No +N pill when exactly 3 sharers (MAX_SHOWN = 3)
    expect(container.textContent).not.toContain('+');
    expect(container.textContent).toContain('shared');
  });

  it('renders +N pill inside HoverCard for 4+ sharers', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }],
      [pk3, { name: 'Charlie' }],
      [pk4, { name: 'Dave' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2, pk3, pk4], authorProfiles: profiles }
    });

    const trigger = container.querySelector('[data-testid="hovercard-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain('+1');
  });

  it('hover card content shows header with total sharer count', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }],
      [pk3, { name: 'Charlie' }],
      [pk4, { name: 'Dave' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2, pk3, pk4], authorProfiles: profiles }
    });

    const content = container.querySelector('[data-testid="hovercard-content"]');
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain('Shared by 4 people');
  });

  it('applies negative margin for stacked avatar overlap', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2], authorProfiles: profiles }
    });

    const avatarWrappers = container.querySelectorAll('[style*="z-index"]');
    expect(avatarWrappers.length).toBe(2);
    // Second avatar should have negative margin class
    expect(avatarWrappers[1].className).toContain('-ml-1.5');
    // First avatar should not
    expect(avatarWrappers[0].className).not.toContain('-ml-1.5');
  });
});
