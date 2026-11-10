/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TERMI_TASKS, composePrompt, todayPreamble } from '../termi/tasks.js';
import { TOOL_REGISTRY } from '../../termi/tool-registry.js';

const fixture = readFileSync(
  new URL('../../__tests__/fixtures/termi/ask-prompt.txt', import.meta.url),
  'utf-8'
);

describe('TERMI_TASKS.ask', () => {
  it('has the step cap and stop condition the route hard-coded before', () => {
    expect(TERMI_TASKS.ask.maxSteps).toBe(8);
    expect(TERMI_TASKS.ask.stopWhen).toEqual(['show_pages']);
  });

  it('lists the same tools buildTermiTools("ask") builds (drift)', () => {
    expect(TERMI_TASKS.ask.tools.slice().sort()).toEqual(Object.keys(TOOL_REGISTRY).sort());
  });
});

describe('composePrompt("ask")', () => {
  it('is byte-identical to the pre-Task-6 prompt with the default app name', () => {
    expect(composePrompt('ask', { appName: 'Edufeed' })).toBe(fixture);
  });

  it('contains every registry promptHint exactly once', () => {
    const prompt = composePrompt('ask', { appName: 'Edufeed' });
    const uniqueHints = new Set(Object.values(TOOL_REGISTRY).map((t) => t.promptHint));
    for (const hint of uniqueHints) {
      const occurrences = prompt.split(hint).length - 1;
      expect(occurrences, hint).toBe(1);
    }
  });

  it('the identity line uses appName, not a hard-coded brand', () => {
    const prompt = composePrompt('ask', { appName: 'Schulfeed' });
    expect(prompt).toContain('Du bist Termi, die Assistenz von Schulfeed.');
    expect(prompt).toContain('im Schulfeed-Netzwerk.');
    expect(prompt).not.toContain('Edufeed');
  });

  it('keeps the document and LiaScript sections', () => {
    const prompt = composePrompt('ask', { appName: 'Edufeed' });
    expect(prompt).toContain('schreibe ein gegliedertes Markdown-Dokument');
    expect(prompt).toContain('schreibe ein Dokument als LiaScript');
  });

  it('prepends the today/tz preamble when both are given, nothing otherwise', () => {
    const withDate = composePrompt('ask', {
      appName: 'Edufeed',
      today: '2026-11-10',
      tz: 'Europe/Berlin'
    });
    expect(withDate).toBe(todayPreamble('2026-11-10', 'Europe/Berlin') + fixture);
    expect(composePrompt('ask', { appName: 'Edufeed', today: '2026-11-10' })).toBe(fixture);
  });

  it('defaults appName to Edufeed when none is given', () => {
    expect(composePrompt('ask')).toBe(fixture);
  });
});
