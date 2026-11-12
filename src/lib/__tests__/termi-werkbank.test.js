/** @vitest-environment node */
// @ts-nocheck
import { describe, it, expect, vi } from 'vitest';
import {
  partsOf,
  foundCompetences,
  changedBlocks,
  blocksOf,
  railRows,
  partLines,
  nextPartKey,
  isDraft,
  draftSummary,
  createRun,
  activityOf
} from '../termi/werkbank.js';

const t = (id, text, extra = {}) => ({ id, role: 'assistant', text, ...extra });
const turns = [
  t('a', '<!-- termi:part lesson 1 -->\n# Stunde 1\n\nEinstieg 10 Min.'),
  t('b', '<!-- termi:part lesson 2 -->\n# Stunde 2\n\nText'),
  t('c', '<!-- termi:part lesson 1 -->\n# Stunde 1\n\nEinstieg 5 Min.')
];
const parts = partsOf(turns, 'lesson');

describe('partsOf', () => {
  it('latest text wins, the earlier one becomes prev', () => {
    expect(parts.map((p) => p.key)).toEqual(['lesson-1', 'lesson-2']);
    expect(parts[0]).toMatchObject({ turnId: 'c', prev: '# Stunde 1\n\nEinstieg 10 Min.' });
    expect(parts[1].prev).toBeUndefined();
  });
  it('stubs contribute nothing; ask documents need no marker', () => {
    expect(partsOf([t('s', 'x …', { textStub: true })], 'lesson')).toEqual([]);
    expect(partsOf([t('d', '# Handout\n\n' + 'wort '.repeat(300))], 'ask')[0].key).toBe('document');
    expect(partsOf([t('q', 'Kurze Antwort.')], 'ask')).toEqual([]);
  });
  it("an ask document's sentence before its # heading stays out of the part (as in the exports)", () => {
    const doc = '# Handout\n\n' + 'wort '.repeat(300).trim();
    const [part] = partsOf([t('d', 'Soll ich noch Aufgaben ergänzen?\n\n' + doc)], 'ask');
    expect(part.text).toBe(doc);
  });
  it('a short answer after a document leaves the part; a second document replaces it with prev', () => {
    const d1 = '# Handout\n\n' + 'wort '.repeat(300);
    const d2 = '# Handout\n\n' + 'satz '.repeat(300);
    const one = partsOf([t('d', d1), t('q', 'Gern geschehen.')], 'ask');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ key: 'document', turnId: 'd' });
    const two = partsOf([t('d', d1), t('q', 'Kurz.'), t('e', d2)], 'ask');
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ key: 'document', turnId: 'e' });
    expect(two[0].prev).toBe(one[0].text);
  });
  it('ignores user turns', () => {
    expect(partsOf([{ id: 'u', role: 'user', text: '# Hi' }], 'ask')).toEqual([]);
  });
});

describe('blocksOf / changedBlocks', () => {
  const tbl = (/** @type {number} */ m) =>
    `| Phase | Min |\n|---|---|\n| Einstieg | ${m} |\n| Sicherung | 10 |`;
  it('splits tables into rows', () => {
    expect(blocksOf(tbl(10))).toHaveLength(3);
  });
  it('marks only new blocks', () => {
    expect(changedBlocks(undefined, 'a\n\nb')).toEqual(new Set());
    expect(changedBlocks('a\n\nb\n\nc', 'a\n\nB\n\nc')).toEqual(new Set([1]));
    expect(changedBlocks(tbl(10), tbl(5))).toEqual(new Set([1]));
  });
});

describe('railRows', () => {
  const state = { phase: 5, plan: [{ n: 1 }, { n: 2 }, { n: 3 }], parts: { lessons: [] } };
  it('derives steps and part states', () => {
    const r = railRows(state, parts, { writingKey: 'lesson-3', wraps: { 'lesson-2': 'b' } });
    expect(r.steps.every((s) => s.state === 'done')).toBe(true);
    expect(r.parts.map((p) => [p.key, p.state])).toEqual([
      ['overview', 'todo'],
      ['lesson-1', 'changed'],
      ['lesson-2', 'saved'],
      ['lesson-3', 'writing']
    ]);
  });
  it('failed beats saved, writing beats failed', () => {
    const r = railRows(state, parts, {
      writingKey: 'lesson-1',
      failedKey: 'lesson-1',
      wraps: {}
    });
    expect(r.parts.find((p) => p.key === 'lesson-1')?.state).toBe('writing');
    const f = railRows(state, parts, { failedKey: 'lesson-2', wraps: { 'lesson-2': 'b' } });
    expect(f.parts.find((p) => p.key === 'lesson-2')?.state).toBe('failed');
  });
  it('failedKey may be a Set: several rows fail at once', () => {
    const f = railRows(state, parts, { failedKey: new Set(['overview', 'lesson-2']), wraps: {} });
    expect(f.parts.filter((p) => p.state === 'failed').map((p) => p.key)).toEqual([
      'overview',
      'lesson-2'
    ]);
  });
  it('steps follow the phase', () => {
    expect(railRows({ phase: 2 }, [], {}).steps.map((s) => s.state)).toEqual([
      'done',
      'current',
      'todo',
      'todo'
    ]);
  });
});

describe('railRows without a lesson state', () => {
  it('no steps, one row per part (an ask document)', () => {
    const doc = partsOf([t('d', '# Handout\n\n' + 'wort '.repeat(300))], 'ask');
    expect(railRows(null, doc, { wraps: { document: 'd' } })).toEqual({
      steps: [],
      parts: [{ key: 'document', title: 'Handout', state: 'saved' }]
    });
  });
  it('a failed load or a writing part without text still gets its row (the retry is clickable)', () => {
    expect(railRows(null, [], { failedKey: new Set(['document']) }).parts).toEqual([
      { key: 'document', title: 'document', state: 'failed' }
    ]);
    expect(railRows(null, [], { writingKey: 'document' }).parts).toEqual([
      { key: 'document', title: 'document', state: 'writing' }
    ]);
  });
});

describe('partLines', () => {
  it('per turn: its parts, changed when an earlier turn had the key', () => {
    expect(partLines(turns, 'lesson')).toEqual({
      a: [{ key: 'lesson-1', title: 'Stunde 1', changed: false, superseded: 'same' }],
      b: [{ key: 'lesson-2', title: 'Stunde 2', changed: false }],
      c: [{ key: 'lesson-1', title: 'Stunde 1', changed: true }]
    });
  });
  it('a later document under another title supersedes the first as `other`', () => {
    const d = (/** @type {string} */ h) => `# ${h}\n\n` + 'wort '.repeat(300);
    expect(partLines([t('d', d('Handout')), t('e', d('Quiz'))], 'ask').d).toEqual([
      { key: 'document', title: 'Handout', changed: false, superseded: 'other' }
    ]);
  });
});

describe('nextPartKey', () => {
  it('first planned key without a part', () => {
    const state = { phase: 5, plan: [{ n: 1 }, { n: 2 }, { n: 3 }] };
    expect(nextPartKey(state, parts)).toBe('overview');
    expect(
      nextPartKey({ phase: 5, plan: [{ n: 1 }] }, [{ key: 'overview' }, { key: 'lesson-1' }])
    ).toBeNull();
  });
});

describe('isDraft / draftSummary', () => {
  it('detects drafts', () => {
    expect(isDraft({ messages: [{ role: 'assistant', content: 'Hallo' }] })).toBe(false);
    expect(isDraft({ lesson: { phase: 2 }, messages: [] })).toBe(true);
    expect(
      isDraft({ messages: [{ role: 'assistant', content: 'x', draftWraps: { module: 'n' } }] })
    ).toBe(true);
    // an ask document counts once it is saved (the Werkbank saves real documents on its own)
    expect(isDraft({ messages: [{ role: 'assistant', content: '# Titel\n\nText' }] })).toBe(false);
    expect(
      isDraft({
        messages: [{ role: 'assistant', content: '# Titel …', draftWraps: { document: 'n' } }]
      })
    ).toBe(true);
  });
  it('summarises a series', () => {
    expect(
      draftSummary({
        task: 'lesson',
        lesson: {
          frame: { topic: 'Nachhaltigkeit' },
          plan: [{ n: 1 }, { n: 2 }],
          parts: { overview: { wrap: 'naddr1x' }, lessons: [{ n: 1, wrap: 'naddr1y' }] }
        },
        messages: []
      })
    ).toMatchObject({
      title: 'Nachhaltigkeit',
      kind: 'series',
      done: 2,
      total: 3,
      published: false
    });
  });
  it('summarises a document', () => {
    expect(
      draftSummary({
        title: 'Chat',
        messages: [{ role: 'assistant', content: '# Handout\n\nText' }]
      })
    ).toMatchObject({ title: 'Handout', kind: 'document', done: 0, total: 1 });
  });
  it('an ask record with a stray lesson state (its document wrap) is still a document', () => {
    expect(
      draftSummary({
        title: 'Chat',
        lesson: { phase: 1, parts: { document: { wrap: 'naddr1x' } } },
        messages: [
          { role: 'assistant', content: '# Handout\n\nText', draftWraps: { document: 'naddr1x' } }
        ]
      })
    ).toMatchObject({ title: 'Handout', kind: 'document', done: 1, total: 1 });
  });
});

describe('foundCompetences', () => {
  const part = (type, output) => ({ type, state: 'output-available', output });
  it('collects curriculum_competences and same-message options, minus the chosen ones', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [part('tool-propose_options', { options: [{ label: 'Bayern' }] })]
      },
      {
        role: 'assistant',
        parts: [
          part('tool-curriculum_competences', {
            competences: [
              { uri: 'https://x/1', label: 'Brüche vergleichen', topic: 'Zahlen' },
              { uri: 'https://x/2', label: 'Schon gewählt' }
            ]
          }),
          part('tool-propose_options', { options: [{ id: 'a', label: 'Brüche kürzen' }] }),
          { type: 'tool-curriculum_competences', state: 'input-available' }
        ]
      }
    ];
    expect(foundCompetences(messages, [{ label: 'Schon gewählt' }])).toEqual([
      { uri: 'https://x/1', label: 'Brüche vergleichen', topic: 'Zahlen' },
      { label: 'Brüche kürzen' }
    ]);
  });

  // live 2026-11-12: curriculum_competences came back empty for Bayern; the competences
  // were search_curriculum entries (shape from curriculum-tools.js, transcript 2026-11-11)
  it('reads search_curriculum entries, only those of the curriculum the frame names', () => {
    const entry = (/** @type {string} */ label, /** @type {object} */ extra) => ({
      uri: `https://w3id.org/lehrplan/resource/by/${label.length}`,
      label,
      parent: 'Sich Herausforderungen im Zusammenleben stellen',
      curriculum: { uri: 'https://w3id.org/lehrplan/resource/by/lp', title: 'LehrplanPLUS' },
      state: 'Bayern',
      schoolType: 'Grundschule',
      subject: 'Evangelische Religionslehre',
      grade: 'Jahrgangsstufe 3/4',
      ...extra
    });
    const messages = [
      {
        role: 'assistant',
        parts: [
          part('tool-search_curriculum', {
            entries: [
              entry('Bewahrung der Schöpfung', {}),
              entry('Energie und Umwelt', { subject: 'Englisch', schoolType: 'Realschule' }),
              entry('Nachhaltige Chemie', { subject: 'Chemie', grade: 'Jahrgangsstufe 11' })
            ]
          })
        ]
      }
    ];
    const frame = { subject: 'Religion', state: 'Bayern', schoolType: 'Grundschule', grade: '4' };
    expect(foundCompetences(messages, [], frame)).toEqual([
      {
        uri: 'https://w3id.org/lehrplan/resource/by/23',
        label: 'Bewahrung der Schöpfung',
        topic: 'Sich Herausforderungen im Zusammenleben stellen'
      }
    ]);
    // a frame that names nothing yet: every entry
    expect(foundCompetences(messages, [], {})).toHaveLength(3);
  });
});

describe('createRun', () => {
  const order = ['overview', 'lesson-1', 'lesson-2'];
  /** a run over `order`; `write` adds the key unless overridden */
  function setup(overrides = {}) {
    const calls = [];
    const states = [];
    const have = new Set();
    const run = createRun({
      next: () => order.find((k) => !have.has(k)) ?? null,
      write: async (k) => {
        calls.push(k);
        have.add(k);
      },
      sendQueued: async (t) => {
        calls.push('q:' + t);
      },
      onState: (s) => states.push(s),
      ...overrides
    });
    return { run, calls, states, have };
  }

  it('writes every part, a queued message before the next part, then done', async () => {
    const { run, calls, states } = setup();
    run.queue('Stunde 1 kürzer');
    await run.start();
    expect(calls).toEqual(['overview', 'q:Stunde 1 kürzer', 'lesson-1', 'lesson-2']);
    expect(states).toEqual([
      { writing: 'overview' },
      { writing: 'lesson-1' },
      { writing: 'lesson-2' },
      { done: true }
    ]);
  });

  it('a part that did not appear stops the run instead of looping', async () => {
    const st = [];
    const stuck = createRun({
      next: () => 'lesson-1',
      write: async () => {},
      sendQueued: async () => {},
      onState: (s) => st.push(s)
    });
    await stuck.start();
    expect(st).toEqual([{ writing: 'lesson-1' }, { failed: 'lesson-1' }]);
  });

  it('pause lets the part in progress finish, writes no further, then says paused', async () => {
    let release = () => {};
    const t = setup({
      write: async (k) => {
        t.calls.push(k);
        await new Promise((r) => (release = r));
        t.have.add(k);
      }
    });
    const p = t.run.start();
    t.run.pause();
    release();
    await p;
    expect(t.calls).toEqual(['overview']);
    expect(t.states).toEqual([{ writing: 'overview' }, { paused: true }]);
    expect(t.run.state).toEqual({ running: false, paused: true });
    // started again, it carries on where it stopped
    const again = t.run.start();
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, 0));
      release();
    }
    await again;
    expect(t.calls).toEqual(['overview', 'lesson-1', 'lesson-2']);
    expect(t.states.at(-1)).toEqual({ done: true });
  });

  it('a thrown write (an account switch) fails the part and sends nothing further', async () => {
    const sendQueued = vi.fn(async () => {});
    const { run, states } = setup({
      write: async () => {
        throw new Error('account changed');
      },
      sendQueued
    });
    run.queue('x');
    await run.start();
    expect(states).toEqual([{ writing: 'overview' }, { failed: 'overview' }]);
    expect(sendQueued).not.toHaveBeenCalled();
    expect(run.state.running).toBe(false);
  });
});

describe('activityOf', () => {
  const say = { curriculum: (q) => `L:${q}`, material: (q) => `M:${q}` };
  it('names a running search with its query', () => {
    const running = {
      type: 'tool-search_resources',
      state: 'input-available',
      input: { query: 'Streitschlichter' }
    };
    expect(activityOf(running, say)).toBe('M:Streitschlichter');
    expect(
      activityOf(
        { type: 'tool-search_passages', state: 'input-streaming', input: { question: 'Wie?' } },
        say
      )
    ).toBe('M:Wie?');
    expect(
      activityOf(
        { type: 'tool-find_curriculum', state: 'input-available', input: { subject: 'Mathe' } },
        say
      )
    ).toBe('L:Mathe');
  });
  it('a finished or unknown tool says nothing', () => {
    expect(
      activityOf(
        { type: 'tool-search_resources', state: 'output-available', input: { query: 'x' } },
        say
      )
    ).toBeNull();
    expect(
      activityOf({ type: 'tool-lesson_state', state: 'input-available', input: {} }, say)
    ).toBeNull();
    expect(activityOf(undefined, say)).toBeNull();
  });
});
