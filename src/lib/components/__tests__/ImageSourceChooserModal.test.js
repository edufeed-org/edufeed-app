/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ImageSourceChooserModal from '../shared/ImageSourceChooserModal.svelte';

vi.mock('$lib/paraglide/messages', () => ({
  image_source_chooser_title: () => 'Add an image',
  image_source_chooser_upload_label: () => 'Upload from computer',
  image_source_chooser_upload_desc: () => 'Pick a file from your device',
  image_source_chooser_library_label: () => 'Choose from library',
  image_source_chooser_library_desc: () => 'Reuse a licensed image',
  image_source_chooser_paste_hint: () => 'Or paste a URL in the field above.',
  image_source_chooser_cancel: () => 'Cancel'
}));

describe('ImageSourceChooserModal', () => {
  it('does not render when open is false', () => {
    const { queryByText } = render(ImageSourceChooserModal, { props: { open: false } });
    expect(queryByText('Add an image')).toBeNull();
  });

  it('renders title and both options when open', () => {
    const { getByText } = render(ImageSourceChooserModal, { props: { open: true } });
    expect(getByText('Add an image')).toBeTruthy();
    expect(getByText('Upload from computer')).toBeTruthy();
    expect(getByText('Choose from library')).toBeTruthy();
    expect(getByText('Or paste a URL in the field above.')).toBeTruthy();
  });

  it('invokes onupload when Upload button clicked', async () => {
    const onupload = vi.fn();
    const { getByText } = render(ImageSourceChooserModal, {
      props: { open: true, onupload }
    });
    await fireEvent.click(getByText('Upload from computer'));
    expect(onupload).toHaveBeenCalledOnce();
  });

  it('invokes onlibrary when Library button clicked', async () => {
    const onlibrary = vi.fn();
    const { getByText } = render(ImageSourceChooserModal, {
      props: { open: true, onlibrary }
    });
    await fireEvent.click(getByText('Choose from library'));
    expect(onlibrary).toHaveBeenCalledOnce();
  });

  it('invokes oncancel when Cancel button clicked', async () => {
    const oncancel = vi.fn();
    const { getByText } = render(ImageSourceChooserModal, {
      props: { open: true, oncancel }
    });
    await fireEvent.click(getByText('Cancel'));
    expect(oncancel).toHaveBeenCalledOnce();
  });

  it('invokes oncancel when backdrop clicked', async () => {
    const oncancel = vi.fn();
    const { container } = render(ImageSourceChooserModal, {
      props: { open: true, oncancel }
    });
    const backdrop = container.querySelector('.modal-backdrop');
    expect(backdrop).toBeTruthy();
    await fireEvent.click(backdrop);
    expect(oncancel).toHaveBeenCalledOnce();
  });
});
