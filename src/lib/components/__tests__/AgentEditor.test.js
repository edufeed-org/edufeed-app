// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// A Proxy-based catch-all factory (`new Proxy({}, {get: ...})`) crashes this
// project's vitest (v4.1.5) module runner at collection time — "Cannot
// create proxy with a non-object as target or handler" — before any test
// even runs; a minimal repro (`vi.mock(id, () => new Proxy({}, {get: (_t,
// key) => (params) => ...}))`) reproduces it with no component involved.
// Every other paraglide mock in this codebase (e.g. AgentBadge.test.js) uses
// a plain object of explicit keys instead, so this does the same — same
// key:params-echoing behaviour the Proxy would have produced, just as
// concrete, enumerable properties the module runner can snapshot.
vi.mock('$lib/paraglide/messages', () => {
  const keys = [
    'agents_editor_name',
    'agents_editor_error_name',
    'agents_editor_picture',
    'agents_editor_instructions',
    'agents_editor_runtime',
    'agents_editor_runtime_claude',
    'agents_editor_runtime_codex',
    'agents_editor_runtime_own_key',
    'agents_editor_respond_to',
    'agents_editor_respond_owner',
    'agents_editor_respond_members',
    'agents_editor_groups',
    'agents_editor_groups_none',
    'agents_editor_group_loading',
    'agents_editor_cancel',
    'agents_editor_save'
  ];
  /** @type {Record<string, (params?: any) => string>} */
  const messages = {};
  for (const key of keys) {
    messages[key] = (/** @type {any} */ params) =>
      params ? `${key}:${JSON.stringify(params)}` : key;
  }
  return messages;
});

import AgentEditor from '$lib/components/agents/AgentEditor.svelte';

const AGENT = 'b'.repeat(64);
const groups = [
  {
    id: 'g1',
    relay: 'wss://groups.example',
    key: 'g1@wss://groups.example/',
    name: 'Klasse 7b',
    isAdmin: true,
    loaded: true,
    members: new Set()
  },
  {
    id: 'g2',
    relay: 'wss://groups.example',
    key: 'g2@wss://groups.example/',
    name: 'Lehrerzimmer',
    isAdmin: false,
    loaded: true,
    members: new Set()
  },
  {
    id: 'g3',
    relay: 'wss://groups.example',
    key: 'g3@wss://groups.example/',
    name: 'Loading…',
    isAdmin: false,
    loaded: false,
    members: new Set()
  }
];

describe('AgentEditor', () => {
  it('offers only administered groups as checkboxes, shows loading rows, hides non-admin groups', () => {
    render(AgentEditor, {
      props: { agentPubkey: AGENT, groups, onSave: vi.fn(), onCancel: vi.fn() }
    });
    expect(screen.getByLabelText('Klasse 7b')).toBeTruthy();
    expect(screen.queryByText('Lehrerzimmer')).toBeNull();
    expect(screen.getByText('agents_editor_group_loading')).toBeTruthy();
  });

  it('refuses to save without a usable name', async () => {
    const onSave = vi.fn();
    render(AgentEditor, { props: { agentPubkey: AGENT, groups, onSave, onCancel: vi.fn() } });
    await fireEvent.input(screen.getByLabelText('agents_editor_name'), {
      target: { value: '!!!' }
    });
    await fireEvent.click(screen.getByText('agents_editor_save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('agents_editor_error_name')).toBeTruthy();
  });

  it('saves a validated draft with the selected groups', async () => {
    const onSave = vi.fn(async () => {});
    render(AgentEditor, { props: { agentPubkey: AGENT, groups, onSave, onCancel: vi.fn() } });
    await fireEvent.input(screen.getByLabelText('agents_editor_name'), {
      target: { value: 'Lehrbot' }
    });
    await fireEvent.click(screen.getByLabelText('Klasse 7b'));
    await fireEvent.click(screen.getByText('agents_editor_save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const draft = onSave.mock.calls[0][0];
    expect(draft.persona).toMatchObject({
      slug: 'lehrbot',
      displayName: 'Lehrbot',
      runtime: 'claude',
      respondTo: 'owner-only'
    });
    expect(draft.addToGroups).toEqual([{ id: 'g1', relay: 'wss://groups.example' }]);
    expect(draft.removeFromGroups).toEqual([]);
  });

  it("computes removals against the agent's current membership when editing", async () => {
    const onSave = vi.fn(async () => {});
    const inG1 = groups.map((g) => (g.id === 'g1' ? { ...g, members: new Set([AGENT]) } : g));
    const initial = {
      agentPubkey: AGENT,
      ownerPubkey: 'a'.repeat(64),
      name: 'Lehrbot',
      respondTo: 'anyone',
      persona: {
        slug: 'lehrbot',
        displayName: 'Lehrbot',
        systemPrompt: 'x',
        runtime: 'codex',
        avatarUrl: null,
        respondTo: 'anyone'
      },
      recordEvent: null,
      personaEvent: null
    };
    render(AgentEditor, {
      props: { agentPubkey: AGENT, initial, groups: inG1, onSave, onCancel: vi.fn() }
    });
    await fireEvent.click(screen.getByLabelText('Klasse 7b')); // was checked → uncheck
    await fireEvent.click(screen.getByText('agents_editor_save'));
    expect(onSave.mock.calls[0][0].removeFromGroups).toEqual([
      { id: 'g1', relay: 'wss://groups.example' }
    ]);
    expect(onSave.mock.calls[0][0].persona.runtime).toBe('codex');
  });
});
