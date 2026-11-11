/**
 * Reader de configuration anomalies (clés `anomaly.*` dans SystemConfig).
 * Mêmes conventions que eta-config : cache 10 s, defaults depuis
 * `ANOMALY_DEFAULTS`, valeurs non-numériques ignorées silencieusement.
 */

import { prisma } from '../config/prisma.js';
import { ANOMALY_DEFAULTS } from './anomaly-detector.js';

const CACHE_TTL_MS = 10_000;
const CONFIG_KEY_PREFIX = 'anomaly.';
const FLAG_KEY = 'anomaly.enabled';
const DEFAULT_ENABLED = true;

let cachedConfig = null;
let cachedAt = 0;

const KEY_MAP = Object.freeze({
  'anomaly.gpsSilenceMinutes': 'gpsSilenceMinutes',
  'anomaly.prolongedStopMinutes': 'prolongedStopMinutes',
  'anomaly.stopRadiusMeters': 'stopRadiusMeters',
  'anomaly.minPointsForStopDetection': 'minPointsForStopDetection',
  'anomaly.deviationThresholdKm': 'deviationThresholdKm',
  'anomaly.recentWindowMinutes': 'recentWindowMinutes'
});

function coerceNumber(value) {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
  }
  return null;
}

export async function readAnomalyConfig() {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) return cachedConfig;

  const rows = await prisma.systemConfig.findMany({
    where: { key: { startsWith: CONFIG_KEY_PREFIX } }
  });

  const overrides = {};
  let enabled = DEFAULT_ENABLED;
  for (const row of rows) {
    if (row.key === FLAG_KEY) {
      const b = coerceBool(row.value);
      if (b != null) enabled = b;
      continue;
    }
    const field = KEY_MAP[row.key];
    if (!field) continue;
    const num = coerceNumber(row.value);
    if (num != null) overrides[field] = num;
  }

  cachedConfig = { ...ANOMALY_DEFAULTS, ...overrides, enabled };
  cachedAt = now;
  return cachedConfig;
}

export function invalidateAnomalyConfigCache() {
  cachedConfig = null;
  cachedAt = 0;
}
