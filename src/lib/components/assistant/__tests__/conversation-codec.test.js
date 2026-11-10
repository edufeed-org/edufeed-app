/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toContent,
  fromContent,
  capContent,
  generateTitle,
  fromTier1Message,
  toTier1Message,
  fromUIMessage,
  toUIMessage,
  slimOutput,
  textOf
} from '../history/conversation-codec.js';

/** @param {number} n */
const item = (n) => ({
  type: 'resource',
  id: 'naddr' + n,
  title: 'Ressource ' + n,
  description: 'x'.repeat(250),
  href: '/naddr' + n,
  pubkey: 'p'.repeat(64),
  picture: 'https://img.example/' + n + '.png',
  date: '2026-11-0' + (n % 9),
  license: 'CC BY'
});
/** @param {any[]} turns */
const conv = (turns) => ({ id: 'c1', title: 't', createdAt: 1, updatedAt: 2, turns });
const roundTrip = (/** @type {any} */ c) => fromContent(JSON.parse(JSON.stringify(toContent(c))));

describe('conversation codec', () => {
  it('tier-1 turn ↔ termi_search invocation', () => {
    const user = fromTier1Message({ role: 'user', text: 'MINT?' });
    const bot = fromTier1Message({
      role: 'assistant',
      text: 'Gefunden:',
      items: [item(1), item(2), item(3)],
      sourcesUnavailable: ['sodix']
    });
    const content = toContent(conv([user, bot]));
    const inv = /** @type {any} */ (content.messages[1].toolInvocations)[0];
    expect(inv.toolName).toBe('termi_search');
    expect(inv.output.items).toHaveLength(3);
    expect(inv.output.items[0]).not.toHaveProperty('description');

    const back = fromContent(JSON.parse(JSON.stringify(content)));
    expect(back.turns.map((t) => t.tier)).toEqual([1, 1]);
    const msg = /** @type {any} */ (toTier1Message(back.turns[1], 't2'));
    expect(msg).toMatchObject({
      id: 't2',
      role: 'assistant',
      tier: 1,
      text: 'Gefunden:',
      sourcesUnavailable: ['sodix']
    });
    expect(msg.items[0]).toMatchObject({ id: 'naddr1', href: '/naddr1', date: '2026-11-01' });
    expect(toTier1Message(back.turns[0], 't1')).toEqual({
      id: 't1',
      role: 'user',
      tier: 1,
      text: 'MINT?'
    });
  });

  it('a stored tier-2 answer reads back as a tier-1 window turn: cards, first real query, page ids', () => {
    const t = toTier1Message({
      role: 'assistant',
      text: 'Treffer.',
      tier: 2,
      toolParts: [
        {
          type: 'dynamic-tool',
          toolName: 'find_people',
          toolCallId: 'a',
          state: 'output-available',
          input: { name: 'Anna' },
          output: { items: [], sourcesUnavailable: ['x'] }
        },
        {
          type: 'dynamic-tool',
          toolName: 'search_content',
          toolCallId: 'b',
          state: 'output-available',
          input: { query: 'Brüche' },
          output: {
            items: [{ type: 'resource', id: 'r', title: 'R', start: '2026-01-01' }],
            sourcesUnavailable: ['x', 'y']
          }
        },
        {
          type: 'dynamic-tool',
          toolName: 'show_pages',
          toolCallId: 'c',
          state: 'output-available',
          output: { ids: ['inbox'] }
        }
      ]
    });
    expect(t).toEqual({
      role: 'assistant',
      tier: 1,
      text: 'Treffer.',
      items: [{ type: 'resource', id: 'r', title: 'R', date: '2026-01-01' }],
      sourcesUnavailable: ['x', 'y'],
      query: 'Brüche',
      pageIds: ['inbox']
    });
  });

  it('tier-2 tool-search_content part round-trips as a dynamic-tool part', () => {
    const ui = {
      id: 'm2',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-search_content',
          toolCallId: 'call1',
          state: 'output-available',
          input: { query: 'MINT' },
          output: { items: [item(1)], sourcesUnavailable: [] }
        },
        { type: 'tool-unknown', toolCallId: 'x', state: 'output-available', input: {}, output: {} },
        { type: 'text', text: 'Hier ist was.' }
      ]
    };
    const user = fromUIMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'MINT' }] });
    const back = roundTrip(conv([user, fromUIMessage(ui)]));
    expect(back.turns.map((t) => t.tier)).toEqual([2, 2]);
    const restored = toUIMessage(back.turns[1], 'm2');
    expect(restored.parts).toHaveLength(2);
    expect(restored.parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'search_content',
      toolCallId: 'call1',
      state: 'output-available',
      input: { query: 'MINT' }
    });
    expect(/** @type {any} */ (restored.parts[0]).output.items[0].id).toBe('naddr1');
    expect(restored.parts[1]).toEqual({ type: 'text', text: 'Hier ist was.' });
  });

  it('fromUIMessage copies a tool input instead of keeping the live object', () => {
    const input = { query: 'MINT' };
    const turn = fromUIMessage({
      role: 'assistant',
      parts: [
        {
          type: 'tool-search_content',
          toolCallId: 'c',
          state: 'output-available',
          input,
          output: { items: [], sourcesUnavailable: [] }
        }
      ]
    });
    const stored = /** @type {any} */ (turn.toolParts)[0].input;
    expect(stored).toEqual({ query: 'MINT' });
    expect(stored).not.toBe(input);
  });

  it('keeps show_pages ids', () => {
    const ui = {
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'show_pages',
          toolCallId: 'c',
          state: 'output-available',
          input: { ids: ['nav-settings'] },
          output: { ids: ['nav-settings'] }
        }
      ]
    };
    const back = roundTrip(conv([fromUIMessage(ui)]));
    expect(back.turns[0].toolParts?.[0].output).toEqual({ ids: ['nav-settings'] });
  });

  it('drops unsafe hrefs on restore', () => {
    const content = toContent(
      conv([fromTier1Message({ role: 'assistant', text: '', items: [item(1)] })])
    );
    const inv = /** @type {any} */ (content.messages[0].toolInvocations)[0];
    inv.output.items.push(
      { type: 'resource', id: 'a', title: 'a', href: 'javascript:alert(1)' },
      { type: 'resource', id: 'b', title: 'b', href: '//evil.example' },
      { type: 'resource', id: 'c', title: 'c', href: 'https://ok.example/x' }
    );
    const items = fromContent(content).turns[0].items ?? [];
    expect(items.map((i) => i.href)).toEqual([
      '/naddr1',
      undefined,
      undefined,
      'https://ok.example/x'
    ]);
  });

  it('chat-bot tool calls stay text-only on restore', () => {
    const inv = (/** @type {string} */ toolName, /** @type {string} */ state, output = {}) => ({
      toolCallId: toolName + state,
      toolName,
      state,
      input: {},
      output
    });
    const chatBot = {
      id: 'cb',
      title: 'Chat-bot',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { id: '1', role: 'user', content: 'Termin eintragen' },
        {
          id: '2',
          role: 'assistant',
          content: 'Hier der Vorschlag.',
          toolInvocations: [
            inv('fetch_url', 'output-available', { text: 'x' }),
            inv('propose_calendar_event', 'output-available'),
            inv('search_content', 'input-available'),
            inv('search_content', 'output-error'),
            { toolCallId: 'e', toolName: 'search_events', state: 'output-available', input: {} }
          ]
        }
      ]
    };
    const restored = fromContent(chatBot);
    // the knowledge call without output reads as lost sources (no document actions)
    expect(restored.turns[1]).toEqual({
      role: 'assistant',
      text: 'Hier der Vorschlag.',
      tier: 2,
      sourcesLost: true
    });
    expect(toUIMessage(restored.turns[1], '2').parts).toEqual([
      { type: 'text', text: 'Hier der Vorschlag.' }
    ]);
  });

  it('capContent fits 15 eight-card turns into 28 KB of UTF-8 and keeps every text', () => {
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push(fromTier1Message({ role: 'user', text: 'Frage ' + i }));
      turns.push(
        fromTier1Message({
          role: 'assistant',
          text: 'Antwort ' + i,
          items: Array.from({ length: 8 }, (_, n) => ({
            ...item(n),
            title: 'Ü'.repeat(200), // two bytes each: bytes, not characters, are capped
            location: 'L'.repeat(100)
          }))
        })
      );
    }
    const bytes = (/** @type {unknown} */ v) => new TextEncoder().encode(JSON.stringify(v)).length;
    const content = toContent(conv(turns));
    const before = JSON.stringify(content).length;
    expect(bytes(content)).toBeGreaterThan(28 * 1024);
    const capped = capContent(content);
    expect(bytes(capped)).toBeLessThanOrEqual(28 * 1024);
    expect(JSON.stringify(capped).length).toBeLessThan(bytes(capped));
    expect(capped.messages.map((m) => m.content)).toEqual(content.messages.map((m) => m.content));
    // oldest outputs dropped, newest kept; the input is not mutated
    expect(capped.messages[1].toolInvocations?.[0].output).toBeUndefined();
    expect(capped.messages.at(-1)?.toolInvocations?.[0].output).toBeDefined();
    expect(JSON.stringify(content).length).toBe(before);
  });

  it('stored items keep their attribution (creator, publisher, licence, licence/source URLs)', () => {
    const attributed = {
      ...item(1),
      creator: 'Anna',
      publisher: 'HU',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://example.org/a'
    };
    const bot = fromTier1Message({ role: 'assistant', text: 'x', items: [attributed] });
    const back = roundTrip(conv([bot]));
    expect(back.turns[0].items?.[0]).toMatchObject({
      creator: 'Anna',
      publisher: 'HU',
      license: 'CC BY',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://example.org/a'
    });
  });

  it('capContent shrinks items to attribution fields before dropping any output', () => {
    const turns = [];
    for (let i = 0; i < 3; i++) {
      turns.push(
        fromTier1Message({
          role: 'assistant',
          text: 'Antwort ' + i,
          items: Array.from({ length: 8 }, (_, n) => ({
            ...item(n),
            location: 'L'.repeat(150),
            sourceUrl: 'https://example.org/' + n
          }))
        })
      );
    }
    const content = toContent(conv(turns));
    const bytes = (/** @type {unknown} */ v) => new TextEncoder().encode(JSON.stringify(v)).length;
    const capped = capContent(content, bytes(content) - 1000);
    // every output kept; the oldest turn's items shrunk to their attribution
    for (const m of capped.messages) expect(m.toolInvocations?.[0].output?.items).toHaveLength(8);
    expect(Object.keys(capped.messages[0].toolInvocations?.[0].output.items[0]).sort()).toEqual(
      ['type', 'id', 'title', 'href', 'license', 'sourceUrl'].sort()
    );
    expect(capped.messages[2].toolInvocations?.[0].output.items[0]).toHaveProperty('location');
  });

  it('a turn whose knowledge outputs were dropped is marked sourcesLost, and stays so', () => {
    const t1 = fromTier1Message({ role: 'assistant', text: '# Doc', items: [item(1)] });
    const t2 = fromUIMessage({
      role: 'assistant',
      parts: [
        {
          type: 'tool-search_passages',
          toolCallId: 'c',
          state: 'output-available',
          input: { question: 'q' },
          output: { items: [item(2)], sourcesUnavailable: [] }
        },
        { type: 'text', text: '# Doc 2' }
      ]
    });
    const content = toContent(conv([t1, t2]));
    for (const m of content.messages) for (const inv of m.toolInvocations ?? []) delete inv.output;
    const back = fromContent(JSON.parse(JSON.stringify(content)));
    expect(back.turns.map((t) => t.sourcesLost)).toEqual([true, true]);
    // re-saved as tier 1 (window message → turn), the mark survives another round trip
    const again = roundTrip(conv([fromTier1Message(toTier1Message(back.turns[1]))]));
    expect(again.turns[0].sourcesLost).toBe(true);
    expect(
      fromContent(toContent(conv([fromTier1Message({ role: 'assistant', text: 'x' })]))).turns[0]
    ).not.toHaveProperty('sourcesLost');
  });

  it('generateTitle cuts at a word boundary with …', () => {
    const text = 'ich suche nach Infos zum Thema gendersensibler MINT Unterricht, gibt es da was?';
    const title = generateTitle(text);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(51);
    expect(text.startsWith(title.slice(0, -1))).toBe(true);
    // the cut lands between words
    expect([' ', ',']).toContain(text[title.length - 1]);
    expect(generateTitle('  kurz  ')).toBe('kurz');
  });
});

describe('a document turn keeps its LiaScript draft naddr', () => {
  const NADDR = 'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk';

  it('tier 1 and tier 2 round-trip it as a plain string', () => {
    const t1 = fromTier1Message({
      role: 'assistant',
      text: '# Doc',
      artifacts: { draftNaddr: NADDR }
    });
    const t2 = fromUIMessage({
      id: 'x',
      role: 'assistant',
      parts: [{ type: 'text', text: '# Doc' }],
      metadata: { artifacts: { draftNaddr: NADDR } }
    });
    expect(t2.artifacts).toEqual({ draftNaddr: NADDR });
    const content = toContent(conv([{ role: 'user', text: 'q', tier: 1 }, t1, t2]));
    // the stored (chat-bot) shape is unchanged: the naddr at the message's top level
    expect(content.messages.map((x) => x.draftNaddr)).toEqual([undefined, NADDR, NADDR]);
    const back = fromContent(JSON.parse(JSON.stringify(content)));
    expect(back.turns[1].artifacts).toEqual({ draftNaddr: NADDR });
    expect(back.turns[2].artifacts).toEqual({ draftNaddr: NADDR });
    expect(toTier1Message(back.turns[1]).artifacts).toEqual({ draftNaddr: NADDR });
    expect(toUIMessage(back.turns[2], 'id').metadata).toEqual({ artifacts: { draftNaddr: NADDR } });
    expect(fromUIMessage(toUIMessage(back.turns[2], 'id')).artifacts).toEqual({
      draftNaddr: NADDR
    });
  });

  it('anything but an naddr is dropped on restore', () => {
    const json = {
      messages: [{ id: 'a', role: 'assistant', content: 'x', draftNaddr: 'javascript:alert(1)' }]
    };
    expect(fromContent(json).turns[0].artifacts).toBeUndefined();
    expect(
      fromUIMessage({ role: 'assistant', parts: [], metadata: { artifacts: { draftNaddr: 'x' } } })
        .artifacts
    ).toBeUndefined();
  });
});

describe('the stored format (golden)', () => {
  it('a tier-1 turn, a tier-2 turn and an import serialise exactly as before', () => {
    const NADDR = 'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk';
    const turns = [
      fromTier1Message({ id: 't1', role: 'user', text: 'Brüche?' }),
      fromTier1Message({
        id: 't2',
        role: 'assistant',
        text: 'Hier entlang:',
        query: 'Brüche',
        items: [{ type: 'resource', id: 'r1', title: 'R1', href: '/r1', date: '2026-11-01' }],
        sourcesUnavailable: ['sodix'],
        artifacts: { draftNaddr: NADDR }
      }),
      fromUIMessage({ id: 'u3', role: 'user', parts: [{ type: 'text', text: 'Mehr' }] }),
      fromUIMessage({
        id: 'a4',
        role: 'assistant',
        metadata: { artifacts: { draftNaddr: NADDR } },
        parts: [
          {
            type: 'tool-search_content',
            toolCallId: 'k1',
            state: 'output-available',
            input: { query: 'Brüche' },
            output: { items: [{ type: 'resource', id: 'r2', title: 'R2' }], sourcesUnavailable: [] }
          },
          { type: 'text', text: 'Zwei Treffer.' }
        ]
      }),
      // an import, as turnsNow records it once published
      { role: 'user', text: 'Importiere plan.xlsx', tier: 1 },
      { role: 'assistant', text: '1 Termin aus plan.xlsx veröffentlicht', tier: 1 }
    ];
    expect(toContent(/** @type {any} */ (conv(turns)))).toMatchInlineSnapshot(`
      {
        "createdAt": 1,
        "id": "c1",
        "messages": [
          {
            "content": "Brüche?",
            "id": "c1-0",
            "role": "user",
          },
          {
            "content": "Hier entlang:",
            "draftNaddr": "naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk",
            "id": "c1-1",
            "role": "assistant",
            "toolInvocations": [
              {
                "input": {},
                "output": {
                  "items": [
                    {
                      "href": "/r1",
                      "id": "r1",
                      "start": "2026-11-01",
                      "title": "R1",
                      "type": "resource",
                    },
                  ],
                  "sourcesUnavailable": [
                    "sodix",
                  ],
                },
                "state": "output-available",
                "toolCallId": "c1-1-search",
                "toolName": "termi_search",
              },
            ],
          },
          {
            "content": "Mehr",
            "id": "c1-2",
            "role": "user",
          },
          {
            "content": "Zwei Treffer.",
            "draftNaddr": "naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk",
            "id": "c1-3",
            "role": "assistant",
            "toolInvocations": [
              {
                "input": {
                  "query": "Brüche",
                },
                "output": {
                  "items": [
                    {
                      "id": "r2",
                      "title": "R2",
                      "type": "resource",
                    },
                  ],
                  "sourcesUnavailable": [],
                },
                "state": "output-available",
                "toolCallId": "k1",
                "toolName": "search_content",
              },
            ],
          },
          {
            "content": "Importiere plan.xlsx",
            "id": "c1-4",
            "role": "user",
          },
          {
            "content": "1 Termin aus plan.xlsx veröffentlicht",
            "id": "c1-5",
            "role": "assistant",
            "toolInvocations": [
              {
                "input": {},
                "output": {
                  "items": [],
                  "sourcesUnavailable": [],
                },
                "state": "output-available",
                "toolCallId": "c1-5-search",
                "toolName": "termi_search",
              },
            ],
          },
        ],
        "title": "t",
        "updatedAt": 2,
      }
    `);
  });
});

describe('the conversation task', () => {
  const turns = [{ role: 'user', text: 'Unterrichtsreihe Brüche', tier: 2 }];

  it('a lesson conversation stores task at the top level and reads it back', () => {
    const content = toContent(/** @type {any} */ ({ ...conv(turns), task: 'lesson' }));
    expect(content.task).toBe('lesson');
    expect(Object.keys(content)).toEqual([
      'id',
      'title',
      'createdAt',
      'updatedAt',
      'task',
      'messages'
    ]);
    expect(roundTrip({ ...conv(turns), task: 'lesson' }).task).toBe('lesson');
  });

  it('an ask conversation writes no task; missing or unknown values read as ask', () => {
    expect(toContent(/** @type {any} */ ({ ...conv(turns), task: 'ask' }))).not.toHaveProperty(
      'task'
    );
    expect(roundTrip(conv(turns)).task).toBe('ask');
    expect(fromContent({ messages: [], task: 'admin' }).task).toBe('ask');
    expect(fromContent({ messages: [], task: ['lesson'] }).task).toBe('ask');
  });
});

describe('textOf', () => {
  it('joins the text parts of a multi-step answer as paragraphs, not glued together', () => {
    // one text part per step: "Ich suche erst…" before the tool call, the answer after it
    const msg = {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Gerne! Ich sammle zuerst passende Quellen.' },
        {
          type: 'dynamic-tool',
          toolName: 'search_passages',
          state: 'output-available',
          output: {}
        },
        { type: 'text', text: 'Hier ist deine Zusammenfassung:' }
      ]
    };
    expect(textOf(msg)).toBe(
      'Gerne! Ich sammle zuerst passende Quellen.\n\nHier ist deine Zusammenfassung:'
    );
    expect(textOf({ role: 'assistant', parts: [{ type: 'text', text: 'nur eins' }] })).toBe(
      'nur eins'
    );
    expect(textOf({ role: 'assistant', parts: [] })).toBe('');
  });
});

describe('slimOutput', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('show_pages persists { ids }', () => {
    expect(slimOutput('show_pages', { ids: ['inbox'], extra: 1 })).toEqual({ ids: ['inbox'] });
  });

  it('a knowledge tool persists slim items', () => {
    expect(slimOutput('find_people', { items: [] })).toEqual({ items: [], sourcesUnavailable: [] });
  });

  it('termi_search (tier 1) persists slim items', () => {
    expect(slimOutput('termi_search', { items: [item(1)] })?.items?.[0]).toMatchObject({
      id: 'naddr1',
      start: '2026-11-01'
    });
  });

  it('a non-object output stays undefined', () => {
    expect(slimOutput('search_content', null)).toBeUndefined();
  });

  it('an unknown tool throws in DEV', () => {
    vi.stubEnv('DEV', true);
    expect(() => slimOutput('publish_draft', { draft: {} })).toThrow(/publish_draft/);
  });

  it('an unknown tool is dropped with a warning in prod', () => {
    vi.stubEnv('DEV', false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(slimOutput('publish_draft', { draft: {} })).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('lesson state and materials', () => {
  const bytes = (/** @type {unknown} */ v) => new TextEncoder().encode(JSON.stringify(v)).length;
  const lesson = {
    phase: 3,
    frame: { subject: 'Mathematik', grade: 4 },
    competences: [{ uri: 'https://w3id.org/lehrplan/x', label: 'Brüche deuten' }],
    didactics: {},
    plan: [],
    parts: { lessons: [] }
  };

  it('lesson and materials round-trip; an ask conversation writes neither', () => {
    const turns = [fromTier1Message({ role: 'user', text: 'Reihe' })];
    const c = {
      ...conv(turns),
      task: 'lesson',
      lesson,
      materials: [{ name: 'a.pdf', text: 'Text' }]
    };
    const back = roundTrip(c);
    expect(back.lesson).toEqual(lesson);
    expect(back.materials).toEqual([{ name: 'a.pdf', text: 'Text' }]);
    const plain = toContent(conv(turns));
    expect(plain).not.toHaveProperty('lesson');
    expect(plain).not.toHaveProperty('materials');
    expect(fromContent(plain)).not.toHaveProperty('lesson');
  });

  it('a merged ~4.5 KB state (12 competences, 8-lesson plan, 8 parts) round-trips and renders', async () => {
    const { bigLessonState } = await import(
      '../../../__tests__/fixtures/termi/big-lesson-state.js'
    );
    const { renderLessonState } = await import('$lib/termi/lesson-state.js');
    const state = bigLessonState();
    expect(bytes(state)).toBeGreaterThan(4 * 1024);
    const back = roundTrip({ ...conv([]), task: 'lesson', lesson: state });
    expect(back.lesson).toEqual(state);
    expect(renderLessonState(back.lesson, 'de')).toContain('Phase 5 von 7');
  });

  it('fromContent sanitizes a tampered lesson object and caps materials', () => {
    const back = fromContent({
      id: 'c',
      messages: [],
      task: 'lesson',
      lesson: { phase: 9, evil: 'x', competences: 'nope', publication: 'javascript:alert(1)' },
      materials: [
        { name: 'a', text: 'a' },
        { name: 'b', text: 1 },
        { name: 'c', text: 'c' },
        { name: 'd', text: 'd' },
        { name: 'e', text: 'e' }
      ]
    });
    expect(back.lesson?.phase).toBe(7);
    expect(back.lesson).not.toHaveProperty('evil');
    expect(back.lesson?.competences).toEqual([]);
    expect(back.lesson).not.toHaveProperty('publication');
    expect(back.materials?.map((m) => m.name)).toEqual(['c', 'd', 'e']);
    const one = fromContent({
      id: 'c',
      messages: [],
      materials: [{ name: '  a\n b ', text: 'x'.repeat(20_000) }]
    });
    expect(one.materials).toEqual([{ name: 'a b', text: 'x'.repeat(15_000) }]);
    expect(fromContent({ id: 'c', messages: [], lesson: 'x' })).not.toHaveProperty('lesson');
  });

  it('capContent trims materials text before dropping tool outputs; the state stays', () => {
    const turns = [
      fromTier1Message({ role: 'user', text: 'Reihe' }),
      fromTier1Message({ role: 'assistant', text: 'Antwort', items: [item(1)] })
    ];
    const content = toContent({
      ...conv(turns),
      task: 'lesson',
      lesson,
      materials: [
        { name: 'a', text: 'a'.repeat(15_000) },
        { name: 'b', text: 'b'.repeat(15_000) }
      ]
    });
    const capped = capContent(content, 10 * 1024);
    expect(bytes(capped)).toBeLessThanOrEqual(10 * 1024);
    expect(capped.materials?.map((m) => m.text.length)).toEqual([2000, 2000]);
    expect(capped.messages[1].toolInvocations?.[0].output).toBeDefined();
    expect(capped.lesson).toEqual(lesson);
  });
});
