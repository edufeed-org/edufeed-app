import * as m from '$lib/paraglide/messages';

/**
 * A part's label: its own title, or — a planned part without text is titled by its key —
 * the label of its kind ("Stunde 3"). Shared by the rail and the window's run messages.
 * @param {string} key @param {string} [title]
 */
export function partTitle(key, title = key) {
  if (title !== key) return title;
  const lesson = key.match(/^lesson-(\d+)$/);
  if (lesson) return m.termi_werkbank_part_lesson({ n: lesson[1] });
  switch (key) {
    case 'overview':
      return m.termi_werkbank_part_overview();
    case 'worksheets':
      return m.termi_werkbank_part_worksheets();
    case 'summary':
      return m.termi_werkbank_part_summary();
    case 'module':
      return m.termi_werkbank_part_module();
    case 'sources':
      return m.termi_werkbank_part_sources();
    case 'document':
      return m.termi_werkbank_part_document();
    default:
      return key;
  }
}
