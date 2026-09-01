/**
 * Accepted upload types for the resource wizard's Step-2 "no URL" uploader.
 *
 * This is the create flow's only upload surface, so anything missing here is
 * greyed out in the OS file picker. Three groups:
 *  - documents the AI extractor can ground on (PDF, slides, text docs),
 *  - interactive packages (.h5p/.xdc/.html), which the uploader detects and
 *    normalizes into webxdc,
 *  - images, which are learning material in their own right (worksheets,
 *    diagrams, photos) even though the extractor gets little out of them.
 *
 * Step-5's supplementary uploader deliberately has no `accept` at all.
 */
export const NO_URL_UPLOAD_ACCEPT = [
  '.pdf',
  '.ppt',
  '.pptx',
  '.odp',
  '.key',
  '.doc',
  '.docx',
  '.odt',
  'application/pdf',
  '.h5p',
  '.xdc',
  '.html',
  '.htm',
  'application/x-webxdc',
  'image/*'
].join(',');
