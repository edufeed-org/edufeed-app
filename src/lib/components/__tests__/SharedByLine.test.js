/**
 * SharedByLine Component Tests
 *
 * Tests for displaying single and multiple sharers with profile lookup.
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

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (/** @type {any} */ profile) => profile?.name || null
}));

vi.mock('$lib/paraglide/messages', () => ({
  community_shared_label: (/** @type {{ name: string }} */ params) => `${params.name} shared`,
  community_shared_multiple_suffix: () => 'shared',
  community_shared_multiple_overflow: (/** @type {{ count: number }} */ params) =>
    `and ${params.count} more shared`,
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

describe('SharedByLine', () => {
  it('renders single sharer name when given one sharer with profile', () => {
    const profiles = new Map([[pk1, { name: 'Alice' }]]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1], authorProfiles: profiles }
    });

    expect(container.textContent).toContain('Alice shared');
  });

  it('renders two sharer names joined with ampersand', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2], authorProfiles: profiles }
    });

    expect(container.textContent).toContain('Alice');
    expect(container.textContent).toContain('&');
    expect(container.textContent).toContain('Bob');
    expect(container.textContent).toContain('shared');
  });

  it('renders "and N more shared" when given 3+ sharers', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }],
      [pk3, { name: 'Charlie' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2, pk3], authorProfiles: profiles }
    });

    expect(container.textContent).toContain('Alice');
    expect(container.textContent).toContain('Bob');
    expect(container.textContent).toContain('and 1 more shared');
  });

  it('falls back to truncated pubkey when profile not found', () => {
    const profiles = new Map();

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1], authorProfiles: profiles }
    });

    expect(container.textContent).toContain('aaaa1111...');
  });

  it('renders profile link for single sharer', () => {
    const profiles = new Map([[pk1, { name: 'Alice' }]]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1], authorProfiles: profiles }
    });

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toContain(pk1);
  });

  it('renders profile links for multiple sharers', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2], authorProfiles: profiles }
    });

    const links = container.querySelectorAll('a');
    expect(links.length).toBe(2);
    expect(links[0].getAttribute('href')).toContain(pk1);
    expect(links[1].getAttribute('href')).toContain(pk2);
  });

  it('renders overflow text inside HoverCard trigger for 3+ sharers', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }],
      [pk3, { name: 'Charlie' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2, pk3], authorProfiles: profiles }
    });

    const trigger = container.querySelector('[data-testid="hovercard-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain('and 1 more shared');
  });

  it('hover card content shows header with total sharer count', () => {
    const profiles = new Map([
      [pk1, { name: 'Alice' }],
      [pk2, { name: 'Bob' }],
      [pk3, { name: 'Charlie' }]
    ]);

    const { container } = render(SharedByLine, {
      props: { sharers: [pk1, pk2, pk3], authorProfiles: profiles }
    });

    const content = container.querySelector('[data-testid="hovercard-content"]');
    expect(content).not.toBeNull();
    expect(content.textContent).toContain('Shared by 3 people');
  });
});
