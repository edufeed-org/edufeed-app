/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  toContent,
  fromContent,
  capContent,
  generateTitle,
  fromTier1Message,
  toTier1Message,
  fromUIMessage,
  toUIMessage
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
      role: 'bot',
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
    const msg = /** @type {any} */ (toTier1Message(back.turns[1]));
    expect(msg).toMatchObject({ role: 'bot', text: 'Gefunden:', sourcesUnavailable: ['sodix'] });
    expect(msg.items[0]).toMatchObject({ id: 'naddr1', href: '/naddr1', date: '2026-11-01' });
    expect(toTier1Message(back.turns[0])).toEqual({ role: 'user', text: 'MINT?' });
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
      conv([fromTier1Message({ role: 'bot', text: '', items: [item(1)] })])
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
          role: 'bot',
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
    const bot = fromTier1Message({ role: 'bot', text: 'x', items: [attributed] });
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
          role: 'bot',
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
    const t1 = fromTier1Message({ role: 'bot', text: '# Doc', items: [item(1)] });
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
      fromContent(toContent(conv([fromTier1Message({ role: 'bot', text: 'x' })]))).turns[0]
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
    const t1 = fromTier1Message({ role: 'bot', text: '# Doc', draftNaddr: NADDR });
    const t2 = fromUIMessage({
      id: 'x',
      role: 'assistant',
      parts: [{ type: 'text', text: '# Doc' }],
      metadata: { draftNaddr: NADDR }
    });
    const back = roundTrip(conv([{ role: 'user', text: 'q', tier: 1 }, t1, t2]));
    expect(back.turns[1].draftNaddr).toBe(NADDR);
    expect(back.turns[2].draftNaddr).toBe(NADDR);
    expect(toTier1Message(back.turns[1]).draftNaddr).toBe(NADDR);
    expect(toUIMessage(back.turns[2], 'id').metadata).toEqual({ draftNaddr: NADDR });
  });

  it('anything but an naddr is dropped on restore', () => {
    const json = {
      messages: [{ id: 'a', role: 'assistant', content: 'x', draftNaddr: 'javascript:alert(1)' }]
    };
    expect(fromContent(json).turns[0].draftNaddr).toBeUndefined();
  });
});
