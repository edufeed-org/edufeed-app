// src/lib/helpers/educational/konfiSummary.js
import { BILDUNGSBEREICHE } from './bildungsbereich.js';

/**
 * @typedef {{ labelKey: string, value: string, multiline: boolean }} KonfiSummaryRow
 */

/**
 * Project the konfi step-4 slots of `formData` onto an ordered list of summary
 * rows for the wizard's Preview step. Driven by `BILDUNGSBEREICHE.konfi
 * .step4SubSteps` so the row order tracks the order users filled the fields.
 *
 * Vocab fields read `<schemeKey>Labels` (the rich `{id,label}` shape the wizard
 * keeps alongside the bare ids). Scalar checkbox fields render only when
 * explicitly `true` — matches `emitKonfiScalarTags`, which drops `false`.
 * Scalar text fields render with `multiline: true` so the template can apply
 * line-clamping like the existing EKW `methodOther` row.
 *
 * @param {Record<string, any>} formData
 * @param {{ yes: string, no: string }} booleanLabels
 * @returns {KonfiSummaryRow[]}
 */
export function buildKonfiSummaryRows(formData, booleanLabels) {
  /** @type {KonfiSummaryRow[]} */
  const rows = [];
  const subSteps = BILDUNGSBEREICHE.konfi.step4SubSteps ?? [];
  for (const step of subSteps) {
    for (const field of step.fields) {
      if (field.kind === 'vocab') {
        const labels = formData?.[`${field.schemeKey}Labels`];
        if (!Array.isArray(labels) || labels.length === 0) continue;
        const value = labels
          .map((/** @type {{id:string,label?:string}} */ l) => l.label || l.id)
          .join(', ');
        rows.push({ labelKey: field.labelKey, value, multiline: false });
      } else if (field.input === 'checkbox') {
        if (formData?.[field.tagSlug] === true) {
          rows.push({ labelKey: field.labelKey, value: booleanLabels.yes, multiline: false });
        }
      } else {
        const v = formData?.[field.tagSlug];
        if (typeof v !== 'string' || v.trim() === '') continue;
        rows.push({ labelKey: field.labelKey, value: v, multiline: true });
      }
    }
  }
  return rows;
}
