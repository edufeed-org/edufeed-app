// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  inspectFile: vi.fn(),
  getStripOps: vi.fn(),
  applyOps: vi.fn(),
  downloadCleaned: vi.fn()
}));

vi.mock('$lib/helpers/metaclean.js', async () => {
  const actual = await vi.importActual('$lib/helpers/metaclean.js');
  return {
    ...actual,
    inspectFile: mocks.inspectFile,
    getStripOps: mocks.getStripOps,
    applyOps: mocks.applyOps,
    downloadCleaned: mocks.downloadCleaned
  };
});

vi.mock('$lib/paraglide/messages', () => ({
  metaclean_title: () => 'Check metadata',
  metaclean_subtitle: () => 'Subtitle',
  metaclean_inspecting: () => 'Reading metadata…',
  metaclean_no_fields: () => 'No metadata found in this file.',
  metaclean_sensitive_badge: () => 'sensitive',
  metaclean_strip_toggle: () => 'Remove tool provenance',
  metaclean_strip_description: () => 'Strip description',
  metaclean_strip_nothing: () => 'Nothing to remove',
  metaclean_strip_list_title: () => 'Fields that will be removed',
  metaclean_compress_label: () => 'Compress embedded images (PDF, lossy)',
  metaclean_compress_off: () => 'Off',
  metaclean_compress_balanced: () => 'Balanced',
  metaclean_compress_strong: () => 'Strong',
  metaclean_apply: () => 'Clean file',
  metaclean_applying: () => 'Cleaning…',
  metaclean_result_title: () => 'Verified result',
  metaclean_fields_before_after: ({ before, after }) => `Fields: ${before} -> ${after}`,
  metaclean_size_before_after: ({ before, after }) => `Size: ${before} -> ${after}`,
  metaclean_oversized_hint: ({ limit }) => `Over upload limit of ${limit}`,
  metaclean_still_oversized: ({ limit }) => `Still over upload limit of ${limit}`,
  metaclean_leaks_clean: () => 'Leak scan: clean',
  metaclean_leaks_found: () => 'Leaks found',
  metaclean_use_cleaned: () => 'Use cleaned file',
  metaclean_keep_original: () => 'Continue with original',
  metaclean_error_title: () => 'Metadata check failed',
  metaclean_retry: () => 'Retry'
}));

import MetadataCleanerModal from '../shared/MetadataCleanerModal.svelte';

const pdfFile = () => new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
const pngFile = () => new File(['png'], 'pic.png', { type: 'image/png' });

const FIELDS = [
  {
    id: 'pdf.docinfo./Producer',
    store: 'DocInfo',
    key: '/Producer',
    label: '/Producer',
    value: 'Canva',
    sensitive: true
  },
  {
    id: 'xmp.dc:title',
    store: 'XMP',
    key: 'dc:title',
    label: 'dc:title',
    value: 'Doc',
    sensitive: false
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspectFile.mockResolvedValue({ sessionId: 's1', filename: 'doc.pdf', fields: FIELDS });
  mocks.getStripOps.mockResolvedValue({
    ops: [{ type: 'delete', fieldId: 'pdf.docinfo./Producer' }]
  });
  mocks.applyOps.mockResolvedValue({
    before: FIELDS,
    after: [FIELDS[1]],
    leaks: [],
    sizeBefore: 1000,
    sizeAfter: 800
  });
  mocks.downloadCleaned.mockResolvedValue(
    new File(['clean'], 'doc.pdf', { type: 'application/pdf' })
  );
});

describe('MetadataCleanerModal', () => {
  it('renders nothing when closed', () => {
    const { queryByText } = render(MetadataCleanerModal, {
      props: { open: false, file: pdfFile(), ondone: vi.fn() }
    });
    expect(queryByText('Check metadata')).toBeNull();
  });

  it('inspects on open and shows fields grouped by store with sensitive badge', async () => {
    const { getByText, getAllByText } = render(MetadataCleanerModal, {
      props: { open: true, file: pdfFile(), ondone: vi.fn() }
    });
    await waitFor(() => expect(getByText('Canva')).toBeTruthy());
    expect(getByText('DocInfo')).toBeTruthy();
    expect(getByText('XMP')).toBeTruthy();
    expect(getAllByText('sensitive')).toHaveLength(1);
    expect(mocks.inspectFile).toHaveBeenCalledOnce();
    expect(mocks.getStripOps).toHaveBeenCalledWith('s1');
  });

  it('shows the compression picker for PDFs only', async () => {
    const pdf = render(MetadataCleanerModal, {
      props: { open: true, file: pdfFile(), ondone: vi.fn() }
    });
    await waitFor(() =>
      expect(pdf.getByText('Compress embedded images (PDF, lossy)')).toBeTruthy()
    );
    pdf.unmount();

    const png = render(MetadataCleanerModal, {
      props: { open: true, file: pngFile(), ondone: vi.fn() }
    });
    await waitFor(() => expect(png.getByText('Canva')).toBeTruthy());
    expect(png.queryByText('Compress embedded images (PDF, lossy)')).toBeNull();
  });

  it('applies strip ops, shows result, and returns the cleaned file', async () => {
    const ondone = vi.fn();
    const { getByText, getByTestId } = render(MetadataCleanerModal, {
      props: { open: true, file: pdfFile(), ondone }
    });
    await waitFor(() => expect(getByText('Canva')).toBeTruthy());

    await fireEvent.click(getByTestId('metaclean-apply'));
    await waitFor(() => expect(getByText('Verified result')).toBeTruthy());
    expect(mocks.applyOps).toHaveBeenCalledWith('s1', {
      ops: [{ type: 'delete', fieldId: 'pdf.docinfo./Producer' }],
      compress: 'off'
    });
    expect(getByText('Leak scan: clean')).toBeTruthy();

    await fireEvent.click(getByText('Use cleaned file'));
    await waitFor(() => expect(ondone).toHaveBeenCalledOnce());
    expect(ondone.mock.calls[0][0].name).toBe('doc.pdf');
    expect(await ondone.mock.calls[0][0].text()).toBe('clean');
  });

  it('returns the original file on "Continue with original"', async () => {
    const ondone = vi.fn();
    const file = pdfFile();
    const { getByText } = render(MetadataCleanerModal, {
      props: { open: true, file, ondone }
    });
    await waitFor(() => expect(getByText('Canva')).toBeTruthy());
    await fireEvent.click(getByText('Continue with original'));
    expect(ondone).toHaveBeenCalledOnce();
    expect(ondone.mock.calls[0][0]).toBe(file);
    expect(mocks.applyOps).not.toHaveBeenCalled();
  });

  it('dismisses on backdrop click, returning the original file', async () => {
    const ondone = vi.fn();
    const file = pdfFile();
    const { getByText, getByLabelText } = render(MetadataCleanerModal, {
      props: { open: true, file, ondone }
    });
    await waitFor(() => expect(getByText('Canva')).toBeTruthy());
    await fireEvent.click(getByLabelText('Close'));
    expect(ondone).toHaveBeenCalledOnce();
    expect(ondone.mock.calls[0][0]).toBe(file);
    expect(mocks.applyOps).not.toHaveBeenCalled();
  });

  it('shows an oversized hint in the review phase when the file exceeds maxSize', async () => {
    const file = pdfFile();
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });
    const { getByText } = render(MetadataCleanerModal, {
      props: { open: true, file, ondone: vi.fn(), maxSize: 5 * 1024 * 1024 }
    });
    await waitFor(() => expect(getByText('Canva')).toBeTruthy());
    expect(getByText('Over upload limit of 5 MB')).toBeTruthy();
  });

  it('shows no oversized hint when the file fits maxSize', async () => {
    const { getByText, queryByText } = render(MetadataCleanerModal, {
      props: { open: true, file: pdfFile(), ondone: vi.fn(), maxSize: 5 * 1024 * 1024 }
    });
    await waitFor(() => expect(getByText('Canva')).toBeTruthy());
    expect(queryByText(/Over upload limit/)).toBeNull();
  });

  it('warns in the result phase when the cleaned file still exceeds maxSize', async () => {
    mocks.applyOps.mockResolvedValue({
      before: FIELDS,
      after: [FIELDS[1]],
      leaks: [],
      sizeBefore: 7 * 1024 * 1024,
      sizeAfter: 6 * 1024 * 1024
    });
    const file = pdfFile();
    Object.defineProperty(file, 'size', { value: 7 * 1024 * 1024 });
    const { getByText, getByTestId } = render(MetadataCleanerModal, {
      props: { open: true, file, ondone: vi.fn(), maxSize: 5 * 1024 * 1024 }
    });
    await waitFor(() => expect(getByTestId('metaclean-apply')).toBeTruthy());
    await fireEvent.click(getByTestId('metaclean-apply'));
    await waitFor(() => expect(getByText('Verified result')).toBeTruthy());
    expect(getByText('Still over upload limit of 5 MB')).toBeTruthy();
  });

  it('shows an error state with retry and keep-original when inspect fails', async () => {
    mocks.inspectFile.mockRejectedValueOnce(new Error('service down'));
    const ondone = vi.fn();
    const file = pdfFile();
    const { getByText } = render(MetadataCleanerModal, {
      props: { open: true, file, ondone }
    });
    await waitFor(() => expect(getByText('Metadata check failed')).toBeTruthy());
    expect(getByText('service down')).toBeTruthy();
    await fireEvent.click(getByText('Continue with original'));
    expect(ondone).toHaveBeenCalledWith(file);
  });
});
