/** @vitest-environment jsdom */
/**
 * `fileDropZone` — a Svelte action that turns a composer pill into a file
 * drop target: dragging files over it sets `data-dragging` (for a ring
 * style), dropping hands the files to `onFiles`. Text drags and disabled
 * zones keep the browser's default.
 */
import { describe, it, expect, vi } from 'vitest';
import { fileDropZone } from '$lib/helpers/file-drop.js';

/**
 * @param {string} type
 * @param {{ files?: File[], types?: string[] }} [data]
 */
function dragEvent(type, { files = [], types = ['Files'] } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types } });
  return event;
}

const png = () => new File(['png'], 'shot.png', { type: 'image/png' });

describe('fileDropZone', () => {
  it('marks the node while files are dragged over it and clears on leave', () => {
    const node = document.createElement('form');
    fileDropZone(node, { onFiles: vi.fn() });
    node.dispatchEvent(dragEvent('dragenter'));
    expect(node.dataset.dragging).toBe('true');
    node.dispatchEvent(dragEvent('dragleave'));
    expect(node.dataset.dragging).toBeUndefined();
  });

  it('hands dropped files to onFiles, prevents the navigation default and clears the mark', () => {
    const node = document.createElement('form');
    const onFiles = vi.fn();
    fileDropZone(node, { onFiles });
    const file = png();
    node.dispatchEvent(dragEvent('dragenter'));
    const over = dragEvent('dragover');
    node.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = dragEvent('drop', { files: [file] });
    node.dispatchEvent(drop);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(drop.defaultPrevented).toBe(true);
    expect(node.dataset.dragging).toBeUndefined();
  });

  it('ignores drags that carry no files', () => {
    const node = document.createElement('form');
    const onFiles = vi.fn();
    fileDropZone(node, { onFiles });
    node.dispatchEvent(dragEvent('dragenter', { types: ['text/plain'] }));
    expect(node.dataset.dragging).toBeUndefined();
    const drop = dragEvent('drop', { files: [], types: ['text/plain'] });
    node.dispatchEvent(drop);
    expect(onFiles).not.toHaveBeenCalled();
    expect(drop.defaultPrevented).toBe(false);
  });

  it('does nothing while disabled, and follows updates', () => {
    const node = document.createElement('form');
    const onFiles = vi.fn();
    const action = fileDropZone(node, { onFiles, enabled: false });
    node.dispatchEvent(dragEvent('dragenter'));
    expect(node.dataset.dragging).toBeUndefined();
    node.dispatchEvent(dragEvent('drop', { files: [png()] }));
    expect(onFiles).not.toHaveBeenCalled();
    action?.update?.({ onFiles, enabled: true });
    node.dispatchEvent(dragEvent('drop', { files: [png()] }));
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it('stops listening after destroy', () => {
    const node = document.createElement('form');
    const onFiles = vi.fn();
    const action = fileDropZone(node, { onFiles });
    action?.destroy?.();
    node.dispatchEvent(dragEvent('drop', { files: [png()] }));
    expect(onFiles).not.toHaveBeenCalled();
  });
});
