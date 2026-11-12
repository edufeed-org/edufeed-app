/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { composePrompt } from '$lib/server/termi/tasks.js';

describe('Termi ask prompt', () => {
  it('has the document rule: explicit signals only, # title, ## sections, search_passages, no links', () => {
    const rule =
      composePrompt('ask', { appName: 'Edufeed' })
        .split('\n')
        .find((l) => l.includes('Markdown-Dokument')) ?? '';
    for (const signal of [
      'Handout',
      'Arbeitsblatt',
      'A4-Seite',
      'zum Ausdrucken oder Weitergeben',
      'Zusammenfassung zum Thema'
    ]) {
      expect(rule).toContain(signal);
    }
    expect(rule).toContain('beginnt mit `# <Titel>`');
    expect(rule).toContain('search_passages');
    expect(rule).toContain('nie als Link');
    expect(rule).toContain('Eine Übersicht über Materialien oder Angebote ist kein Dokument');
  });
});

// live 2026-11-12: "Passt das so, oder war eine andere Stunde gemeint?" ended up inside Stunde 1
describe('a part ends with its content', () => {
  it('ask: a follow-up goes in a sentence before the # heading, never after the document', () => {
    const rule =
      composePrompt('ask', { appName: 'Edufeed' })
        .split('\n')
        .find((l) => l.includes('Markdown-Dokument')) ?? '';
    expect(rule).toContain('Das Dokument endet mit seinem Inhalt');
    expect(rule).toContain('vor der `# `-Überschrift');
  });

  it('lesson: a follow-up goes through propose_options or before the marker, never after the part', () => {
    const prompt = composePrompt('lesson', { appName: 'Edufeed' });
    expect(prompt).not.toContain('danach höchstens eine kurze Frage');
    expect(prompt).toContain('Ein Teil endet mit seinem Inhalt');
    expect(prompt).toContain('vor der Markierung');
  });
});
