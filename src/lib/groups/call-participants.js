// The participant list's row model (CallParticipantsPanel / CallParticipantRow):
// what the stage knows about one seat, flattened for the list. Lives here so
// both components (and a future host-actions provider) share one type.

/**
 * @typedef {{
 *   key: string,
 *   participant: any,
 *   pubkey: string | null,
 *   profile?: any,
 *   isLocal: boolean,
 *   micOff: boolean,
 *   speaking: boolean,
 *   handRaised: boolean,
 *   guest: boolean,
 *   listenOnly: boolean,
 *   pinned: boolean,
 *   volume: number
 * }} ParticipantRow
 */

export {};
