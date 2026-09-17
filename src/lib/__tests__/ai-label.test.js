/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  AI_LABELS,
  normalizeAiLabel,
  getAiLabel,
  AI_TOOLS,
  AI_TOOLS_SCHEME,
  AI_TRAINING,
  normalizeAiTraining,
  getAiTool,
  getAiEdited,
  getAiTraining
} from '$lib/helpers/ai-label.js';

/** @param {string[][]} tags */
const ev = (tags) => ({ kind: 1063, tags });

/** @param {string} label */
const toolByLabel = (label) =>
  /** @type {{ id: string, label: string }} */ (AI_TOOLS.find((t) => t.label === label));

describe('ai-label', () => {
  it('exposes the two EU labelling categories', () => {
    expect(AI_LABELS).toEqual(['generated', 'modified']);
  });

  it('normalizeAiLabel accepts only known values (case-insensitive, trimmed)', () => {
    expect(normalizeAiLabel('generated')).toBe('generated');
    expect(normalizeAiLabel(' Modified ')).toBe('modified');
    expect(normalizeAiLabel('')).toBeNull();
    expect(normalizeAiLabel('none')).toBeNull();
    expect(normalizeAiLabel(undefined)).toBeNull();
    expect(normalizeAiLabel(null)).toBeNull();
  });

  it('getAiLabel reads the first valid `ai` tag of a kind-1063 event', () => {
    expect(getAiLabel(ev([['ai', 'generated']]))).toBe('generated');
    expect(
      getAiLabel(
        ev([
          ['license', 'x'],
          ['ai', 'modified']
        ])
      )
    ).toBe('modified');
  });

  it('getAiLabel ignores garbage values and missing tags (untrusted network input)', () => {
    expect(getAiLabel(ev([['ai', 'robot']]))).toBeNull();
    expect(getAiLabel(ev([['ai']]))).toBeNull();
    expect(
      getAiLabel(
        ev([
          ['ai', 'bogus'],
          ['ai', 'generated']
        ])
      )
    ).toBe('generated');
    expect(getAiLabel(ev([]))).toBeNull();
    expect(getAiLabel(null)).toBeNull();
    expect(getAiLabel(undefined)).toBeNull();
  });
});

/*
 * twillo / edu-sharing alignment (issue "Harmonize AI hint with twillo"):
 *   ccm:commonlicense_ai_tool              → ["ai-tool", label, conceptUri?]
 *   ccm:commonlicense_ai_manually_modified → ["ai-edited", "true"]
 *   ccm:commonlicense_ai_allow_usage       → ["ai-training", "allowed" | "disallowed"]
 */
describe('ai-label — tool vocabulary (edu-sharing aiTools SKOS scheme)', () => {
  it('exposes the w3id concept scheme and its concepts with labels', () => {
    expect(AI_TOOLS_SCHEME).toBe('http://w3id.org/edu-sharing/vocabs/aiTools/');
    expect(AI_TOOLS.length).toBeGreaterThanOrEqual(2);
    for (const tool of AI_TOOLS) {
      expect(tool.id.startsWith(AI_TOOLS_SCHEME)).toBe(true);
      expect(tool.label.length).toBeGreaterThan(0);
    }
    expect(AI_TOOLS.map((t) => t.label)).toEqual(
      expect.arrayContaining(['OpenAI ChatGPT', 'Google Gemini'])
    );
  });

  it('getAiTool reads label + optional concept URI from the `ai-tool` tag', () => {
    const chatgpt = toolByLabel('OpenAI ChatGPT');
    expect(getAiTool(ev([['ai-tool', 'OpenAI ChatGPT', chatgpt.id]]))).toEqual({
      label: 'OpenAI ChatGPT',
      id: chatgpt.id
    });
    expect(getAiTool(ev([['ai-tool', 'Midjourney']]))).toEqual({ label: 'Midjourney', id: null });
  });

  it('getAiTool resolves a bare known concept URI to its label', () => {
    const gemini = toolByLabel('Google Gemini');
    expect(getAiTool(ev([['ai-tool', gemini.id]]))).toEqual({
      label: 'Google Gemini',
      id: gemini.id
    });
  });

  it('getAiTool ignores empty / garbage tags (untrusted network input)', () => {
    expect(getAiTool(ev([['ai-tool', '   ']]))).toBeNull();
    expect(getAiTool(ev([['ai-tool']]))).toBeNull();
    expect(getAiTool(ev([['ai-tool', 'X', 'not-a-uri']]))).toEqual({ label: 'X', id: null });
    expect(getAiTool(ev([]))).toBeNull();
    expect(getAiTool(null)).toBeNull();
  });
});

describe('ai-label — manually edited after generation', () => {
  it('getAiEdited is true only for an `ai-edited` tag with value "true"', () => {
    expect(getAiEdited(ev([['ai-edited', 'true']]))).toBe(true);
    expect(getAiEdited(ev([['ai-edited', 'TRUE']]))).toBe(true);
    expect(getAiEdited(ev([['ai-edited', 'false']]))).toBe(false);
    expect(getAiEdited(ev([['ai-edited']]))).toBe(false);
    expect(getAiEdited(ev([]))).toBe(false);
    expect(getAiEdited(undefined)).toBe(false);
  });
});

describe('ai-label — AI training permission', () => {
  it('exposes the two permission values', () => {
    expect(AI_TRAINING).toEqual(['allowed', 'disallowed']);
  });

  it('normalizeAiTraining accepts only known values (case-insensitive, trimmed)', () => {
    expect(normalizeAiTraining('allowed')).toBe('allowed');
    expect(normalizeAiTraining(' Disallowed ')).toBe('disallowed');
    expect(normalizeAiTraining('true')).toBeNull();
    expect(normalizeAiTraining('')).toBeNull();
    expect(normalizeAiTraining(null)).toBeNull();
  });

  it('getAiTraining reads the first valid `ai-training` tag, null when absent', () => {
    expect(getAiTraining(ev([['ai-training', 'allowed']]))).toBe('allowed');
    expect(getAiTraining(ev([['ai-training', 'disallowed']]))).toBe('disallowed');
    expect(
      getAiTraining(
        ev([
          ['ai-training', 'maybe'],
          ['ai-training', 'disallowed']
        ])
      )
    ).toBe('disallowed');
    expect(getAiTraining(ev([['ai-training', 'yes']]))).toBeNull();
    expect(getAiTraining(ev([]))).toBeNull();
    expect(getAiTraining(null)).toBeNull();
  });
});
