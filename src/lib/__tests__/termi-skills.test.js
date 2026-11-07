/**
 * Skill catalogue + pure router helpers for Termi's free-text router.
 * This module must stay importable from a server route (Task 4): no
 * Paraglide, icons or .svelte imports.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CREATE_ACTIONS } from '$lib/config/create-actions.js';
import {
  TERMI_SKILLS,
  extractQuery,
  questionCues,
  keywordMatch,
  availableSkills,
  decide,
  THRESHOLDS
} from '$lib/helpers/termi-skills.js';

describe('TERMI_SKILLS catalogue', () => {
  it('has unique ids', () => {
    const ids = TERMI_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every create.* skill actionId is a real CREATE_ACTIONS id', () => {
    const createActionIds = new Set(CREATE_ACTIONS.map((a) => a.id));
    const createSkills = TERMI_SKILLS.filter((s) => s.kind === 'create');
    expect(createSkills.length).toBe(CREATE_ACTIONS.length);
    for (const skill of createSkills) {
      expect(skill.actionId && createActionIds.has(skill.actionId)).toBe(true);
    }
    // every CREATE_ACTIONS id is covered, not just a subset
    const coveredActionIds = new Set(createSkills.map((s) => s.actionId));
    for (const id of createActionIds) {
      expect(coveredActionIds.has(id)).toBe(true);
    }
  });

  it('holds only navigate/create/help skills: content questions skip the router', () => {
    const kinds = new Set(TERMI_SKILLS.map((s) => s.kind));
    expect(kinds).toEqual(new Set(['navigate', 'create', 'help']));
  });

  it('every skill has at least 5 de and 5 en phrases', () => {
    for (const skill of TERMI_SKILLS) {
      expect(skill.phrases.de.length).toBeGreaterThanOrEqual(5);
      expect(skill.phrases.en.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('never imports paraglide, icons or .svelte files', () => {
    const path = fileURLToPath(new URL('../helpers/termi-skills.js', import.meta.url));
    const source = readFileSync(path, 'utf-8');
    expect(source).not.toMatch(/\$lib\/paraglide/);
    expect(source).not.toMatch(/\.svelte/);
    expect(source).not.toMatch(/components\/icons/);
  });
});

describe('extractQuery', () => {
  it.each([
    [
      'Ich suche Materialien zur Aktivierung von Studierenden',
      'de',
      'Aktivierung von Studierenden'
    ],
    ['finde Artikel über Klimawandel!', 'de', 'Klimawandel'],
    ['Wo finde ich Leute namens Jörg?', 'de', 'Jörg'],
    ['looking for resources about fractions', 'en', 'fractions'],
    ['ich suche was', 'de', ''],
    ['Photosynthese', 'de', 'Photosynthese'],
    // The eight Termi knowledge questions (scripts/fixtures/termi-questions.json)
    ['ich suche die e-teaching community', 'de', 'e-teaching community'],
    ['ich such die e-teching community', 'de', 'e-teching community'],
    ["I'm looking for the e-teaching community", 'en', 'e-teaching community'],
    ['ich suche nach Fortbildungen zum Thema X, im Fach Y', 'de', 'X, im Fach Y'],
    [
      'Ich suche nach Fortbildungen zum Thema Medienkompetenz im Fach Deutsch, können Sie mir helfen?',
      'de',
      'Medienkompetenz im Fach Deutsch'
    ],
    [
      'meine Studierenden/Schüler sind unaufmerksam, was kann ich verbessern?',
      'de',
      'meine Studierenden/Schüler sind unaufmerksam'
    ],
    ['ich suche nach Unterrichtsentwürfen zum Thema Nachhaltigkeit', 'de', 'Nachhaltigkeit'],
    ['wie bereite ich mich auf den Statistik-Vorkurs vor?', 'de', 'Statistik-Vorkurs'],
    ['Wie bereiten Sie sich am besten auf den Statistik-Vorkurs vor?', 'de', 'Statistik-Vorkurs'],
    [
      'wer beschäftigt sich mit dem Thema OER-Lizenzen in Deutschland?',
      'de',
      'OER-Lizenzen in Deutschland'
    ],
    [
      'Wissen Sie, wer sich mit dem Thema OER-Lizenzen in Deutschland beschäftigt?',
      'de',
      'OER-Lizenzen in Deutschland'
    ],
    ['who works on OER licensing topics in Germany', 'en', 'OER licensing topics in Germany'],
    ['welche Community beschäftigt sich mit Religionspädagogik?', 'de', 'Religionspädagogik'],
    ['welche comunity beschäftigt sich mit religionspädagogik', 'de', 'religionspädagogik'],
    ['which community focuses on religious education', 'en', 'religious education'],
    [
      'welche Projekte werden im Bereich gendersensibler Unterricht durchgeführt?',
      'de',
      'gendersensibler Unterricht'
    ],
    [
      'Welche Projekte werden Ihrer Kenntnis nach im Bereich gendersensibler Unterricht durchgeführt?',
      'de',
      'gendersensibler Unterricht'
    ],
    [
      'welche projekte gibt es im bereich gendersensibeler unterricht',
      'de',
      'gendersensibeler unterricht'
    ]
  ])('extractQuery(%j, %j) === %j', (text, locale, expected) => {
    expect(extractQuery(text, /** @type {'de'|'en'} */ (locale))).toBe(expected);
  });
});

describe('questionCues', () => {
  it.each([
    [
      'ich suche die e-teaching community',
      { event: false, person: false, community: true, question: false }
    ],
    [
      "I'm looking for the e-teaching community",
      { event: false, person: false, community: true, question: false }
    ],
    [
      'ich suche nach Fortbildungen zum Thema X, im Fach Y',
      { event: true, person: false, community: false, question: false }
    ],
    [
      'ich suche fortbildungn zum thema medienkompetenz im fach deutsch',
      { event: true, person: false, community: false, question: false }
    ],
    [
      'meine Studierenden/Schüler sind unaufmerksam, was kann ich verbessern?',
      { event: false, person: false, community: false, question: true }
    ],
    [
      'ich suche nach Unterrichtsentwürfen zum Thema Nachhaltigkeit',
      { event: false, person: false, community: false, question: false }
    ],
    [
      'wie bereite ich mich auf den Statistik-Vorkurs vor?',
      { event: false, person: false, community: false, question: true }
    ],
    [
      'wer beschäftigt sich mit dem Thema OER-Lizenzen in Deutschland?',
      { event: false, person: true, community: false, question: false }
    ],
    [
      'who works on OER licensing topics in Germany',
      { event: false, person: true, community: false, question: false }
    ],
    [
      'welche comunity beschäftigt sich mit religionspädagogik',
      { event: false, person: false, community: true, question: false }
    ],
    [
      'welche Projekte werden im Bereich gendersensibler Unterricht durchgeführt?',
      { event: false, person: false, community: false, question: false }
    ],
    [
      'how can I improve attention',
      { event: false, person: false, community: false, question: true }
    ],
    [
      'Wo finde ich Leute namens Jörg?',
      { event: false, person: true, community: false, question: false }
    ],
    [
      'Material zu „Klimawandel“',
      { event: false, person: false, community: false, question: false }
    ],
    ['Determinismus', { event: false, person: false, community: false, question: false }],
    ['Termine im Mai', { event: true, person: false, community: false, question: false }]
  ])('questionCues(%j)', (text, expected) => {
    expect(questionCues(text)).toEqual(expected);
  });
});

describe('keywordMatch', () => {
  it('matches my-content for "wo sind meine beiträge"', () => {
    const matches = keywordMatch('wo sind meine beiträge', TERMI_SKILLS, 'de');
    expect(matches[0].skill).toBe('my-content');
  });

  it('folds umlauts so the ascii spelling matches too', () => {
    const matches = keywordMatch('wo sind meine beitraege', TERMI_SKILLS, 'de');
    expect(matches[0].skill).toBe('my-content');
  });

  it('returns at most 5 matches, sorted descending by score', () => {
    const matches = keywordMatch('wo sind meine beiträge', TERMI_SKILLS, 'de');
    expect(matches.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });
});

describe('availableSkills', () => {
  it('drops requiresUser skills when logged out, keeps them when logged in', () => {
    const out = new Set(availableSkills(TERMI_SKILLS, { loggedIn: false }).map((s) => s.id));
    expect(out.has('my-content')).toBe(false);
    expect(out.has('bookmarks')).toBe(false);
    expect(out.has('inbox')).toBe(false);
    expect(out.has('calendar')).toBe(true);
    const inn = new Set(availableSkills(TERMI_SKILLS, { loggedIn: true }).map((s) => s.id));
    expect(inn.has('my-content')).toBe(true);
    expect(inn.has('inbox')).toBe(true);
  });
});

describe('decide', () => {
  it('is confident when the top score clears CONFIDENT with a clear margin', () => {
    const matches = [
      { skill: 'a', score: 0.9 },
      { skill: 'b', score: 0.8 }
    ];
    expect(decide(matches, { mode: 'embed' })).toEqual({ kind: 'confident', skill: 'a' });
  });

  it('is maybe when the top two scores are close to each other', () => {
    const matches = [
      { skill: 'a', score: 0.85 },
      { skill: 'b', score: 0.83 }
    ];
    const result = decide(matches, { mode: 'embed' });
    expect(result.kind).toBe('maybe');
    if (result.kind !== 'maybe') throw new Error('expected maybe');
    expect(new Set(result.skills)).toEqual(new Set(['a', 'b']));
  });

  it('is none when the top score is below MAYBE', () => {
    const matches = [{ skill: 'a', score: 0.5 }];
    expect(decide(matches, { mode: 'embed' })).toEqual({ kind: 'none' });
  });

  it('is none for an empty match list', () => {
    expect(decide([], { mode: 'embed' })).toEqual({ kind: 'none' });
  });

  it.each([
    ['Zeig mir den Kalender', 'de', 'calendar'],
    ['Zeig meine Lesezeichen', 'de', 'bookmarks'],
    ['Show me the calendar', 'en', 'calendar']
  ])('keyword mode: verbatim catalogue phrase "%s" is confident', (text, locale, skill) => {
    const available = availableSkills(TERMI_SKILLS, { loggedIn: true });
    const matches = keywordMatch(text, available, /** @type {'de'|'en'} */ (locale));
    expect(decide(matches, { mode: 'keyword' })).toEqual({ kind: 'confident', skill });
  });

  it('keyword mode: a fully matched one-word phrase or two full matches stay maybe', () => {
    expect(
      decide(
        [
          { skill: 'a', score: 1 },
          { skill: 'b', score: 0.5 }
        ],
        { mode: 'keyword' }
      ).kind
    ).toBe('maybe');
    expect(
      decide(
        [
          { skill: 'a', score: 1, full: true },
          { skill: 'b', score: 1, full: true }
        ],
        { mode: 'keyword' }
      ).kind
    ).toBe('maybe');
  });

  it('exposes the threshold values for both modes', () => {
    // embed is untuned (Task 11 ran without the dev embedding key, see
    // scripts/termi-eval.js); keyword is tuned from the eval fixture.
    expect(THRESHOLDS.embed).toEqual({ CONFIDENT: 0.82, MAYBE: 0.72, MARGIN: 0.05 });
    expect(THRESHOLDS.keyword).toEqual({ CONFIDENT: 0.3, MAYBE: 0.15, MARGIN: 0.55 });
  });
});
