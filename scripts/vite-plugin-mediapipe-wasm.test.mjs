/** @vitest-environment node */
/**
 * vite-plugin-mediapipe-wasm.mjs — serves the MediaPipe tasks-vision wasm
 * file set from this origin (dev middleware + emitted into the client build)
 * so camera background effects never fetch it from a CDN.
 */
import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'node:stream';
import { mediapipeWasm, resolveTasksVision } from './vite-plugin-mediapipe-wasm.mjs';
import {
  MEDIAPIPE_ASSET_PATHS,
  MEDIAPIPE_TASKS_VISION_VERSION
} from '../src/lib/groups/call-background.js';

const FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm'
];

describe('resolveTasksVision', () => {
  it('finds the tasks-vision copy @livekit/track-processors uses, at the pinned version', () => {
    const { version, files } = resolveTasksVision();
    expect(version).toBe(MEDIAPIPE_TASKS_VISION_VERSION);
    expect(files.toSorted()).toEqual(FILES);
  });
});

describe('build', () => {
  it('emits the wasm file set into the client build under the served path', () => {
    const plugin = mediapipeWasm();
    const emitFile = vi.fn();
    plugin.generateBundle.call({ emitFile, environment: { config: { build: { ssr: false } } } });
    const names = emitFile.mock.calls.map(([a]) => a.fileName).toSorted();
    const dir = MEDIAPIPE_ASSET_PATHS.tasksVisionFileSet.slice(1);
    expect(names).toEqual(FILES.map((f) => `${dir}/${f}`));
    expect(emitFile.mock.calls[0][0].type).toBe('asset');
    expect(emitFile.mock.calls[0][0].source.length).toBeGreaterThan(1000);
  });

  it('emits nothing into the server build', () => {
    const plugin = mediapipeWasm();
    const emitFile = vi.fn();
    plugin.generateBundle.call({ emitFile, environment: { config: { build: { ssr: true } } } });
    expect(emitFile).not.toHaveBeenCalled();
  });
});

describe('dev server', () => {
  function serve(url) {
    const plugin = mediapipeWasm();
    let handler;
    plugin.configureServer({ middlewares: { use: (fn) => (handler = fn) } });
    return new Promise((resolve) => {
      const chunks = [];
      const headers = {};
      const res = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        }
      });
      res.setHeader = (k, v) => (headers[k.toLowerCase()] = v);
      res.on('finish', () =>
        resolve({ served: true, headers, size: Buffer.concat(chunks).length })
      );
      handler({ url }, res, () => resolve({ served: false }));
    });
  }

  it('serves a wasm file with its media type', async () => {
    const result = await serve(
      `${MEDIAPIPE_ASSET_PATHS.tasksVisionFileSet}/vision_wasm_internal.wasm`
    );
    expect(result.served).toBe(true);
    expect(result.headers['content-type']).toBe('application/wasm');
    expect(result.size).toBeGreaterThan(1000);
  });

  it('serves the loader script as JavaScript, ignoring a query string', async () => {
    const result = await serve(
      `${MEDIAPIPE_ASSET_PATHS.tasksVisionFileSet}/vision_wasm_internal.js?v=1`
    );
    expect(result.headers['content-type']).toBe('text/javascript');
  });

  it('passes everything else on', async () => {
    expect((await serve(`${MEDIAPIPE_ASSET_PATHS.tasksVisionFileSet}/../../etc`)).served).toBe(
      false
    );
    expect((await serve('/some/page')).served).toBe(false);
  });
});
