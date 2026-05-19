/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formDataToKonfiTags } from '$lib/helpers/educational/formDataToKonfiTags.js';
import { BILDUNGSBEREICHE } from '$lib/helpers/educational/bildungsbereich.js';

const SUB_STEPS = BILDUNGSBEREICHE.konfi.step4SubSteps ?? [];

describe('formDataToKonfiTags — allowCustom', () => {
  it('emits zeitstruktur:custom scalar tag when konfiZeitstrukturCustom is set', () => {
    const tags = formDataToKonfiTags(
      { konfiZeitstrukturCustom: '3-Tage-Freizeit' },
      SUB_STEPS,
      undefined
    );
    expect(tags).toContainEqual(['ext:ekw:konfi:zeitstruktur:custom', '3-Tage-Freizeit']);
  });

  it('emits both vocab triples AND the custom scalar when both are set (coexist)', () => {
    const tags = formDataToKonfiTags(
      {
        konfiZeitstrukturIds: ['urn:zt:wochenende'],
        konfiZeitstrukturLabels: [{ id: 'urn:zt:wochenende', label: 'Wochenende' }],
        konfiZeitstrukturCustom: '3-Tage-Freizeit'
      },
      SUB_STEPS,
      undefined
    );
    expect(tags).toContainEqual(['ext:ekw:konfi:zeitstruktur:id', 'urn:zt:wochenende']);
    expect(tags).toContainEqual(['ext:ekw:konfi:zeitstruktur:prefLabel:de', 'Wochenende']);
    expect(tags).toContainEqual(['ext:ekw:konfi:zeitstruktur:type', 'Concept']);
    expect(tags).toContainEqual(['ext:ekw:konfi:zeitstruktur:custom', '3-Tage-Freizeit']);
  });

  it('does not emit the custom tag when value is empty / whitespace / undefined', () => {
    for (const value of ['', '   ', undefined, null]) {
      const tags = formDataToKonfiTags({ konfiZeitstrukturCustom: value }, SUB_STEPS, undefined);
      expect(tags.some((t) => t[0] === 'ext:ekw:konfi:zeitstruktur:custom')).toBe(false);
    }
  });

  it('does not emit custom for vocab fields without allowCustom (e.g. Lernformat)', () => {
    const tags = formDataToKonfiTags(
      { konfiLernformatCustom: 'should be ignored' },
      SUB_STEPS,
      undefined
    );
    expect(tags.some((t) => t[0] === 'ext:ekw:konfi:lernformat:custom')).toBe(false);
  });
});
