// "Privat schreiben" on a participant tile → the call chat composer's
// recipient. Its own tiny module (like call-chat-unread): the stage that
// draws the tiles and the panel that owns the composer are different
// components, often mounted apart (the chat column, the pop-out), so the
// request is parked here until a panel takes it.

/** @type {string | null} */
let recipient = $state(null);

/** A tile asked to write privately to this identity. @param {string} identity */
export function requestPrivateRecipient(identity) {
  recipient = identity;
}

/** The panel takes (and clears) the pending request. */
export function takePrivateRecipient() {
  const r = recipient;
  recipient = null;
  return r;
}

export function resetCallChatCompose() {
  recipient = null;
}

/** @returns {{ readonly recipient: string | null }} */
export function getCallChatCompose() {
  return {
    get recipient() {
      return recipient;
    }
  };
}
