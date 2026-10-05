// Serves the MediaPipe tasks-vision wasm file set (≈19 MB, used by the call
// camera background effects) from this app's own origin instead of
// jsdelivr: straight out of node_modules in dev, emitted into the client
// build for production. Nothing is committed — the files always match the
// tasks-vision version @livekit/track-processors depends on, and the build
// fails if that version drifts from the one the app pins.
import { createRequire } from 'node:module';
import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MEDIAPIPE_ASSET_PATHS,
  MEDIAPIPE_TASKS_VISION_VERSION
} from '../src/lib/groups/call-background.js';

const BASE = MEDIAPIPE_ASSET_PATHS.tasksVisionFileSet;
const TYPES = { '.wasm': 'application/wasm', '.js': 'text/javascript' };

/** The tasks-vision package @livekit/track-processors resolves (pnpm: not hoisted). */
export function resolveTasksVision() {
  const require = createRequire(import.meta.url);
  const fromProcessors = createRequire(require.resolve('@livekit/track-processors'));
  const root = dirname(fromProcessors.resolve('@mediapipe/tasks-vision'));
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dir = join(root, 'wasm');
  const files = readdirSync(dir).filter((f) => f.endsWith('.wasm') || f.endsWith('.js'));
  return { version, dir, files };
}

/** @param {string} file */
function typeOf(file) {
  return TYPES[/** @type {'.wasm' | '.js'} */ (file.slice(file.lastIndexOf('.')))];
}

/** @returns {import('vite').Plugin & { generateBundle: Function, configureServer: Function }} */
export function mediapipeWasm() {
  const { version, dir, files } = resolveTasksVision();
  if (version !== MEDIAPIPE_TASKS_VISION_VERSION) {
    throw new Error(
      `@livekit/track-processors now uses @mediapipe/tasks-vision ${version}; ` +
        `update MEDIAPIPE_TASKS_VISION_VERSION in src/lib/groups/call-background.js`
    );
  }
  return {
    name: 'edufeed:mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const file = path.startsWith(BASE + '/') ? path.slice(BASE.length + 1) : '';
        if (!files.includes(file)) return next();
        res.setHeader('Content-Type', typeOf(file));
        createReadStream(join(dir, file)).pipe(res);
      });
    },
    generateBundle() {
      if (this.environment?.config?.build?.ssr) return;
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: `${BASE.slice(1)}/${file}`,
          source: readFileSync(join(dir, file))
        });
      }
    }
  };
}
