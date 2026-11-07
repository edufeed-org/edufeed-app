/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPTS } from '../termi/prompts.js';

describe('SYSTEM_PROMPTS.search', () => {
  const prompt = SYSTEM_PROMPTS.search;

  it('says the hits show as cards and must not be repeated as a list or links', () => {
    expect(prompt).toContain('als Karten');
    expect(prompt).toContain('keine Trefferliste, keine Links, keine URLs');
  });

  it('asks for one or two short sentences without markdown', () => {
    expect(prompt).toContain('ein bis zwei kurzen Sätzen');
    expect(prompt).toContain('ohne Markdown');
  });

  it('keeps the search-first and no-invention rules', () => {
    expect(prompt).toContain('search_resources');
    expect(prompt).toContain('Erfinde niemals');
    // The old "link with sourcePage/url" rule is gone with the links.
    expect(prompt).not.toContain('sourcePage');
  });
});
