/**
 * NIP-52 participant roles: the presets the event form offers and their
 * translated labels. Roles are free text on the wire ("p" tag slot 4), so an
 * unknown role is shown as-is.
 */
import * as m from '$lib/paraglide/messages';

/** Roles offered by ParticipantsEditor. `organizer` + `attendee` are the Edufeed-agreed pair (issue #13). */
export const PARTICIPANT_ROLE_PRESETS = [
  'participant',
  'attendee',
  'speaker',
  'organizer',
  'moderator'
];

/** @type {Record<string, () => string>} */
const ROLE_LABELS = {
  participant: m.participant_role_participant,
  attendee: m.participant_role_attendee,
  speaker: m.participant_role_speaker,
  organizer: m.participant_role_organizer,
  moderator: m.participant_role_moderator
};

/**
 * Translated label for a role, the raw role for anything custom.
 * @param {string} role
 * @returns {string}
 */
export function participantRoleLabel(role) {
  const key = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return ROLE_LABELS[key] ? ROLE_LABELS[key]() : role;
}
