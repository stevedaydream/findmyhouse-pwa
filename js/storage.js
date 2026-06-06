import { DEFAULT_CONVENIENCE_FACILITIES, DEFAULT_NUISANCE_FACILITIES, DEFAULT_CONDITIONS, CONFIG_VERSION } from './config.js';

const KEYS = {
  CONVENIENCE: 'fmh_convenience',
  NUISANCE: 'fmh_nuisance',
  CONDITIONS: 'fmh_conditions',
  EVALUATIONS: 'fmh_evaluations',
  SETTINGS: 'fmh_settings',
  CONFIG_VER: 'fmh_config_ver'
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// Merge stored facilities with defaults.
// System props (tags, searchRadius, name, icon) always use latest defaults.
// User props (enabled, weight, idealDistance, minDistance) preserved from storage.
function mergeFacilities(stored, defaults) {
  const storedMap = new Map(stored.map(f => [f.id, f]));
  const result = defaults.map(def => {
    if (!storedMap.has(def.id)) return def;
    const s = storedMap.get(def.id);
    return {
      ...def,                                                    // system props from defaults
      enabled: s.enabled !== undefined ? s.enabled : def.enabled,
      weight: s.weight !== undefined ? s.weight : def.weight,
      ...(def.idealDistance !== undefined && s.idealDistance !== undefined
        ? { idealDistance: s.idealDistance } : {}),
      ...(def.minDistance !== undefined && s.minDistance !== undefined
        ? { minDistance: s.minDistance } : {}),
      isCustom: false
    };
  });
  // Append custom facilities not in defaults
  stored.filter(f => f.isCustom).forEach(f => result.push(f));
  return result;
}

// If config version changed, wipe stored facility settings so fresh defaults apply.
// Custom (user-added) facilities are preserved. Runs once per version bump.
function migrateIfNeeded() {
  const storedVer = load(KEYS.CONFIG_VER, 0);
  if (storedVer >= CONFIG_VERSION) return;

  for (const key of [KEYS.CONVENIENCE, KEYS.NUISANCE]) {
    const stored = load(key, []);
    const customs = stored.filter(f => f.isCustom);
    save(key, customs); // Keep only user-added, defaults will be merged fresh
  }
  save(KEYS.CONFIG_VER, CONFIG_VERSION);
}

export function loadConvenience() {
  migrateIfNeeded();
  const stored = load(KEYS.CONVENIENCE, null);
  if (!stored || stored.length === 0) return [...DEFAULT_CONVENIENCE_FACILITIES];
  return mergeFacilities(stored, DEFAULT_CONVENIENCE_FACILITIES);
}

export function saveConvenience(data) {
  return save(KEYS.CONVENIENCE, data);
}

export function loadNuisance() {
  migrateIfNeeded();
  const stored = load(KEYS.NUISANCE, null);
  if (!stored || stored.length === 0) return [...DEFAULT_NUISANCE_FACILITIES];
  return mergeFacilities(stored, DEFAULT_NUISANCE_FACILITIES);
}

export function saveNuisance(data) {
  return save(KEYS.NUISANCE, data);
}

export function loadConditions() {
  const stored = load(KEYS.CONDITIONS, null);
  if (!stored) return [...DEFAULT_CONDITIONS];
  const storedMap = new Map(stored.map(c => [c.id, c]));
  const result = DEFAULT_CONDITIONS.map(def => {
    if (!storedMap.has(def.id)) return def;
    const s = storedMap.get(def.id);
    return { ...def, enabled: s.enabled !== undefined ? s.enabled : def.enabled, isCustom: false };
  });
  stored.filter(c => c.isCustom).forEach(c => result.push(c));
  return result;
}

export function saveConditions(data) {
  return save(KEYS.CONDITIONS, data);
}

export function loadEvaluations() {
  return load(KEYS.EVALUATIONS, []);
}

export function saveEvaluation(evaluation) {
  const evaluations = loadEvaluations();
  const idx = evaluations.findIndex(e => e.id === evaluation.id);
  if (idx >= 0) {
    evaluations[idx] = evaluation;
  } else {
    evaluations.unshift(evaluation);
  }
  // Keep last 50 evaluations
  if (evaluations.length > 50) evaluations.splice(50);
  return save(KEYS.EVALUATIONS, evaluations);
}

export function deleteEvaluation(id) {
  const evaluations = loadEvaluations().filter(e => e.id !== id);
  return save(KEYS.EVALUATIONS, evaluations);
}

export function loadSettings() {
  return load(KEYS.SETTINGS, { defaultRegion: 'taiwan' });
}

export function saveSettings(data) {
  return save(KEYS.SETTINGS, data);
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
