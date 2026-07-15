// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  isSupportedFile,
  isPdfFile,
  inspectFile,
  getStripOps,
  applyOps,
  downloadCleaned,
  groupFieldsByStore
} from '../helpers/metaclean.js';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

describe('isSupportedFile / isPdfFile', () => {
  it('accepts pdf and supported image MIME types', () => {
    for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff', 'image/webp']) {
      expect(isSupportedFile(new File(['x'], 'f', { type }))).toBe(true);
    }
  });

  it('rejects unsupported types', () => {
    for (const type of ['image/gif', 'image/svg+xml', 'video/mp4', 'application/zip']) {
      expect(isSupportedFile(new File(['x'], 'f', { type }))).toBe(false);
    }
  });

  it('falls back to the extension when MIME type is empty', () => {
    expect(isSupportedFile(new File(['x'], 'doc.PDF', { type: '' }))).toBe(true);
    expect(isSupportedFile(new File(['x'], 'pic.jpeg', { type: '' }))).toBe(true);
    expect(isSupportedFile(new File(['x'], 'notes.txt', { type: '' }))).toBe(false);
  });

  it('isPdfFile identifies PDFs by MIME or extension', () => {
    expect(isPdfFile(new File(['x'], 'a', { type: 'application/pdf' }))).toBe(true);
    expect(isPdfFile(new File(['x'], 'a.pdf', { type: '' }))).toBe(true);
    expect(isPdfFile(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(false);
  });
});

describe('inspectFile', () => {
  it('POSTs multipart to /api/metaclean/files and returns the session', async () => {
    const payload = { sessionId: 's1', filename: 'doc.pdf', fields: [] };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const result = await inspectFile(file, fetchMock);
    expect(result).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/metaclean/files');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('file')).toBe(file);
  });

  it('throws the upstream error message on failure', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'too large' }, 413));
    await expect(inspectFile(new File(['x'], 'a.pdf'), fetchMock)).rejects.toThrow('too large');
  });
});

describe('getStripOps / applyOps', () => {
  it('getStripOps GETs the strip ops', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ops: [{ type: 'delete', fieldId: 'x' }] }));
    const result = await getStripOps('s1', fetchMock);
    expect(result.ops).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/metaclean/files/s1/ops/strip');
  });

  it('applyOps POSTs ops with flatten and preserveDates true', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ before: [], after: [], leaks: [] }));
    await applyOps(
      's1',
      { ops: [{ type: 'delete', fieldId: 'x' }], compress: 'balanced' },
      fetchMock
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/metaclean/files/s1/apply');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      ops: [{ type: 'delete', fieldId: 'x' }],
      flatten: true,
      preserveDates: true,
      compress: 'balanced'
    });
  });

  it('applyOps omits compress when off or absent', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ before: [], after: [], leaks: [] }));
    await applyOps('s1', { ops: [], compress: 'off' }, fetchMock);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('compress');
  });
});

describe('downloadCleaned', () => {
  it('returns a File with the given name and type', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['CLEANED']), { status: 200 }));
    const file = await downloadCleaned('s1', 'doc.pdf', 'application/pdf', fetchMock);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/metaclean/files/s1/download');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('doc.pdf');
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('CLEANED');
  });
});

describe('groupFieldsByStore', () => {
  it('groups preserving first-seen store order', () => {
    const fields = [
      { id: 'a', store: 'DocInfo' },
      { id: 'b', store: 'XMP' },
      { id: 'c', store: 'DocInfo' }
    ];
    expect(groupFieldsByStore(fields)).toEqual([
      { store: 'DocInfo', fields: [fields[0], fields[2]] },
      { store: 'XMP', fields: [fields[1]] }
    ]);
  });
});
