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
    expect(rule).toContain('erste Zeile `# <Titel>`');
    expect(rule).toContain('search_passages');
    expect(rule).toContain('nie als Link');
    expect(rule).toContain('Eine Übersicht über Materialien oder Angebote ist kein Dokument');
  });
});
