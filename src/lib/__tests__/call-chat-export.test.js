/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formatCallChatTxt, callChatFileName } from '$lib/groups/call-chat-export.js';

const at = (h, min) => new Date(2026, 9, 3, h, min).getTime();
const labels = { exportedAt: (time) => `Exportiert um ${time}`, guest: 'Gast' };

describe('formatCallChatTxt', () => {
  it('header (channel, DD.MM.YYYY, export time), then one line per message', () => {
    const txt = formatCallChatTxt({
      channel: 'Arbeitszimmer',
      exportedAt: new Date(2026, 9, 3, 14, 7),
      labels,
      messages: [
        { at: at(9, 5), name: 'Anna', guest: false, text: 'Hallo zusammen' },
        { at: at(9, 6), name: 'Bo', guest: true, text: 'Hi!' }
      ]
    });
    expect(txt).toBe(
      [
        'Arbeitszimmer',
        '03.10.2026',
        'Exportiert um 14:07',
        '',
        '[09:05] Anna: Hallo zusammen',
        '[09:06] Bo (Gast): Hi!',
        ''
      ].join('\n')
    );
  });

  it('indents continuation lines of a multi-line message under its text', () => {
    const txt = formatCallChatTxt({
      channel: 'X',
      exportedAt: new Date(2026, 0, 1, 0, 0),
      labels,
      messages: [{ at: at(23, 59), name: 'Anna', guest: false, text: 'eins\nzwei\r\ndrei' }]
    });
    const lines = txt.split('\n');
    expect(lines[4]).toBe('[23:59] Anna: eins');
    expect(lines[5]).toBe('        zwei');
    expect(lines[6]).toBe('        drei');
  });

  it('keeps umlauts and emoji as they are (UTF-8 text)', () => {
    const txt = formatCallChatTxt({
      channel: 'Größe',
      exportedAt: new Date(2026, 0, 1),
      labels,
      messages: [{ at: at(1, 2), name: 'Jörg', guest: false, text: 'Grüße 👋' }]
    });
    expect(txt).toContain('[01:02] Jörg: Grüße 👋');
    expect(txt.startsWith('Größe\n')).toBe(true);
  });
});

describe('callChatFileName', () => {
  it('anruf-chat-<channel-slug>-<YYYY-MM-DD>.txt', () => {
    expect(callChatFileName('Arbeitszimmer', new Date(2026, 9, 3))).toBe(
      'anruf-chat-arbeitszimmer-2026-10-03.txt'
    );
  });

  it('sanitises the channel name: umlauts, spaces, slashes, dots', () => {
    expect(callChatFileName('Größe / Ärger: Übung 1.b', new Date(2026, 0, 5))).toBe(
      'anruf-chat-groesse-aerger-uebung-1-b-2026-01-05.txt'
    );
    expect(callChatFileName('../../etc', new Date(2026, 0, 5))).toBe(
      'anruf-chat-etc-2026-01-05.txt'
    );
  });

  it('falls back when nothing usable is left, and stays short', () => {
    expect(callChatFileName('🎉🎉', new Date(2026, 0, 5))).toBe('anruf-chat-anruf-2026-01-05.txt');
    expect(callChatFileName('x'.repeat(200), new Date(2026, 0, 5)).length).toBeLessThan(80);
  });
});
