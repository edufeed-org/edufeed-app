/**
 * `fileDropZone` — Svelte action that makes a composer pill a file drop
 * target. While files are dragged over the node it carries
 * `data-dragging="true"` (style it with `data-[dragging=true]:…`); a drop
 * hands the files to `onFiles` and prevents the browser from navigating to
 * the file. Text drags and disabled zones are left to the browser.
 *
 * Pastes are the composer's own job (`ComposerInput`'s `onFiles`); this
 * action exists because the drop target should be the whole pill, not just
 * the editable field inside it.
 *
 * @typedef {{ onFiles: (files: File[]) => void, enabled?: boolean }} FileDropOptions
 */

/**
 * @param {HTMLElement} node
 * @param {FileDropOptions} options
 * @returns {{ update: (options: FileDropOptions) => void, destroy: () => void }}
 */
export function fileDropZone(node, options) {
  let current = options;
  // Nested children fire their own enter/leave pairs; count them so the
  // mark only clears when the drag really leaves the pill.
  let depth = 0;

  /** @param {DragEvent} event */
  const carriesFiles = (event) =>
    current.enabled !== false && Boolean(event.dataTransfer?.types?.includes('Files'));

  const clear = () => {
    depth = 0;
    delete node.dataset.dragging;
  };

  /** @param {DragEvent} event */
  const onDragEnter = (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    node.dataset.dragging = 'true';
  };
  /** @param {DragEvent} event */
  const onDragOver = (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  /** @param {DragEvent} event */
  const onDragLeave = (event) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) delete node.dataset.dragging;
  };
  /** @param {DragEvent} event */
  const onDrop = (event) => {
    if (!carriesFiles(event)) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    clear();
    if (files.length === 0) return;
    event.preventDefault();
    current.onFiles(files);
  };

  node.addEventListener('dragenter', onDragEnter);
  node.addEventListener('dragover', onDragOver);
  node.addEventListener('dragleave', onDragLeave);
  node.addEventListener('drop', onDrop);

  return {
    update(next) {
      current = next;
      if (next.enabled === false) clear();
    },
    destroy() {
      clear();
      node.removeEventListener('dragenter', onDragEnter);
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDrop);
    }
  };
}
