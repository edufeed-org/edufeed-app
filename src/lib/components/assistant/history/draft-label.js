import * as m from '$lib/paraglide/messages';

/** "Reihe · 4 von 6" / "Dokument" for a `draftSummary`. @param {{ kind: string, done: number, total: number }} d */
export const draftLabel = (d) =>
  d.kind === 'series'
    ? m.termi_werkbank_draft_series({ done: d.done, total: d.total })
    : m.termi_werkbank_draft_document();
