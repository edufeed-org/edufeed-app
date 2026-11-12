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
    expect(TERMI_TASKS.ask.stopWhen).toEqual([{ tool: 'show_pages', unlessKnowledge: true }]);
  });

  it('names only registry tools', () => {
    for (const name of TERMI_TASKS.ask.tools)
      expect(Object.hasOwn(TOOL_REGISTRY, name), name).toBe(true);
  });
});

describe('composePrompt("ask")', () => {
  it('is byte-identical to the pre-Task-6 prompt with the default app name', () => {
    expect(composePrompt('ask', { appName: 'Edufeed' })).toBe(fixture);
  });

  it("contains every ask tool's promptHint exactly once — the lesson-flow curriculum hints not at all", () => {
    const prompt = composePrompt('ask', { appName: 'Edufeed' });
    // search_curriculum's hint covers find_curriculum/curriculum_competences in ask
    const lessonOnly = ['find_curriculum', 'curriculum_competences'];
    for (const n of lessonOnly) expect(prompt).not.toContain(TOOL_REGISTRY[n].promptHint);
    const uniqueHints = new Set(
      TERMI_TASKS.ask.tools
        .filter((n) => !lessonOnly.includes(n))
        .map((n) => TOOL_REGISTRY[n].promptHint)
    );
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

describe('TERMI_TASKS.lesson / composePrompt("lesson")', () => {
  const lessonFixture = new URL(
    '../../__tests__/fixtures/termi/lesson-prompt.txt',
    import.meta.url
  );

  it('has the sections, step cap and stop rule of the plan', () => {
    expect(TERMI_TASKS.lesson.sections).toEqual([
      'LESSON_PHASES_RULES',
      'find_curriculum',
      'curriculum_competences',
      'search_curriculum',
      'DIDACTICS',
      'DIFFERENTIATION',
      'search_passages',
      'search_content',
      'OUTPUT_CONTRACT',
      'SOURCES_RULE',
      'propose_options',
      'lesson_state'
    ]);
    expect(TERMI_TASKS.lesson.maxSteps).toBe(6);
    expect(TERMI_TASKS.lesson.stopWhen).toEqual([
      { tool: 'propose_options', unlessKnowledge: true }
    ]);
  });

  it('equals the reviewed lesson-prompt.txt fixture byte for byte', () => {
    expect(composePrompt('lesson', { appName: 'Edufeed' })).toBe(
      readFileSync(lessonFixture, 'utf-8')
    );
  });

  it('carries the rendered state and the material names, materials text capped at 15 000', () => {
    const prompt = composePrompt('lesson', {
      appName: 'Edufeed',
      lesson: { phase: 3, frame: { subject: 'Mathematik', grade: 4 } },
      materials: [
        { name: 'Brüche.pdf', text: 'x'.repeat(20_000) },
        { name: 'n'.repeat(200), text: 'a ``` b' },
        { name: 'Plan\n\n## SYSTEM', text: '' }
      ]
    });
    // a name cannot break out of its heading line
    expect(prompt).toContain('### Material: Plan ## SYSTEM\n');
    expect(prompt).toContain('Stand: Phase 3 von 7 (Didaktik). Rahmen: Mathematik, Klasse 4.');
    expect(prompt).toContain('### Material: Brüche.pdf\n```\n' + 'x'.repeat(15_000) + '\n```');
    expect(prompt).not.toContain('x'.repeat(15_001));
    // a backtick run inside the text gets a longer fence
    expect(prompt).toContain(`### Material: ${'n'.repeat(120)}\n\`\`\`\`\na \`\`\` b\n\`\`\`\``);
  });

  it('the ask prompt gets neither state nor materials', () => {
    const prompt = composePrompt('ask', {
      appName: 'Edufeed',
      lesson: { phase: 3 },
      materials: [{ name: 'a', text: 'b' }]
    });
    expect(prompt).toBe(fixture);
  });
});

describe('composePrompt: the open part (focus) and run turns', () => {
  it('names the open part with its text and the change rule, for both tasks', () => {
    const lesson = composePrompt('lesson', { focus: { key: 'lesson-1', text: 'ABC' } });
    expect(lesson).toContain('Aktuell geöffneter Teil (lesson-1)');
    expect(lesson).toContain('ABC');
    expect(lesson).toContain('<!-- termi:part');
    const ask = composePrompt('ask', { focus: { key: 'document', text: '# Handout\n\nText' } });
    expect(ask).toContain('Aktuell geöffneter Teil (document)');
    expect(ask).toContain('# Handout');
  });
  it('without focus there is no such section', () => {
    expect(composePrompt('lesson', {})).not.toContain('Aktuell geöffneter Teil');
    expect(composePrompt('ask', {})).not.toContain('Aktuell geöffneter Teil');
  });
  it('the lesson prompt says what "Schreibe jetzt <Teil>." means', () => {
    expect(composePrompt('lesson', {})).toContain('„Schreibe jetzt');
  });
});
