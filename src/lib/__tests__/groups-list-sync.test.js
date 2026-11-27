/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { unlistedMemberships, groupsListAdditions } from '$lib/groups/groups-list-sync.js';
import { buildGroupsListTemplate } from '$lib/groups/groups.js';
import { channelKey } from '$lib/groups/community-pointer.js';

const HOST = 'wss://groups.example/';
const at = (/** @type {string} */ id) => ({ id, relay: HOST });
const meta = (/** @type {string} */ id, /** @type {string[][]} */ ...tags) => ({
  kind: 39000,
  tags: [['d', id], ['name', id], ...tags]
});
const byKey = (/** @type {any[]} */ ...metas) =>
  Object.fromEntries(metas.map((m) => [channelKey(at(m.tags[0][1])), m]));

describe('unlistedMemberships', () => {
  it('counts an entry under the /c address as listed', () => {
    const listed = [{ id: 'chan', relay: 'wss://groups.example/c/root' }];
    expect(unlistedMemberships(listed, [at('chan'), at('other')])).toEqual([at('other')]);
  });
});

describe('groupsListAdditions', () => {
  it('addresses a channel and its root through the community endpoint, a standalone group flat', () => {
    const unlisted = [at('root'), at('chan'), at('alone')];
    const metas = byKey(meta('root'), meta('chan', ['parent', 'root']), meta('alone'));
    expect(groupsListAdditions([], unlisted, metas)).toEqual([
      { id: 'root', relay: 'wss://groups.example/c/root' },
      { id: 'chan', relay: 'wss://groups.example/c/root' },
      { id: 'alone', relay: HOST }
    ]);
  });

  it('knows a root from an address already in the list', () => {
    const listed = [{ id: 'chan', relay: 'wss://groups.example/c/root' }];
    expect(groupsListAdditions(listed, [at('root')], byKey(meta('root')))).toEqual([
      { id: 'root', relay: 'wss://groups.example/c/root' }
    ]);
  });

  it('leaves out hidden, deleted, ephemeral and unknown groups', () => {
    const unlisted = [at('hidden'), at('gone'), at('room'), at('unknown')];
    const metas = byKey(
      meta('hidden', ['hidden']),
      {
        kind: 39000,
        tags: [
          ['d', 'gone'],
          ['name', '[deleted]']
        ]
      },
      meta('room', ['ephemeral', 'chan'])
    );
    expect(groupsListAdditions([], unlisted, metas)).toEqual([]);
  });
});

describe('buildGroupsListTemplate with several adds', () => {
  it('adds every entry and one r tag per address in a single rewrite', () => {
    const template = buildGroupsListTemplate(null, {
      add: [
        { id: 'root', relay: 'wss://groups.example/c/root' },
        { id: 'chan', relay: 'wss://groups.example/c/root' },
        { id: 'alone', relay: HOST }
      ]
    });
    expect(template.tags).toEqual([
      ['r', 'wss://groups.example/c/root'],
      ['r', HOST],
      ['group', 'root', 'wss://groups.example/c/root'],
      ['group', 'chan', 'wss://groups.example/c/root'],
      ['group', 'alone', HOST]
    ]);
  });
});
