/** @vitest-environment node */
// Termi answer feedback: which turns can be rated, and the message text a rating becomes.
import { describe, it, expect } from 'vitest';
import { isRateable, buildFeedbackBody, FEEDBACK_MAX_BYTES } from '../termi/feedback.js';

const NADDR =
  'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk6zne58wzh0waycrqsqqqa28';
const bytes = (/** @type {string} */ s) => new TextEncoder().encode(s).length;
/** The one fenced JSON object of a body. @param {string} body */
const json = (body) => {
  const blocks = [...body.matchAll(/```json\n([\s\S]*?)\n```/g)];
  expect(blocks).toHaveLength(1);
  expect(body.split('```')).toHaveLength(3);
  return JSON.parse(blocks[0][1]);
};

/** @returns {any} */
const user = (/** @type {string} */ text, extra = {}) => ({
  role: 'user',
  text,
  tier: 1,
  ...extra
});
/** @returns {any} */
const model = (/** @type {string} */ text, extra = {}) => ({
  id: 'a1',
  role: 'assistant',
  text,
  tier: 2,
  model: 'saia:glm-5.3',
  ...extra
});
/** @returns {any} */
const search = (/** @type {any[]} */ items, extra = {}) => ({
  id: 's1',
  role: 'assistant',
  text: 'Das habe ich gefunden:',
  tier: 1,
  items,
  sourcesUnavailable: [],
  ...extra
});
const base = { appVersion: '1.2.3', now: new Date('2026-11-19T10:00:00Z') };

describe('isRateable', () => {
  it('a model answer', () => expect(isRateable(model('Antwort'))).toBe(true));
  it('a tier-1 search answer with hits', () =>
    expect(isRateable(search([{ title: 'Bruchrechnen' }]))).toBe(true));
  it('a tier-1 search answer with zero hits', () => expect(isRateable(search([]))).toBe(true));

  it.each([
    ['a user turn', user('Frage')],
    [
      'a canned or router answer',
      { role: 'assistant', text: 'Hier entlang', tier: 1, actions: [] }
    ],
    ['an import turn', search([], { import: { rows: [] } })],
    ['the error line', model('', { error: { href: '/x' } })],
    ['a streaming answer', model('Ant', { pending: true })],
    ['a stub', model('Kurz…', { textStub: true })],
    ['a search that failed', search([], { sourcesUnavailable: ['search'] })]
  ])('not %s', (_name, turn) => expect(isRateable(/** @type {any} */ (turn))).toBe(false));
});

describe('buildFeedbackBody', () => {
  const answer = model('Brüche addiert man so.', {
    fallback: { from: 'saia:other', reason: 'capacity' },
    toolParts: [
      { type: 'tool-search_content' },
      { type: 'tool-search_content' },
      { type: 'dynamic-tool', toolName: 'find_people' }
    ]
  });
  const turns = [
    user('Hallo'),
    search([{ title: 'Bruchrechnen' }, { title: 'Dezimalzahlen' }]),
    user('Wie addiere ich Brüche?'),
    answer
  ];
  /** @type {any} */
  const down = { ...base, vote: 'down', reason: 'wrong', turn: answer, turns, task: 'ask' };

  it('thumbs up: metadata only', () => {
    const body = buildFeedbackBody({
      ...base,
      vote: 'up',
      turn: answer,
      turns,
      task: 'ask',
      attach: false,
      named: false
    });
    expect(body.startsWith('Termi-Feedback 👍\n')).toBe(true);
    expect(json(body)).toEqual({
      vote: 'up',
      reason: null,
      comment: null,
      answerId: 'a1',
      model: 'saia:glm-5.3',
      fallback: 'saia:other',
      task: 'ask',
      tools: ['search_content', 'find_people'],
      appVersion: '1.2.3',
      at: '2026-11-19T10:00:00.000Z'
    });
  });

  it('the header names reason, model, task and comment', () => {
    const body = buildFeedbackBody({
      ...down,
      comment: 'Stimmt nicht.',
      attach: false,
      named: false
    });
    expect(body.split('```json')[0]).toBe(
      'Termi-Feedback 👎 — Inhaltlich falsch\nModell: saia:glm-5.3 · Aufgabe: ask · App 1.2.3\n\nKommentar:\nStimmt nicht.\n\n'
    );
  });

  it('a search answer without reason or comment', () => {
    const turn = turns[1];
    const body = buildFeedbackBody({
      ...base,
      vote: 'down',
      turn,
      turns,
      attach: false,
      named: false
    });
    expect(body.split('```json')[0]).toBe(
      'Termi-Feedback 👎 — ohne Angabe\nModell: – · Aufgabe: Suche · App 1.2.3\n\nKommentar:\n–\n\n'
    );
  });

  it('down without attach: no chat text anywhere in the body', () => {
    const body = buildFeedbackBody({ ...down, attach: false, named: false });
    for (const s of ['Brüche', 'Hallo', 'Bruchrechnen']) expect(body).not.toContain(s);
    expect(Object.keys(json(body))).not.toEqual(expect.arrayContaining(['text']));
  });

  it('attach: the fixture fields', () => {
    const data = json(buildFeedbackBody({ ...down, attach: true, named: true }));
    expect(data.text).toBe('Wie addiere ich Brüche?');
    expect(data.answer).toBe('Brüche addiert man so.');
    expect(data.history).toEqual([
      { role: 'user', text: 'Hallo' },
      { role: 'assistant', text: 'Das habe ich gefunden:\n[Treffer: Bruchrechnen; Dezimalzahlen]' }
    ]);
    expect(data.truncated).toBeUndefined();
  });

  it('finds the rated turn by id when the window hands over a re-projected copy', () => {
    const data = json(
      buildFeedbackBody({ ...down, turn: { ...answer }, attach: true, named: true })
    );
    expect(data.text).toBe('Wie addiere ich Brüche?');
    expect(data.history).toHaveLength(2);
  });

  it('skips import turns in history', () => {
    const withImport = [
      user('Termine aus der Datei', { import: { rows: [] } }),
      search([], { text: 'Vorschau', import: { rows: [] } }),
      ...turns
    ];
    const data = json(buildFeedbackBody({ ...down, turns: withImport, attach: true, named: true }));
    expect(data.history.map((/** @type {any} */ h) => h.text)).toEqual([
      'Hallo',
      'Das habe ich gefunden:\n[Treffer: Bruchrechnen; Dezimalzahlen]'
    ]);
  });

  it('strips lesson address fields always, keeps the rest', () => {
    const lesson = {
      phase: 5,
      publication: NADDR,
      resource: NADDR,
      parts: {
        overview: { title: 'Überblick', wrap: NADDR, naddr: NADDR },
        lessons: [{ n: 1, title: 'Stunde 1', wrap: NADDR }]
      }
    };
    const body = buildFeedbackBody({ ...down, task: 'lesson', lesson, attach: true, named: true });
    expect(json(body).lesson).toEqual({
      phase: 5,
      parts: { overview: { title: 'Überblick' }, lessons: [{ n: 1, title: 'Stunde 1' }] }
    });
  });

  it('sends no lesson without attach', () => {
    const body = buildFeedbackBody({ ...down, lesson: { phase: 2 }, attach: false, named: true });
    expect(json(body).lesson).toBeUndefined();
  });

  const linked = model(`Siehe nostr:${NADDR} dort.`);
  const linkedTurns = [user(`Alt ${NADDR}`), model('ok'), user(`Was ist ${NADDR}?`), linked];
  const linkedDown = {
    ...down,
    turn: linked,
    turns: linkedTurns,
    comment: `Falsch: ${NADDR}`,
    attach: true
  };

  it('unnamed: naddr1 tokens replaced in answer, text, history and comment', () => {
    const body = buildFeedbackBody({ ...linkedDown, named: false });
    expect(body).not.toMatch(/naddr1[0-9a-z]+/);
    expect(json(body).answer).toBe('Siehe nostr:naddr… dort.');
  });

  it('named: naddr1 tokens kept', () => {
    const data = json(buildFeedbackBody({ ...linkedDown, named: true }));
    expect(data.answer).toContain(NADDR);
    expect(data.text).toContain(NADDR);
  });

  it('comment and answer with ``` and braces still yield one parseable JSON block', () => {
    const nasty = 'Code:\n```json\n{"a": 1}\n```\nund `x` }';
    const turn = model(nasty);
    const data = json(
      buildFeedbackBody({
        ...down,
        turn,
        turns: [user('```?'), turn],
        comment: nasty,
        attach: true,
        named: true
      })
    );
    expect(data.answer).toBe(nasty);
    expect(data.comment).toBe(nasty);
    expect(data.text).toBe('```?');
  });

  it('cuts the comment to 1000 characters', () => {
    const data = json(
      buildFeedbackBody({ ...down, comment: 'x'.repeat(1500), attach: false, named: false })
    );
    expect(data.comment).toHaveLength(1000);
  });

  it('too long: drops the oldest history first, then cuts the answer, question kept', () => {
    const long = model('A'.repeat(25000));
    const many = [user('alt '.repeat(1500)), model('neu '.repeat(1500)), user('Die Frage'), long];
    const body = buildFeedbackBody({ ...down, turn: long, turns: many, attach: true, named: true });
    const data = json(body);
    expect(bytes(body)).toBeLessThanOrEqual(FEEDBACK_MAX_BYTES);
    expect(data.truncated).toBe(true);
    expect(data.history).toEqual([]);
    expect(data.text).toBe('Die Frage');
    expect(data.answer.length).toBeGreaterThan(10000);
    expect(data.answer.length).toBeLessThan(25000);
  });

  it('keeps the newer history when only the oldest must go', () => {
    const many = [user('alt '.repeat(6000)), model('kurz davor'), user('Die Frage'), answer];
    const data = json(buildFeedbackBody({ ...down, turns: many, attach: true, named: true }));
    expect(data.history).toEqual([{ role: 'assistant', text: 'kurz davor' }]);
    expect(data.answer).toBe('Brüche addiert man so.');
    expect(data.truncated).toBe(true);
  });

  it('a 30 000-byte question alone: still within the cap, valid JSON, truncated', () => {
    const body = buildFeedbackBody({
      ...down,
      turns: [user('F'.repeat(30000)), answer],
      attach: true,
      named: true
    });
    expect(bytes(body)).toBeLessThanOrEqual(FEEDBACK_MAX_BYTES);
    expect(json(body).truncated).toBe(true);
  });

  it('counts bytes, not characters', () => {
    const turn = model('ä'.repeat(15000)); // 30 000 bytes
    const body = buildFeedbackBody({
      ...down,
      turn,
      turns: [user('F'), turn],
      attach: true,
      named: true
    });
    expect(bytes(body)).toBeLessThanOrEqual(FEEDBACK_MAX_BYTES);
    expect(json(body).truncated).toBe(true);
  });

  it('a cut never leaves half an emoji', () => {
    const turn = model('😀'.repeat(8000));
    const body = buildFeedbackBody({
      ...down,
      turn,
      turns: [user('F'), turn],
      attach: true,
      named: true
    });
    expect(bytes(body)).toBeLessThanOrEqual(FEEDBACK_MAX_BYTES);
    expect(json(body).answer).toMatch(/^(😀)+$/u);
  });
});
