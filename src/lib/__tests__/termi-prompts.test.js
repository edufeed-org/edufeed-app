/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { composePrompt } from '$lib/server/termi/tasks.js';

describe('Termi ask prompt', () => {
  it('has the document rule: explicit signals only, # title, ## sections, search_passages, external links only', () => {
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
    expect(rule).toContain('externe Adresse');
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

describe('lesson_state tells the model how plan rows merge', () => {
  it('rows carry n, merge by n, a row without n is ignored, no shortening by patch', () => {
    const prompt = composePrompt('lesson', { appName: 'Edufeed' });
    expect(prompt).toContain('Planzeilen tragen ihr n und werden nach n zusammengeführt');
    expect(prompt).toContain('eine Zeile ohne n wird ignoriert');
    expect(prompt).toContain('kürzer wird der Plan durch lesson_state nicht');
  });
});

// live 2026-11-12: an announcement ("lass mich kurz suchen"), then three silent tool calls, then
// the whole lesson: it looked finished after the first sentence; "Entwurf" confused.
describe('Termi does not announce and does not call finished work a draft', () => {
  it.each(/** @type {const} */ (['ask', 'lesson']))(
    '%s: no announcement before a tool call',
    (task) => {
      const prompt = composePrompt(task, { appName: 'Edufeed' });
      expect(prompt).toContain('kündige keine Suche an');
      expect(prompt).not.toContain('höchstens ein kurzer Satz, was du nachschaust');
    }
  );
  it.each(/** @type {const} */ (['ask', 'lesson']))(
    '%s: Stunde/Dokument, Entwurf only for the saved state',
    (task) => {
      expect(composePrompt(task, { appName: 'Edufeed' })).toContain('nenne sie nie „Entwurf“');
    }
  );
  it('ask: a delivered lesson is not an Entwurf', () => {
    expect(composePrompt('ask', { appName: 'Edufeed' })).not.toContain('trotzdem einen Entwurf');
  });
});
