/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { AI_LABELS, normalizeAiLabel, getAiLabel } from '$lib/helpers/ai-label.js';

/** @param {string[][]} tags */
const ev = (tags) => ({ kind: 1063, tags });

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
