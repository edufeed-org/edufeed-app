import { describe, it, expect, vi } from 'vitest';
import { skillsAsHostActions } from '../host.js';

const skills = [
  { id: 'home', kind: 'navigate', phrases: { de: ['Zur Startseite'] } },
  { id: 'profile', kind: 'navigate', phrases: { de: ['Mein Profil'] } },
  { id: 'event', kind: 'create', phrases: { de: ['Event erstellen'] } },
  { id: 'help1', kind: 'help', phrases: { de: ['Hilfe'] } }
];

function setup() {
  const navigate = vi.fn();
  const run = vi.fn();
  const toAction = vi.fn((s) =>
    s.id === 'home' ? { href: '/c/' } : s.id === 'event' ? { run } : null
  );
  return { navigate, run, actions: skillsAsHostActions(skills, { navigate, toAction }) };
}

describe('skillsAsHostActions', () => {
  it('builds WebMCP-shaped actions, skipping help and skills without an action', () => {
    const { actions } = setup();
    expect(actions.map((a) => a.name)).toEqual(['open_home', 'create_event']);
    for (const a of actions)
      expect(Object.keys(a).sort()).toEqual([
        'annotations',
        'description',
        'execute',
        'inputSchema',
        'name'
      ]);
    expect(actions[0].description).toBe('Zur Startseite');
    expect(actions[0].annotations).toEqual({ readOnlyHint: true });
    expect(actions[1].annotations).toEqual({ consequentialHint: true });
  });

  it('navigate executes host.navigate, create runs the create action', () => {
    const { actions, navigate, run } = setup();
    actions[0].execute();
    expect(navigate).toHaveBeenCalledWith('/c/');
    actions[1].execute();
    expect(run).toHaveBeenCalledOnce();
  });
});
