/**
 * Convert between the form builder's editing list (fields with interleaved
 * `type:'section'` divider markers) and the wire model (real FormField[] +
 * FormSection[] grouping). Pure — no Svelte, no side effects.
 *
 * @typedef {import('./format.js').FormField} FormField
 * @typedef {import('./format.js').FormSection} FormSection
 * @typedef {{ id: string, type: 'section', title: string, description?: string }} SectionMarker
 */

/** @param {any} item @returns {item is SectionMarker} */
export function isSectionMarker(item) {
  return !!item && item.type === 'section';
}

/**
 * Split an editing list into real fields + section grouping.
 * A section marker owns the non-section fields that follow it until the next
 * marker. Fields before the first marker are un-sectioned (not in any section).
 * @param {(FormField | SectionMarker)[]} items
 * @returns {{ fields: FormField[], sections: FormSection[] }}
 */
export function extractSections(items) {
  /** @type {FormField[]} */
  const fields = [];
  /** @type {FormSection[]} */
  const sections = [];
  /** @type {FormSection | null} */
  let current = null;
  for (const item of items || []) {
    if (isSectionMarker(item)) {
      current = {
        id: item.id,
        title: item.title || '',
        ...(item.description ? { description: item.description } : {}),
        questionIds: [],
        order: sections.length
      };
      sections.push(current);
    } else {
      fields.push(item);
      if (current) current.questionIds.push(item.id);
    }
  }
  return { fields, sections };
}

/**
 * Inverse of extractSections: rebuild the editing list. Un-sectioned fields
 * (referenced by no section) come first, then each section marker followed by
 * its questionId fields, in section order.
 * @param {FormField[]} fields
 * @param {FormSection[]} sections
 * @returns {(FormField | SectionMarker)[]}
 */
export function interleaveSections(fields, sections) {
  const byId = new Map((fields || []).map((f) => [f.id, f]));
  const claimed = new Set((sections || []).flatMap((s) => s.questionIds || []));
  /** @type {(FormField | SectionMarker)[]} */
  const out = [];
  for (const f of fields || []) if (!claimed.has(f.id)) out.push(f);
  const ordered = [...(sections || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const s of ordered) {
    /** @type {SectionMarker} */
    const marker = { id: s.id, type: 'section', title: s.title || '' };
    if (s.description) marker.description = s.description;
    out.push(marker);
    for (const qid of s.questionIds || []) {
      const f = byId.get(qid);
      if (f) out.push(f);
    }
  }
  return out;
}
