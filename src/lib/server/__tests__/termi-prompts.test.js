/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPTS } from '../termi/prompts.js';

describe('SYSTEM_PROMPTS', () => {
  it('has the ask task only', () => {
    expect(Object.keys(SYSTEM_PROMPTS)).toEqual(['ask']);
  });
});

describe('SYSTEM_PROMPTS.ask', () => {
  const prompt = SYSTEM_PROMPTS.ask;

  it('stays short', () => {
    expect(prompt.split('\n').length).toBeLessThanOrEqual(25);
  });

  it('says the results show as cards: short answers, markdown structure, no links', () => {
    expect(prompt).toContain('als Karten');
    expect(prompt).toContain('ein bis drei kurzen Sätzen');
    expect(prompt).toContain(
      'Gliedere längere Antworten mit kurzen Überschriften und Listen (Markdown); keine Links im Text — Quellen erscheinen als Karten.'
    );
    expect(prompt).toContain('keine Trefferliste, keine Links, keine URLs');
  });

  it('a LiaScript course is a document request of its own, written as LiaScript (verbatim)', () => {
    const lines = prompt.split('\n');
    const doc = lines.findIndex((l) => l.startsWith('- Nur wenn jemand ausdrücklich ein Dokument'));
    expect(lines[doc]).toContain(
      'eine Zusammenfassung zum Thema …, ein LiaScript-Kurs oder ein Kurs mit Verständnisfragen —'
    );
    expect(lines[doc + 1]).toBe(
      '- Wird ausdrücklich ein LiaScript-Kurs gewünscht (Stichworte: LiaScript, Kurs, interaktiv, Verständnisfragen, Quiz), schreibe ein Dokument als LiaScript: ganz oben der Kommentarblock `<!-- author:  version: 1.0.0  language: de  narrator: Deutsch Female  comment: <ein Satz> -->` (jede Angabe in einer eigenen Zeile, hinter `author:` steht nichts — die App trägt den Namen ein), jede `#`/`##`-Überschrift ist eine Folie, und am Ende jedes Abschnitts höchstens eine Verständnisfrage in LiaScript-Syntax: Einfachauswahl `[( )] falsch` / `[(X)] richtig`, Mehrfachauswahl `[[ ]]`/`[[X]]`, Lückentext `[[Antwort]]` — jede Frage in eigenen Zeilen mit Leerzeile davor und danach. Keine Makros (`@…`), kein HTML außer dem Kommentarblock. Ohne diese Stichworte bleibt es gewöhnliches Markdown.'
    );
  });

  it('routes question types to their tools', () => {
    expect(prompt).toMatch(/WIE etwas geht oder WARUM[^\n]*search_passages/);
    // Listing questions ("was gibt es") must not route to passages.
    expect(prompt).not.toMatch(/„was“[^\n]*search_passages/);
    expect(prompt).toMatch(
      /Materialien, Angeboten oder Beispielen \(was gibt es[^\n]*search_content oder search_resources/
    );
    expect(prompt).toContain('Titel, Herausgeber und Lizenz');
    expect(prompt).toMatch(/„wer …“[^\n]*find_people/);
    expect(prompt).toMatch(
      /„welche Community …“[^\n]*find_community und nenne die Community \(oder Communities\) im Satz/
    );
    expect(prompt).toContain('höchstens zweimal search_passages');
  });

  it('answers "where is my X" with show_pages (verbatim)', () => {
    expect(prompt).toContain(
      "Fragen nach den eigenen Nachrichten, Terminen, Lesezeichen, Einstellungen, dem eigenen Profil oder danach, wo etwas in der App ist, beantwortest du mit show_pages (höchstens zwei ids) — ein kurzer Satz davor ist erlaubt. Antworte nie mit 'ich habe keinen Zugriff'."
    );
  });

  it('names unreachable sources and says plainly when nothing fits', () => {
    expect(prompt).toContain('sourcesUnavailable');
    expect(prompt).toContain('nicht erreichbar');
    expect(prompt).toContain('Passt nichts');
  });

  it('keeps the spike rules: tools only, no invention, no publication claims, du', () => {
    expect(prompt).toContain('Nutze nur die Werkzeuge');
    expect(prompt).toContain('Erfinde niemals');
    expect(prompt).toContain('Behaupte nie, etwas sei importiert, gespeichert oder veröffentlicht');
    expect(prompt).toContain('„du“');
    expect(prompt).toContain('Sprache der Nutzerin oder des Nutzers');
  });
});
