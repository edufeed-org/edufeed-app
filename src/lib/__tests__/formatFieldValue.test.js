/**
 * formatFieldValue — pure helper, mirrors the dialog's display logic
 * with paired-key (gradeLevels/gradeLevelLabels) support.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { formatFieldValue, formatAiFieldValue } from '$lib/helpers/educational/formatFieldValue.js';

describe('formatFieldValue', () => {
  it('returns plain string fields verbatim', () => {
    expect(formatFieldValue('name', { name: 'Foo' }, {})).toBe('Foo');
    expect(formatFieldValue('description', { description: '' }, {})).toBe('');
    expect(formatFieldValue('inLanguage', {}, {})).toBe('');
  });

  it('joins simple {id, label} arrays by label, falling back to id', () => {
    const fd = {
      learningResourceType: [
        { id: 'https://w3id.org/kim/hcrt/text', label: 'Text' },
        { id: 'https://w3id.org/kim/hcrt/video' } // no label
      ]
    };
    expect(formatFieldValue('learningResourceType', fd, {})).toBe(
      'Text, https://w3id.org/kim/hcrt/video'
    );
  });

  it('reads the labels mirror for paired-key fields (gradeLevels regression)', () => {
    // Bug: previously formatValue read formData.gradeLevels (string IDs only)
    // and rendered "nostr:39738:..." as the displayed value. The labels mirror
    // (formData.gradeLevelLabels) carries the human-readable labels.
    const fd = {
      gradeLevels: ['nostr:39738:abc:7', 'nostr:39738:abc:8'],
      gradeLevelLabels: [
        { id: 'nostr:39738:abc:7', label: 'Jahrgang 7' },
        { id: 'nostr:39738:abc:8', label: 'Jahrgang 8' }
      ]
    };
    expect(formatFieldValue('gradeLevels', fd, {})).toBe('Jahrgang 7, Jahrgang 8');
  });

  it('handles all four paired-key fields', () => {
    const cases = [
      ['gradeLevels', 'gradeLevelLabels'],
      ['schoolTypes', 'schoolTypeLabels'],
      ['didacticConcepts', 'didacticConceptLabels'],
      ['methods', 'methodLabels']
    ];
    for (const [key, labelsKey] of cases) {
      const fd = { [key]: ['x:1'], [labelsKey]: [{ id: 'x:1', label: 'L1' }] };
      expect(formatFieldValue(key, fd, {})).toBe('L1');
    }
  });

  it('falls back to id when paired labels mirror is missing or empty', () => {
    expect(formatFieldValue('gradeLevels', { gradeLevels: ['x:1'] }, {})).toBe('x:1');
  });

  it('reads ekwFachrichtung from aboutByVocab (not formData)', () => {
    const abv = {
      ekwFachrichtung: [
        { id: 'fr:1', label: 'Religion' },
        { id: 'fr:2', label: 'Ethik' }
      ]
    };
    expect(formatFieldValue('ekwFachrichtung', {}, abv)).toBe('Religion, Ethik');
  });

  it('joins string arrays with commas', () => {
    expect(formatFieldValue('keywords', { keywords: ['a', 'b'] }, {})).toBe('a, b');
  });

  it('returns empty string for missing field', () => {
    expect(formatFieldValue('name', {}, {})).toBe('');
    expect(formatFieldValue('keywords', {}, {})).toBe('');
  });
});

describe('formatAiFieldValue', () => {
  it('renders concept arrays via prefLabel (canonical from server) before label and id', () => {
    const ai = {
      payload: {
        learningResourceType: [
          { id: 'https://w3id.org/kim/hcrt/text', prefLabel: 'Text' },
          { id: 'https://w3id.org/kim/hcrt/video', label: 'Video (legacy)' },
          { id: 'https://w3id.org/kim/hcrt/audio' }
        ]
      }
    };
    expect(formatAiFieldValue('learningResourceType', ai)).toBe(
      'Text, Video (legacy), https://w3id.org/kim/hcrt/audio'
    );
  });

  it('returns plain string fields verbatim from payload', () => {
    expect(formatAiFieldValue('name', { payload: { name: 'X' } })).toBe('X');
  });

  it('returns empty string when aiSuggestions is null or has no payload key', () => {
    expect(formatAiFieldValue('name', null)).toBe('');
    expect(formatAiFieldValue('name', { payload: {} })).toBe('');
  });
});
