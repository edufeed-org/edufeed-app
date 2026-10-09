// The translated names of the bundled call backgrounds (BACKGROUND_PRESETS
// in call-background.js), shared by the lobby and the in-call camera menu.
// Kept apart from call-background.js so that module — which call-prefs and
// the preview service import — does not pull the Paraglide messages into
// their static graph.
import * as m from '$lib/paraglide/messages';

/** @type {Record<string, () => string>} */
const PRESET_LABELS = {
  paper: m.groups_call_background_paper,
  teal: m.groups_call_background_teal,
  shelf: m.groups_call_background_shelf
};

/**
 * The label of a preset, as a message function; an unknown id names itself.
 * @param {string} id
 * @returns {() => string}
 */
export function backgroundPresetLabel(id) {
  return PRESET_LABELS[id] ?? (() => id);
}
