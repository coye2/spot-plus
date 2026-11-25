// feature-flags.js — Independent runtime switches for Operation S+ capabilities.
// Every high-risk S+ optimization can be toggled off cleanly via localStorage or runtime API
// without rolling back the entire release or breaking existing settings.

export const FLAGS_STORAGE_KEY = 'spotplus.flags.v1';

export const DEFAULT_FLAGS = Object.freeze({
  sPlusStateMachine: true,
  sPlusRecoveryCheckpoint: true,
  sPlusAdaptivePreload: true,
  sPlusCrossfadeGuard: true,
  sPlusGracefulDegradation: true,
  sPlusNetworkTimeouts: true,
  // Vehicle integration pathways (modular & disabled by default until verified on target hardware)
  vehicleDriveBridge: false,
  vehicleGatewayPairing: false,
  vehicleNativeMicrobridge: false,
});

let overrides = null;

function readStorage(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(FLAGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean = {};
    for (const key of Object.keys(DEFAULT_FLAGS)) {
      if (typeof parsed[key] === 'boolean') clean[key] = parsed[key];
    }
    return clean;
  } catch {
    return {};
  }
}

function writeStorage(next, storage = globalThis.localStorage) {
  try {
    if (!Object.keys(next).length) storage?.removeItem?.(FLAGS_STORAGE_KEY);
    else storage?.setItem?.(FLAGS_STORAGE_KEY, JSON.stringify(next));
  } catch { /* storage blocked or full */ }
}

function ensureLoaded() {
  if (overrides === null) overrides = readStorage();
  return overrides;
}

export function getFlags() {
  return { ...DEFAULT_FLAGS, ...ensureLoaded() };
}

export function isFeatureEnabled(name) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_FLAGS, name)) return false;
  const loaded = ensureLoaded();
  return typeof loaded[name] === 'boolean' ? loaded[name] : DEFAULT_FLAGS[name];
}

export function setFeatureFlag(name, enabled) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_FLAGS, name)) return false;
  const loaded = ensureLoaded();
  loaded[name] = !!enabled;
  writeStorage(loaded);
  return loaded[name];
}

export function resetFeatureFlags() {
  overrides = {};
  writeStorage(overrides);
  return getFlags();
}

export function reloadFeatureFlags(storage = globalThis.localStorage) {
  overrides = readStorage(storage);
  return getFlags();
}

export const featureFlags = Object.freeze({
  get: getFlags,
  isEnabled: isFeatureEnabled,
  set: setFeatureFlag,
  reset: resetFeatureFlags,
  reload: reloadFeatureFlags,
  defaults: DEFAULT_FLAGS,
});
