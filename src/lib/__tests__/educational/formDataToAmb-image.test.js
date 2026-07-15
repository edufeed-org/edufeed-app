/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';

const baseFormData = {
  name: 'Test resource',
  description: 'A description',
  slug: 'test-slug',
  learningResourceType: 'https://w3id.org/kim/hcrt/slide',
  learningResourceTypeLabel: 'Präsentation',
  about: [],
  aboutLabels: [],
  inLanguage: 'de',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  creators: [],
  keywords: [],
  files: []
};

describe('convertFormDataToAMB — image', () => {
  it('maps formData.image to amb.image', () => {
    const amb = convertFormDataToAMB({
      ...baseFormData,
      image: 'https://blossom.example/abc.png'
    });
    expect(amb.image).toBe('https://blossom.example/abc.png');
  });

  it('trims the image URL', () => {
    const amb = convertFormDataToAMB({ ...baseFormData, image: '  https://x.example/y.png  ' });
    expect(amb.image).toBe('https://x.example/y.png');
  });

  it('omits image when empty or whitespace', () => {
    expect(convertFormDataToAMB({ ...baseFormData, image: '' })).not.toHaveProperty('image');
    expect(convertFormDataToAMB({ ...baseFormData, image: '   ' })).not.toHaveProperty('image');
    expect(convertFormDataToAMB(baseFormData)).not.toHaveProperty('image');
  });
});

describe('convertFormDataToAMB — encoding MIME type', () => {
  const file = {
    url: 'https://blossom.example/a93.pdf',
    name: 'a93.pdf',
    size: 931940,
    sha256: 'a93'
  };

  it('reads mimeType (actions-layer shape)', () => {
    const amb = convertFormDataToAMB({
      ...baseFormData,
      files: [{ ...file, mimeType: 'application/pdf' }]
    });
    expect(amb.encoding[0].encodingFormat).toBe('application/pdf');
  });

  it('falls back to type (wizard/LicensedFileInput shape)', () => {
    const amb = convertFormDataToAMB({
      ...baseFormData,
      files: /** @type {any} */ ([{ ...file, type: 'application/pdf' }])
    });
    expect(amb.encoding[0].encodingFormat).toBe('application/pdf');
  });
});
