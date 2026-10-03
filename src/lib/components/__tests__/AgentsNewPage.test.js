/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';

// Same reasoning as AgentEditor.test.js: a Proxy-based catch-all factory
// (`new Proxy({}, {get: ...})`) crashes this project's vitest (v4.1.5)
// module runner at collection time ("Cannot create proxy with a non-object
// as target or handler") before any test runs. Use explicit keys instead,
// same as AgentBadge.test.js / AgentEditor.test.js.
vi.mock('$lib/paraglide/messages', () => ({
  agents_editor_title: () => 'agents_editor_title',
  agents_disabled: () => 'agents_disabled',
  agents_editor_error_agent: () => 'agents_editor_error_agent',
  agents_editor_agent_id: (/** @type {{id: string}} */ i) => `agents_editor_agent_id:${i.id}`,
  agents_editor_name: () => 'agents_editor_name'
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$app/state', () => ({
  page: { url: new URL('http://x/c/agents/new?agent=' + 'b'.repeat(64)), params: {} }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { agents: { enabled: false } },
  configReady: readable(true)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'a'.repeat(64) })
}));
vi.mock('$lib/agents/my-agents.svelte.js', () => ({ useMyAgents: () => () => [] }));
vi.mock('$lib/agents/admin-groups.svelte.js', () => ({
  useAdminGroups: () => () => ({ groups: [], loading: false })
}));
vi.mock('$lib/agents/agent-publish.js', () => ({ publishAgent: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));

import AgentsNewPage from '../../../routes/c/(dashboard)/agents/new/+page.svelte';

describe('agents/new page', () => {
  it('shows the disabled message instead of the editor when the feature flag is off', () => {
    render(AgentsNewPage);
    expect(screen.getByText('agents_disabled')).toBeTruthy();
    expect(screen.queryByLabelText('agents_editor_name')).toBeNull();
  });
});
