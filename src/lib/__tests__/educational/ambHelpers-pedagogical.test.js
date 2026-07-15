/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getAMBTeaches,
  getAMBAssesses,
  getAMBCompetencyRequired
} from '$lib/helpers/educational/ambHelpers.js';

// Flattened concept runs as emitted by ambToNostr's addConceptTags():
//   ["teaches:id", uri], ["teaches:prefLabel:<lang>", label], ["teaches:type", "Concept"]
const event = {
  tags: [
    ['d', 'x'],
    ['teaches:id', 'https://lehrplan.example/topic-1'],
    ['teaches:prefLabel:de', 'Bruchrechnung'],
    ['teaches:type', 'Concept'],
    ['teaches:id', 'https://lehrplan.example/topic-2'],
    ['teaches:prefLabel:de', 'Geometrie'],
    ['teaches:type', 'Concept'],
    ['assesses:id', 'https://lehrplan.example/topic-3'],
    ['assesses:prefLabel:de', 'Kopfrechnen'],
    ['assesses:type', 'Concept'],
    ['competencyRequired:id', 'https://lehrplan.example/topic-4'],
    ['competencyRequired:prefLabel:de', 'Grundrechenarten'],
    ['competencyRequired:type', 'Concept']
  ]
};

describe('pedagogical concept readers (edit-mode prefill)', () => {
  it('parses teaches concepts into the CurriculumPicker shape', () => {
    expect(getAMBTeaches(event, 'de')).toEqual([
      {
        id: 'https://lehrplan.example/topic-1',
        type: 'Concept',
        prefLabel: { de: 'Bruchrechnung' }
      },
      { id: 'https://lehrplan.example/topic-2', type: 'Concept', prefLabel: { de: 'Geometrie' } }
    ]);
  });

  it('parses assesses and competencyRequired', () => {
    expect(getAMBAssesses(event, 'de')).toEqual([
      { id: 'https://lehrplan.example/topic-3', type: 'Concept', prefLabel: { de: 'Kopfrechnen' } }
    ]);
    expect(getAMBCompetencyRequired(event, 'de')).toEqual([
      {
        id: 'https://lehrplan.example/topic-4',
        type: 'Concept',
        prefLabel: { de: 'Grundrechenarten' }
      }
    ]);
  });

  it('returns [] when the event has no such tags', () => {
    const bare = { tags: [['d', 'x']] };
    expect(getAMBTeaches(bare, 'de')).toEqual([]);
    expect(getAMBAssesses(bare, 'de')).toEqual([]);
    expect(getAMBCompetencyRequired(bare, 'de')).toEqual([]);
  });
});
