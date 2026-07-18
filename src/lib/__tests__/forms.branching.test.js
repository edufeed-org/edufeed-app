/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  evaluateDisplayIf,
  visibleFields,
  orderedSections,
  resolveNextSectionId
} from '$lib/helpers/forms/branching.js';

describe('evaluateDisplayIf', () => {
  it('returns true for missing/empty displayIf', () => {
    expect(evaluateDisplayIf(undefined, {})).toBe(true);
    expect(evaluateDisplayIf({ rules: [] }, {})).toBe(true);
  });

  it('evaluates equals (default) and notEquals', () => {
    const d = /** @type {{ rules: any[] }} */ ({ rules: [{ questionId: 'q1', value: 'yes' }] });
    expect(evaluateDisplayIf(d, { q1: 'yes' })).toBe(true);
    expect(evaluateDisplayIf(d, { q1: 'no' })).toBe(false);
    expect(evaluateDisplayIf(d, {})).toBe(false); // unanswered → rule fails
    const n = /** @type {{ rules: any[] }} */ ({
      rules: [{ questionId: 'q1', operator: 'notEquals', value: 'yes' }]
    });
    expect(evaluateDisplayIf(n, { q1: 'no' })).toBe(true);
  });

  it('contains matches semicolon-joined multi-select answers', () => {
    const d = /** @type {{ rules: any[] }} */ ({
      rules: [{ questionId: 'q1', operator: 'contains', value: 'b' }]
    });
    expect(evaluateDisplayIf(d, { q1: 'a;b;c' })).toBe(true);
    expect(evaluateDisplayIf(d, { q1: 'a;c' })).toBe(false);
  });

  it('contains does not substring-match across joined optionIds', () => {
    const d = /** @type {{ rules: any[] }} */ ({
      rules: [{ questionId: 'q1', operator: 'contains', value: 'sci' }]
    });
    expect(evaluateDisplayIf(d, { q1: 'science;math' })).toBe(false); // no id 'sci' selected
    expect(evaluateDisplayIf(d, { q1: 'sci;math' })).toBe(true);
    expect(evaluateDisplayIf(d, { q1: 'my science essay' })).toBe(true); // free text keeps substring
  });

  it('numeric operators coerce', () => {
    const d = /** @type {{ rules: any[] }} */ ({
      rules: [{ questionId: 'age', operator: 'greaterThanEqual', value: '18' }]
    });
    expect(evaluateDisplayIf(d, { age: '18' })).toBe(true);
    expect(evaluateDisplayIf(d, { age: '17' })).toBe(false);
  });

  it('chains AND/OR and nests groups', () => {
    const d = /** @type {{ rules: any[] }} */ ({
      rules: [
        { questionId: 'a', value: '1', nextLogic: 'OR' },
        {
          rules: [
            { questionId: 'b', value: '2' },
            { questionId: 'c', value: '3' }
          ]
        }
      ]
    });
    expect(evaluateDisplayIf(d, { a: '1' })).toBe(true);
    expect(evaluateDisplayIf(d, { a: 'x', b: '2', c: '3' })).toBe(true);
    expect(evaluateDisplayIf(d, { a: 'x', b: '2', c: 'x' })).toBe(false);
  });
});

describe('visibleFields', () => {
  it('filters fields whose displayIf fails', () => {
    const fields = [
      { id: 'kind', type: 'radio', label: '', options: {} },
      {
        id: 'school-detail',
        type: 'text',
        label: '',
        options: { displayIf: { rules: [{ questionId: 'kind', value: 'schule' }] } }
      }
    ];
    expect(visibleFields(fields, { kind: 'schule' }).map((f) => f.id)).toEqual([
      'kind',
      'school-detail'
    ]);
    expect(visibleFields(fields, { kind: 'konfi' }).map((f) => f.id)).toEqual(['kind']);
  });
});

// The Bildungsbereich shape: step 1 routes into per-branch sections.
const bildungsbereich = {
  sections: [
    { id: 'start', title: 'Bildungsbereich', questionIds: ['bereich'] },
    { id: 'sec-schule', title: 'Schule', questionIds: ['schulfach'] },
    { id: 'sec-konfi', title: 'Konfi', questionIds: ['zielgruppe'] },
    { id: 'common', title: 'Rechte', questionIds: ['license'] }
  ],
  fields: [
    {
      id: 'bereich',
      type: 'radio',
      label: 'Bildungsbereich?',
      options: {
        options: [
          { id: 'schule', label: 'Schule', nextSection: 'sec-schule' },
          { id: 'konfi', label: 'Konfi', nextSection: 'sec-konfi' }
        ]
      }
    },
    { id: 'schulfach', type: 'text', label: '', options: {} },
    { id: 'zielgruppe', type: 'text', label: '', options: {} },
    { id: 'license', type: 'text', label: '', options: {} }
  ]
};

describe('orderedSections / resolveNextSectionId', () => {
  it('sorts by order with index fallback and collects unassigned fields', () => {
    const t = {
      sections: [
        { id: 'b', title: 'B', questionIds: ['f2'], order: 2 },
        { id: 'a', title: 'A', questionIds: ['f1'], order: 1 }
      ],
      fields: [
        { id: 'f1', type: 'text', label: '', options: {} },
        { id: 'f2', type: 'text', label: '', options: {} },
        { id: 'stray', type: 'text', label: '', options: {} }
      ]
    };
    const secs = orderedSections(t);
    expect(secs.map((s) => s.id)).toEqual(['a', 'b', '__rest']);
    expect(secs[2].questionIds).toEqual(['stray']);
  });

  it('returns [] when the template has no sections', () => {
    expect(orderedSections({ sections: [], fields: bildungsbereich.fields })).toEqual([]);
  });

  it('routes by the selected option nextSection, else linear, null at end', () => {
    const secs = orderedSections(bildungsbereich);
    expect(resolveNextSectionId('start', secs, bildungsbereich.fields, { bereich: 'konfi' })).toBe(
      'sec-konfi'
    );
    expect(resolveNextSectionId('start', secs, bildungsbereich.fields, { bereich: 'schule' })).toBe(
      'sec-schule'
    );
    // linear when no routing matches
    expect(resolveNextSectionId('sec-schule', secs, bildungsbereich.fields, {})).toBe('sec-konfi');
    expect(resolveNextSectionId('common', secs, bildungsbereich.fields, {})).toBe(null);
  });
});
