/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { detectAudience, withoutAudienceQualifier } from '../audience.js';

describe('detectAudience', () => {
  it.each([
    ['Finde Material zu Fotosynthese, Klasse 7', 'school'],
    ['Arbeitsblätter Bruchrechnung für die 5. Klasse', 'school'],
    ['Demokratie für Schülerinnen der Sekundarstufe I', 'school'],
    ['Material fürs Gymnasium zu Lyrik', 'school'],
    ['Wie aktiviere ich Studierende in der Vorlesung?', 'higher-education'],
    ['OER für die Hochschullehre', 'higher-education'],
    ['Seminar zu Forschungsmethoden an der Universität', 'higher-education'],
    ['lecture material on statistics for undergraduates', 'higher-education']
  ])('%s → %s', (text, audience) => {
    expect(detectAudience(text)).toBe(audience);
  });

  it.each([
    'Finde Material zu Demokratie',
    'Übergang von der Schule: Schüler werden Studierende',
    'Klassenarbeit ohne Stufe',
    'Wie veröffentliche ich auf Nostr?'
  ])('%s → none', (text) => {
    expect(detectAudience(text)).toBeUndefined();
  });
});

describe('withoutAudienceQualifier', () => {
  it.each([
    ['Fotosynthese, Klasse 7', 'Fotosynthese'],
    ['Fotosynthese für Studierende', 'Fotosynthese'],
    ['Arbeitsblätter Bruchrechnung für die 5. Klasse', 'Arbeitsblätter Bruchrechnung'],
    ['Demokratie in der Sekundarstufe I', 'Demokratie'],
    ['Lyrik für das Gymnasium, Klasse 9-10', 'Lyrik'],
    ['statistics for undergraduates', 'statistics for undergraduates'],
    ['statistics for students', 'statistics']
  ])('%s → %s', (text, query) => {
    expect(withoutAudienceQualifier(text)).toBe(query);
  });

  it.each(['Wie aktiviere ich Studierende in der Vorlesung?', 'Klasse 7', 'Schule ohne Rassismus'])(
    'keeps "%s"',
    (text) => {
      expect(withoutAudienceQualifier(text)).toBe(text);
    }
  );
});
