/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_REGISTRY, toolNameOf, isKnowledgeTool } from '$lib/termi/tool-registry.js';
import { buildTermiTools } from '$lib/server/termi/tools.js';
import { composePrompt, TERMI_TASKS } from '$lib/server/termi/tasks.js';

const DEPS = { mcpUrl: 'https://mcp.example/mcp', getToken: vi.fn(), callTool: vi.fn() };

describe('TOOL_REGISTRY', () => {
  it('every TERMI_TASKS[*].tools name is a registry entry, and every entry is used by a task', () => {
    const used = new Set(Object.values(TERMI_TASKS).flatMap((t) => t.tools));
    for (const name of used) expect(Object.hasOwn(TOOL_REGISTRY, name), name).toBe(true);
    expect([...used].sort()).toEqual(Object.keys(TOOL_REGISTRY).sort());
  });

  it.each(Object.keys(TERMI_TASKS))(
    'buildTermiTools(%s) builds exactly its task tools, optional ones only with memUrl (drift)',
    (task) => {
      const names = /** @type {any} */ (TERMI_TASKS)[task].tools;
      const full = buildTermiTools(task, { ...DEPS, memUrl: 'https://mem.example/mcp' });
      expect(Object.keys(full).sort()).toEqual([...names].sort());
      const bare = buildTermiTools(task, DEPS);
      expect(Object.keys(bare).sort()).toEqual(
        names.filter((/** @type {string} */ n) => !TOOL_REGISTRY[n].optional).sort()
      );
    }
  );

  it('propose_options.toOptions dedupes ids, caps at 8 and 80 chars, returns null for an empty list', () => {
    const { toOptions } = TOOL_REGISTRY.propose_options;
    const card = toOptions?.({
      question: 'Q'.repeat(300),
      multi: 'yes',
      options: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'again' },
        { id: 'b', label: 'L'.repeat(300), hint: 'h' },
        { id: '', label: 'no id' },
        { id: 'c' },
        ...Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, label: `X${i}` }))
      ]
    });
    expect(card?.options.map((o) => o.id)).toEqual(['a', 'b', 'x0', 'x1', 'x2', 'x3', 'x4', 'x5']);
    expect(card?.options[0].label).toBe('A');
    expect(card?.options[1].label).toHaveLength(80);
    expect(card?.options[1].hint).toBe('h');
    expect(card?.question).toHaveLength(200);
    expect(card?.multi).toBe(false);
    expect(toOptions?.({ question: 'Q', options: [] })).toBeNull();
    expect(toOptions?.(undefined)).toBeNull();
    expect(TOOL_REGISTRY.propose_options.toActions).toBeUndefined();
    expect(TOOL_REGISTRY.propose_options.kind).toBe('action');
  });

  it('lesson_state.persist drops unknown keys and clamps phase; it has no buttons', () => {
    expect(
      TOOL_REGISTRY.lesson_state.persist({ phase: 9, evil: 1, frame: { subject: 'Mathe' } })
    ).toEqual({
      phase: 7,
      frame: { subject: 'Mathe' }
    });
    expect(TOOL_REGISTRY.lesson_state.kind).toBe('action');
    expect(TOOL_REGISTRY.lesson_state.toActions).toBeUndefined();
  });

  it('curriculum tools persist slim ids/labels and only http(s) competence uris', () => {
    expect(
      TOOL_REGISTRY.find_curriculum.persist({
        curricula: [{ id: 'BY|||u', title: 'LP', state: 'BY', grades: ['4', 5], topics: [{}] }],
        sourcesUnavailable: []
      })
    ).toEqual({ curricula: [{ id: 'BY|||u', title: 'LP', state: 'BY', grades: ['4'] }] });
    expect(
      TOOL_REGISTRY.curriculum_competences.persist({
        competences: [
          { uri: 'https://w3id.org/k/1', label: 'Zählen' },
          { uri: 'javascript:alert(1)', label: 'x' }
        ]
      })
    ).toEqual({ competences: [{ uri: 'https://w3id.org/k/1', label: 'Zählen' }] });
  });

  it('search_curriculum is optional, in both tasks, and persists slim entries with http(s) uris only', () => {
    expect(TOOL_REGISTRY.search_curriculum.optional).toBe(true);
    expect(TERMI_TASKS.ask.tools).toContain('search_curriculum');
    expect(TERMI_TASKS.lesson.tools).toContain('search_curriculum');
    expect(
      TOOL_REGISTRY.search_curriculum.persist({
        entries: [
          {
            uri: 'https://w3id.org/lehrplan/resource/by/1',
            label: 'Nachhaltigkeit',
            parent: 'LB 2',
            curriculum: { uri: 'https://w3id.org/lp/1', title: 'Geographie 7' },
            state: 'Bayern',
            schoolType: 'Gymnasium',
            subject: 'Geographie',
            grade: 'Jahrgangsstufe 7'
          },
          { uri: 'javascript:alert(1)', label: 'x' }
        ],
        sourcesUnavailable: []
      })
    ).toEqual({
      entries: [
        {
          uri: 'https://w3id.org/lehrplan/resource/by/1',
          label: 'Nachhaltigkeit',
          curriculum: { title: 'Geographie 7' },
          state: 'Bayern',
          schoolType: 'Gymnasium',
          subject: 'Geographie',
          grade: 'Jahrgangsstufe 7'
        }
      ]
    });
  });

  it('every entry has a kind, a persist and a prompt hint', () => {
    for (const [name, t] of Object.entries(TOOL_REGISTRY)) {
      expect(['knowledge', 'action'], name).toContain(t.kind);
      expect(typeof t.persist, name).toBe('function');
      expect(t.promptHint.length, name).toBeGreaterThan(0);
    }
  });

  it('knowledge tools are the six search tools and the three curriculum tools; show_pages is an action', () => {
    expect(Object.keys(TOOL_REGISTRY).filter(isKnowledgeTool).sort()).toEqual(
      [
        'curriculum_competences',
        'find_curriculum',
        'search_curriculum',
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

  it("contains every ask tool's prompt hint (search_curriculum's covers find_curriculum/curriculum_competences)", () => {
    for (const name of TERMI_TASKS.ask.tools.filter(
      (n) => n !== 'find_curriculum' && n !== 'curriculum_competences'
    ))
      expect(composePrompt('ask', { appName: 'Edufeed' })).toContain(
        TOOL_REGISTRY[name].promptHint
      );
  });
});
