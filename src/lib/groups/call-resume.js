/**
 * The call this tab was in, for after a reload.
 *
 * Every bit of call state lives in memory, so a reload (an accidental F5,
 * a browser that restarted the tab) landed the user outside the call with
 * no hint that it is still running. The active call is noted in
 * sessionStorage — per tab, gone when the tab closes — and the channel page
 * offers "Zurück in den Anruf" for a while afterwards. Never a silent
 * rejoin: media needs a gesture, and the user may have left on purpose.
 */

export const CALL_RESUME_KEY = 'edufeed:call-resume';
/** How long after the note a resume is still offered. */
export const CALL_RESUME_MAX_AGE_MS = 10 * 60_000;

/** @typedef {{pointer: {id: string, relay: string}, title: string, href: string | null, code: string | null, at: number}} CallResumeNote */

/** @returns {Storage | null} */
function storageOf() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Note the call this tab is in (the main room of a breakout session, never
 * a room: the roster re-offers the room on the way back).
 * @param {{pointer: {id: string, relay: string}, title?: string, href?: string | null, code?: string | null}} call
 * @param {number} [now]
 * @param {Storage | null} [storage]
 */
export function rememberCall(call, now = Date.now(), storage = storageOf()) {
  if (!storage || !call.pointer?.id || !call.pointer.relay) return;
  /** @type {CallResumeNote} */
  const note = {
    pointer: { id: call.pointer.id, relay: call.pointer.relay },
    title: call.title ?? '',
    href: call.href ?? null,
    code: call.code ?? null,
    at: now
  };
  try {
    storage.setItem(CALL_RESUME_KEY, JSON.stringify(note));
  } catch {
    // storage full or disabled: no resume offer, nothing else changes
  }
}

/** The user left (or was removed): nothing to come back to. @param {Storage | null} [storage] */
export function forgetCall(storage = storageOf()) {
  try {
    storage?.removeItem(CALL_RESUME_KEY);
  } catch {
    // ignore
  }
}

/**
 * The call to offer a way back into, if the note is young enough.
 * @param {number} [now]
 * @param {Storage | null} [storage]
 * @returns {CallResumeNote | null}
 */
export function readResumableCall(now = Date.now(), storage = storageOf()) {
  let raw;
  try {
    raw = storage?.getItem(CALL_RESUME_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const note = JSON.parse(raw);
    if (
      !note ||
      typeof note !== 'object' ||
      typeof note.pointer?.id !== 'string' ||
      typeof note.pointer?.relay !== 'string' ||
      typeof note.at !== 'number'
    ) {
      return null;
    }
    if (now - note.at > CALL_RESUME_MAX_AGE_MS || note.at > now + 60_000) return null;
    return {
      pointer: { id: note.pointer.id, relay: note.pointer.relay },
      title: typeof note.title === 'string' ? note.title : '',
      href: typeof note.href === 'string' ? note.href : null,
      code: typeof note.code === 'string' ? note.code : null,
      at: note.at
    };
  } catch {
    return null;
  }
}
