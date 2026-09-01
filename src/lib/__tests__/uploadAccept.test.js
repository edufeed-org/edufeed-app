/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { NO_URL_UPLOAD_ACCEPT } from '$lib/helpers/educational/uploadAccept.js';

/**
 * The Step-2 "no URL" uploader is the only upload surface in the resource
 * wizard's create flow, so its `accept` list decides which files the OS file
 * picker greys out. Images were missing from it until 2026-08-25, which made
 * image-only learning material un-pickable (drag-and-drop still worked).
 */
describe('NO_URL_UPLOAD_ACCEPT', () => {
  const entries = NO_URL_UPLOAD_ACCEPT.split(',');

  it('accepts images', () => {
    expect(entries).toContain('image/*');
  });

  it('still accepts the document formats the AI extractor grounds on', () => {
    for (const ext of ['.pdf', '.ppt', '.pptx', '.odp', '.doc', '.docx', '.odt']) {
      expect(entries).toContain(ext);
    }
    expect(entries).toContain('application/pdf');
  });

  it('still accepts interactive packages', () => {
    for (const ext of ['.h5p', '.xdc', '.html', '.htm']) {
      expect(entries).toContain(ext);
    }
    expect(entries).toContain('application/x-webxdc');
  });

  it('has no blank or duplicate entries', () => {
    expect(entries.every((e) => e === e.trim() && e.length > 0)).toBe(true);
    expect(new Set(entries).size).toBe(entries.length);
  });
});
