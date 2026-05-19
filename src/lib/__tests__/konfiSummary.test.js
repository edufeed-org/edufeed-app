/**
 * Contract for `buildKonfiSummaryRows`: project the konfi step-4 slots of
 * `formData` onto an ordered list of summary rows for the wizard's Preview step.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildKonfiSummaryRows } from '$lib/helpers/educational/konfiSummary.js';

const YES_NO = { yes: 'Ja', no: 'Nein' };

describe('buildKonfiSummaryRows', () => {
  it('returns an empty list when no konfi slots are populated', () => {
    expect(buildKonfiSummaryRows({}, YES_NO)).toEqual([]);
  });

  it('emits vocab rows comma-joined from <schemeKey>Labels', () => {
    const rows = buildKonfiSummaryRows(
      {
        konfiZielgruppenLabels: [
          { id: 'zg1', label: 'Konfis' },
          { id: 'zg2', label: 'Teamer' }
        ],
        konfiThemenLabels: [{ id: 't1', label: 'Glauben' }]
      },
      YES_NO
    );
    expect(rows).toEqual([
      { labelKey: 'konfi_field_zielgruppen', value: 'Konfis, Teamer', multiline: false },
      { labelKey: 'konfi_field_themen', value: 'Glauben', multiline: false }
    ]);
  });

  it('falls back to id when a vocab label is missing', () => {
    const rows = buildKonfiSummaryRows(
      { konfiLernformatLabels: [{ id: 'urn:lf:x', label: '' }] },
      YES_NO
    );
    expect(rows[0]).toEqual({
      labelKey: 'konfi_field_lernformat',
      value: 'urn:lf:x',
      multiline: false
    });
  });

  it('renders plainLanguage only when explicitly true', () => {
    expect(buildKonfiSummaryRows({ plainLanguage: true }, YES_NO)).toEqual([
      { labelKey: 'konfi_field_plain_language', value: 'Ja', multiline: false }
    ]);
    expect(buildKonfiSummaryRows({ plainLanguage: false }, YES_NO)).toEqual([]);
    expect(buildKonfiSummaryRows({ plainLanguage: undefined }, YES_NO)).toEqual([]);
  });

  it('renders requiredMaterialsNote as a multiline row when non-blank', () => {
    expect(
      buildKonfiSummaryRows({ requiredMaterialsNote: 'Stifte, Papier, Bibel' }, YES_NO)
    ).toEqual([
      {
        labelKey: 'konfi_field_required_materials_note',
        value: 'Stifte, Papier, Bibel',
        multiline: true
      }
    ]);
  });

  it('skips whitespace-only scalar text', () => {
    expect(buildKonfiSummaryRows({ requiredMaterialsNote: '   \n\t  ' }, YES_NO)).toEqual([]);
  });

  it('emits every konfi field in sub-step (4a → 4b → 4c) order', () => {
    const rows = buildKonfiSummaryRows(
      {
        konfiZielgruppenLabels: [{ id: 'a', label: 'A' }],
        konfiLernformatLabels: [{ id: 'b', label: 'B' }],
        konfiZeitstrukturLabels: [{ id: 'c', label: 'C' }],
        konfiBeteiligteLabels: [{ id: 'd', label: 'D' }],
        konfiThemenLabels: [{ id: 'e', label: 'E' }],
        konfiDimensionenLabels: [{ id: 'f', label: 'F' }],
        konfiMethodeLabels: [{ id: 'g', label: 'G' }],
        plainLanguage: true,
        konfiMaterialaufwandLabels: [{ id: 'h', label: 'H' }],
        requiredMaterialsNote: 'note',
        konfiTechnikbedarfLabels: [{ id: 'i', label: 'I' }],
        konfiLernorteLabels: [{ id: 'j', label: 'J' }],
        landeskirchenLabels: [{ id: 'k', label: 'K' }]
      },
      YES_NO
    );
    expect(rows.map((r) => r.labelKey)).toEqual([
      'konfi_field_zielgruppen',
      'konfi_field_lernformat',
      'konfi_field_zeitstruktur',
      'konfi_field_beteiligte',
      'konfi_field_themen',
      'konfi_field_dimensionen',
      'konfi_field_methode',
      'konfi_field_plain_language',
      'konfi_field_materialaufwand',
      'konfi_field_required_materials_note',
      'konfi_field_technikbedarf',
      'konfi_field_lernorte',
      'konfi_field_landeskirche'
    ]);
  });

  it('emits a separate row for konfiZeitstrukturCustom alongside vocab picks', () => {
    const rows = buildKonfiSummaryRows(
      {
        konfiZeitstrukturLabels: [{ id: 'urn:zt:we', label: 'Wochenende' }],
        konfiZeitstrukturCustom: '3-Tage-Freizeit'
      },
      YES_NO
    );
    expect(rows).toEqual([
      { labelKey: 'konfi_field_zeitstruktur', value: 'Wochenende', multiline: false },
      { labelKey: 'konfi_field_zeitstruktur_custom', value: '3-Tage-Freizeit', multiline: false }
    ]);
  });

  it('emits only the custom row when no vocab picks are present', () => {
    const rows = buildKonfiSummaryRows({ konfiZeitstrukturCustom: 'monatlich' }, YES_NO);
    expect(rows).toEqual([
      { labelKey: 'konfi_field_zeitstruktur_custom', value: 'monatlich', multiline: false }
    ]);
  });

  it('skips the custom row when the value is empty / whitespace', () => {
    expect(buildKonfiSummaryRows({ konfiZeitstrukturCustom: '   ' }, YES_NO)).toEqual([]);
  });
});
