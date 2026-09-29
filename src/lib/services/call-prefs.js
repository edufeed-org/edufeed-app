// Per-device call preferences, kept in localStorage: remembered mic /
// speaker / camera, browser audio processing flags, per-person playback
// volume, the screen share quality preset and whether the chat sits beside
// the call. These are conveniences for this browser only — every read falls
// back to a default and every write is best effort, because storage can be
// blocked (private mode, cleared site data) and a call must still work
// without it.

const PREFIX = 'edufeed:call:';
const DEVICE_KEYS = {
  audioinput: 'micDeviceId',
  audiooutput: 'speakerDeviceId',
  videoinput: 'cameraDeviceId'
};

/** @param {string} key */
function read(key) {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/** @param {string} key @param {string | null} value */
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // best effort
  }
}

/** @param {string} key @param {any} fallback */
function readJson(key, fallback) {
  const raw = read(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {MediaDeviceKind} kind
 * @returns {string | null}
 */
export function getPreferredDevice(kind) {
  const key = DEVICE_KEYS[kind];
  return key ? read(key) || null : null;
}

/** @param {MediaDeviceKind} kind @param {string} deviceId */
export function rememberDevice(kind, deviceId) {
  const key = DEVICE_KEYS[kind];
  if (key) write(key, deviceId || null);
}

/** @typedef {{noiseSuppression: boolean, echoCancellation: boolean, autoGainControl: boolean}} AudioProcessing */

/** @type {AudioProcessing} */
const PROCESSING_DEFAULTS = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true
};

/** @returns {AudioProcessing} */
export function getAudioProcessing() {
  const stored = readJson('audioProcessing', {});
  /** @type {AudioProcessing} */
  const result = { ...PROCESSING_DEFAULTS };
  for (const key of /** @type {(keyof AudioProcessing)[]} */ (Object.keys(PROCESSING_DEFAULTS))) {
    if (typeof stored[key] === 'boolean') result[key] = stored[key];
  }
  return result;
}

/**
 * @param {Partial<AudioProcessing>} partial
 * @returns {AudioProcessing}
 */
export function setAudioProcessing(partial) {
  const next = { ...getAudioProcessing(), ...partial };
  write('audioProcessing', JSON.stringify(next));
  return next;
}

/**
 * Capture options for the microphone. Mono on purpose: a stereo interface
 * that only fills one channel otherwise publishes one-sided audio.
 */
export function micCaptureOptions() {
  const deviceId = getPreferredDevice('audioinput');
  return {
    ...(deviceId ? { deviceId } : {}),
    ...getAudioProcessing(),
    channelCount: 1
  };
}

export function cameraCaptureOptions() {
  const deviceId = getPreferredDevice('videoinput');
  return deviceId ? { deviceId } : {};
}

/** Playback volume per pubkey, 0..2 (Web Audio gain; 1 = unchanged). */
/** @param {string} pubkey */
export function getParticipantVolume(pubkey) {
  const volumes = readJson('volumes', {});
  const value = volumes[pubkey];
  return typeof value === 'number' && Number.isFinite(value) ? clampVolume(value) : 1;
}

/** @param {string} pubkey @param {number} volume */
export function setParticipantVolume(pubkey, volume) {
  const volumes = readJson('volumes', {});
  const value = clampVolume(volume);
  if (value === 1) delete volumes[pubkey];
  else volumes[pubkey] = value;
  write('volumes', JSON.stringify(volumes));
  return value;
}

/** @param {number} value */
function clampVolume(value) {
  return Math.min(2, Math.max(0, Number(value) || 0));
}

/**
 * Screen share presets: resolution + frame rate. Text-heavy teaching
 * content (slides, code) wants resolution over motion; video wants fps.
 */
export const SCREEN_SHARE_QUALITIES = {
  '720p15': { width: 1280, height: 720, frameRate: 15 },
  '1080p15': { width: 1920, height: 1080, frameRate: 15 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30 },
  '1440p30': { width: 2560, height: 1440, frameRate: 30 }
};

/** @typedef {keyof typeof SCREEN_SHARE_QUALITIES} ScreenShareQuality */

/** @returns {ScreenShareQuality} */
export function getScreenShareQuality() {
  const stored = read('screenShareQuality');
  return stored && stored in SCREEN_SHARE_QUALITIES
    ? /** @type {ScreenShareQuality} */ (stored)
    : '1080p30';
}

/** @param {string} quality */
export function setScreenShareQuality(quality) {
  if (quality in SCREEN_SHARE_QUALITIES) write('screenShareQuality', quality);
}

/** Wide screens: chat as a column beside the call stage (off = stage only). */
export function getChatBeside() {
  return read('chatBeside') === '1';
}

/** @param {boolean} beside */
export function setChatBeside(beside) {
  write('chatBeside', beside ? '1' : null);
}
