/**
 * Words for the connection status (helpers/connection-status.js), shared by
 * the menu entry, the strip and the connection modal.
 */
import * as m from '$lib/paraglide/messages';
import { isLikelyMobile } from '$lib/helpers/signer-wait.js';

/** @param {string} category */
export function categoryLabel(category) {
  // Looked up per call, not in a module-level table: tests that partially
  // mock the messages module must be able to import this file.
  switch (category) {
    case 'calendar':
      return m.connection_category_calendar();
    case 'communikey':
      return m.connection_category_communikey();
    case 'educational':
      return m.connection_category_educational();
    case 'longform':
      return m.connection_category_longform();
    case 'kanban':
      return m.connection_category_kanban();
    case 'groups':
      return m.connection_category_groups();
    default:
      return category;
  }
}

/**
 * @param {import('$lib/helpers/connection-status.js').ConnectionReason} reason
 * @returns {{title: string, detail: string}}
 */
export function describeReason(reason) {
  if (reason.kind === 'offline')
    return { title: m.connection_offline(), detail: m.connection_offline_detail() };
  if (reason.kind === 'signer')
    return {
      title: m.connection_signer(),
      detail: isLikelyMobile() ? m.connection_signer_detail_mobile() : m.connection_signer_detail()
    };
  if (reason.down === reason.total)
    return { title: m.connection_unreachable(), detail: m.connection_unreachable_detail() };
  return {
    title: m.connection_relays_down({ down: reason.down, total: reason.total }),
    detail: m.connection_relays_down_detail()
  };
}

/**
 * The headline: the first problem, or "Connected".
 * @param {{reasons: import('$lib/helpers/connection-status.js').ConnectionReason[]}} status
 * @returns {{title: string, detail: string}}
 */
export function summaryOf(status) {
  const first = status.reasons[0];
  return first
    ? describeReason(first)
    : { title: m.connection_ok(), detail: m.connection_ok_detail() };
}
