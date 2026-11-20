#!/usr/bin/env node
/**
 * Termi router eval: runs scripts/fixtures/termi-phrasings.json through both
 * routing paths (keyword always; embedding only when TERMI_EMBED_URL +
 * TERMI_EMBED_API_KEY are set) and reports hit rate + a confusion list per
 * path. Used to tune `THRESHOLDS` in src/lib/helpers/termi-skills.js (Task 11).
 * Also runs every content question of scripts/fixtures/termi-questions.json
 * through the keyword path: each must come out `none` (→ content path); any
 * other decision is a hijack by a navigate/create/help skill.
 *
 *   node scripts/termi-eval.js
 *
 * Never logs the embedding key. Fixture text is printed (it's our own test
 * data, not user input).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { TERMI_SKILLS, keywordMatch, decide } from '../src/lib/helpers/termi-skills.js';
import { embedTexts } from '../src/lib/server/termi/embed.js';
import { createRouterIndex } from '../src/lib/server/termi/router-index.js';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/termi-phrasings.json', import.meta.url), 'utf-8')
);

/**
 * @param {{ kind: string, skill?: string, skills?: string[] }} decision
 * @param {string} expect
 * @returns {'confident-correct' | 'maybe-correct' | 'confident-wrong' | 'maybe-wrong' | 'false-positive' | 'missed'}
 */
function classify(decision, expect) {
  if (expect === 'none') {
    return decision.kind === 'none' ? 'confident-correct' : 'false-positive';
  }
  if (decision.kind === 'confident') {
    return decision.skill === expect ? 'confident-correct' : 'confident-wrong';
  }
  if (decision.kind === 'maybe') {
    return decision.skills?.includes(expect) ? 'maybe-correct' : 'maybe-wrong';
  }
  return 'missed';
}

/**
 * @param {string} label
 * @param {(text: string, locale: 'de'|'en') => Array<{ skill: string, score: number }>} getMatches
 * @param {'embed'|'keyword'} mode
 */
function runPath(label, getMatches, mode) {
  const counts = {
    'confident-correct': 0,
    'maybe-correct': 0,
    'confident-wrong': 0,
    'maybe-wrong': 0,
    'false-positive': 0,
    missed: 0
  };
  /** @type {Array<{ text: string, expect: string, got: string }>} */
  const confusions = [];

  for (const { text, locale, expect } of fixtures) {
    const matches = getMatches(text, locale);
    const decision = decide(matches, { mode });
    const result = classify(decision, expect);
    counts[result]++;
    if (result !== 'confident-correct' && result !== 'maybe-correct') {
      const got =
        decision.kind === 'confident'
          ? decision.skill
          : decision.kind === 'maybe'
            ? `maybe:${decision.skills.join(',')}`
            : 'none';
      confusions.push({ text, expect, got });
    }
  }

  const total = fixtures.length;
  const hitRate = ((counts['confident-correct'] + counts['maybe-correct']) / total) * 100;
  console.log(`\n=== ${label} ===`);
  console.log(`hit rate (confident+maybe correct): ${hitRate.toFixed(1)}% (${total} fixtures)`);
  console.log(counts);
  if (confusions.length > 0) {
    console.log('confusion list:');
    for (const c of confusions) {
      console.log(`  "${c.text}" expected=${c.expect} got=${c.got}`);
    }
  }
  return counts;
}

runPath('keyword', (text, locale) => keywordMatch(text, TERMI_SKILLS, locale), 'keyword');

const questions = JSON.parse(
  readFileSync(new URL('./fixtures/termi-questions.json', import.meta.url), 'utf-8')
);
const hijacks = questions
  .map((/** @type {{ text: string, locale: 'de'|'en' }} */ { text, locale }) => ({
    text,
    decision: decide(keywordMatch(text, TERMI_SKILLS, locale), { mode: 'keyword' })
  }))
  .filter(({ decision }) => decision.kind !== 'none');
console.log('\n=== keyword: content questions (termi-questions.json, expect none) ===');
console.log(`hijacked: ${hijacks.length} of ${questions.length}`);
for (const { text, decision } of hijacks) {
  const got = decision.kind === 'confident' ? decision.skill : `maybe:${decision.skills.join(',')}`;
  console.log(`  "${text}" got=${got}`);
}

const embedUrl = process.env.TERMI_EMBED_URL;
const embedApiKey = process.env.TERMI_EMBED_API_KEY;
if (!embedUrl || !embedApiKey) {
  console.log('\n=== embed ===');
  console.log('embedding path skipped (no TERMI_EMBED_* env)');
} else {
  const index = createRouterIndex({
    embed: (texts, inputType) =>
      embedTexts(texts, inputType, { url: embedUrl, apiKey: embedApiKey }),
    skills: TERMI_SKILLS
  });
  await index.warmUp();
  const ranked = new Map();
  for (const { text, locale } of fixtures) {
    ranked.set(text, await index.rank(text, locale));
  }
  runPath('embed', (text) => ranked.get(text), 'embed');
}
