/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const env = vi.hoisted(() => /** @type {Record<string, string | undefined>} */ ({}));
vi.mock('$env/dynamic/private', () => ({ env }));

import { writePdfCache, MAX_CACHE_FILES } from '$lib/server/pdfSource.js';

/** @type {string} */
let dir;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pdf-cache-test-'));
  env.PDF_THUMBNAIL_CACHE_DIR = dir;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writePdfCache', () => {
  it('evicts the oldest files (by mtime) once the cache is over its entry cap', async () => {
    for (let i = 0; i < MAX_CACHE_FILES; i++) {
      await writeFile(path.join(dir, `f${i}.webp`), 'x');
    }
    // Two files are clearly the oldest.
    const old = new Date(Date.now() - 86_400_000);
    await utimes(path.join(dir, 'f7.webp'), old, old);
    await utimes(
      path.join(dir, 'f42.webp'),
      new Date(old.getTime() - 1000),
      new Date(old.getTime() - 1000)
    );

    await writePdfCache(path.join(dir, 'new.webp'), 'y', 'test');

    const names = await readdir(dir);
    expect(names).toHaveLength(MAX_CACHE_FILES);
    expect(names).toContain('new.webp');
    expect(names).not.toContain('f42.webp');
    expect(names).toContain('f7.webp');
  });

  it('keeps everything while under the cap', async () => {
    await writePdfCache(path.join(dir, 'a.webp'), 'y', 'test');
    await writePdfCache(path.join(dir, 'b.pages.json'), '{}', 'test');
    expect((await readdir(dir)).sort()).toEqual(['a.webp', 'b.pages.json']);
  });
});
