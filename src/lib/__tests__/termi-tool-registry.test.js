/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_REGISTRY, toolNameOf, isKnowledgeTool } from '$lib/termi/tool-registry.js';
import { buildTermiTools } from '$lib/server/termi/tools.js';
import { composePrompt } from '$lib/server/termi/tasks.js';

describe('TOOL_REGISTRY', () => {
  it('has exactly the tools buildTermiTools("ask") builds (drift)', () => {
    const tools = buildTermiTools('ask', {
      mcpUrl: 'https://mcp.example/mcp',
      getToken: vi.fn(),
      callTool: vi.fn()
    });
    expect(Object.keys(tools).sort()).toEqual(Object.keys(TOOL_REGISTRY).sort());
  });

  it('every entry has a kind, a persist and a prompt hint', () => {
    for (const [name, t] of Object.entries(TOOL_REGISTRY)) {
      expect(['knowledge', 'action'], name).toContain(t.kind);
      expect(typeof t.persist, name).toBe('function');
      expect(t.promptHint.length, name).toBeGreaterThan(0);
    }
  });

  it('knowledge tools are the six search tools; show_pages is an action', () => {
    expect(Object.keys(TOOL_REGISTRY).filter(isKnowledgeTool).sort()).toEqual(
      [
        'find_community',
        'find_people',
        'search_content',
        'search_events',
        'search_passages',
        'search_resources'
      ].sort()
    );
    expect(isKnowledgeTool('show_pages')).toBe(false);
    expect(TOOL_REGISTRY.show_pages.kind).toBe('action');
    expect(isKnowledgeTool('nope')).toBe(false);
  });

  it('toolNameOf reads both part shapes', () => {
    expect(toolNameOf({ type: 'tool-find_people' })).toBe('find_people');
    expect(toolNameOf({ type: 'dynamic-tool', toolName: 'show_pages' })).toBe('show_pages');
  });

  it('show_pages persists { ids } (strings only)', () => {
    expect(TOOL_REGISTRY.show_pages.persist({ ids: ['inbox', 3, 'calendar'] })).toEqual({
      ids: ['inbox', 'calendar']
    });
  });

  it('knowledge tools persist slim items + sourcesUnavailable', () => {
    const out = TOOL_REGISTRY.search_events.persist({
      items: [{ type: 'event', id: 'e', title: 'T', date: '2026-01-01', score: 3 }],
      sourcesUnavailable: ['x', 1]
    });
    expect(out).toEqual({
      items: [{ type: 'event', id: 'e', title: 'T', start: '2026-01-01' }],
      sourcesUnavailable: ['x']
    });
  });

  it('defaultItemType covers the tools whose items may lack a type', () => {
    expect(TOOL_REGISTRY.find_community.defaultItemType).toBe('community');
    expect(TOOL_REGISTRY.find_people.defaultItemType).toBe('person');
    expect(TOOL_REGISTRY.search_events.defaultItemType).toBe('event');
    expect(TOOL_REGISTRY.search_passages.defaultItemType).toBe('passage');
  });
});

describe('ask prompt composed from registry hints', () => {
  it('is byte-identical to the pre-registry prompt', () => {
    const before = readFileSync(
      new URL('./fixtures/termi/ask-prompt.txt', import.meta.url),
      'utf-8'
    );
    expect(composePrompt('ask', { appName: 'Edufeed' })).toBe(before);
  });

  it('contains every registry prompt hint', () => {
    for (const t of Object.values(TOOL_REGISTRY))
      expect(composePrompt('ask', { appName: 'Edufeed' })).toContain(t.promptHint);
  });
});
