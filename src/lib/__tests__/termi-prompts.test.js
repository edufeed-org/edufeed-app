/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPTS } from '$lib/server/termi/prompts.js';

describe('Termi ask prompt', () => {
  it('has the document rule: # title, ## sections, search_passages, no links', () => {
    expect(SYSTEM_PROMPTS.ask).toContain(
      "- Bittet jemand um eine Zusammenfassung, ein Handout, eine Übersicht, ein Arbeitsblatt oder ein Dokument (z. B. 'eine A4-Seite'), schreibe ein gegliedertes Markdown-Dokument: erste Zeile `# <Titel>`, dann 3–6 Abschnitte mit `##`-Überschriften und kurzen Absätzen oder Listen, insgesamt 400–700 Wörter; hole dir dafür mit search_passages ausreichend Belege (mehrere Aufrufe mit verschiedenen Fragen sind erlaubt) und stütze jede Aussage auf die gefundenen Quellen; nenne Quellen im Text nur mit Titel in Anführungszeichen, nie als Link — die Quellenliste mit Lizenzen wird automatisch angehängt."
    );
  });
});
