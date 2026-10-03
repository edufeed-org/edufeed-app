/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  agent_badge_label: () => 'Agent',
  agent_badge_title: (/** @type {{ owner: string }} */ i) => `Agent · owned by ${i.owner}`,
  agent_badge_online: () => 'online'
}));

import AgentBadge from '$lib/components/agents/AgentBadge.svelte';

const AGENT = 'b'.repeat(64);
const OWNER = 'a'.repeat(64);
const records = new Map([[AGENT, { ownerPubkey: OWNER, name: 'Lehrbot' }]]);

describe('AgentBadge', () => {
  it('marks an agent and names its owner', () => {
    render(AgentBadge, { props: { pubkey: AGENT, records, ownerName: 'Frau Muster' } });
    const badge = screen.getByText('Agent');
    expect(badge.getAttribute('title')).toBe('Agent · owned by Frau Muster');
    expect(screen.queryByLabelText('online')).toBeNull();
  });

  it('shows the online dot when online', () => {
    render(AgentBadge, {
      props: { pubkey: AGENT, records, ownerName: 'Frau Muster', online: true }
    });
    expect(screen.getByLabelText('online')).toBeTruthy();
  });

  it('renders nothing for a non-agent', () => {
    const { container } = render(AgentBadge, { props: { pubkey: OWNER, records } });
    expect(container.textContent?.trim()).toBe('');
  });
});
