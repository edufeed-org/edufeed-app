// The call chat as a plain UTF-8 text file (Task 19): the chat is ephemeral
// (gone when the call ends), so this is the only way to keep it.

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/** @param {Date} d */
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * @param {{
 *   channel: string,
 *   exportedAt: Date,
 *   labels: { exportedAt: (time: string) => string, guest: string },
 *   messages: Array<{ at: number, name: string, guest: boolean, text: string }>
 * }} input `labels.exportedAt` words the export time; `labels.guest` marks guests
 * @returns {string} channel, DD.MM.YYYY, export time, a blank line, then one
 *   `[HH:MM] Name: text` line per message (continuation lines indented)
 */
export function formatCallChatTxt({ channel, exportedAt, labels, messages }) {
  const d = exportedAt;
  const lines = [
    channel,
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
    labels.exportedAt(hhmm(d)),
    ''
  ];
  for (const msg of messages) {
    const stamp = `[${hhmm(new Date(msg.at))}] `;
    // A display name is one line: a newline in it would forge a message line.
    const name = String(msg.name ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const who = msg.guest ? `${name} (${labels.guest})` : name;
    const [first, ...rest] = String(msg.text).split(/\r\n|\r|\n/);
    lines.push(`${stamp}${who}: ${first}`);
    const indent = ' '.repeat(stamp.length);
    for (const line of rest) lines.push(`${indent}${line}`);
  }
  return lines.join('\n') + '\n';
}

const UMLAUTS = /** @type {Record<string, string>} */ ({
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss'
});

/**
 * `anruf-chat-<channel-slug>-<YYYY-MM-DD>.txt`, safe on every file system.
 * @param {string} channel
 * @param {Date} date
 */
export function callChatFileName(channel, date) {
  const slug =
    String(channel ?? '')
      .toLowerCase()
      .replace(/[äöüß]/g, (c) => UMLAUTS[c])
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'anruf';
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `anruf-chat-${slug}-${ymd}.txt`;
}

/**
 * Hand the text to the browser as a download.
 * @param {string} filename
 * @param {string} text
 */
export function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
