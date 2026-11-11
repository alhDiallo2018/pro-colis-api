import { prisma } from '../config/prisma.js';
import { DRIVER_SCORING_DEFAULTS } from './driver-scoring.js';

const CACHE_TTL_MS = 10_000;
const PREFIX = 'driverScoring.';
const FLAG_KEY = 'driverScoring.enabled';

let cached = null;
let cachedAt = 0;

const KEY_MAP = Object.freeze({
  'driverScoring.weightPrice': 'weightPrice',
  'driverScoring.weightRating': 'weightRating',
  'driverScoring.weightDistance': 'weightDistance',
  'driverScoring.weightPunctuality': 'weightPunctuality',
  'driverScoring.weightTypeMatch': 'weightTypeMatch',
  'driverScoring.maxDistanceKm': 'maxDistanceKm',
  'driverScoring.minAcceptableRating': 'minAcceptableRating'
});

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
  }
  return null;
}

export async function readDriverScoringConfig() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;
  const rows = await prisma.systemConfig.findMany({ where: { key: { startsWith: PREFIX } } });
  const overrides = {};
  let enabled = DRIVER_SCORING_DEFAULTS.enabled;
  for (const row of rows) {
    if (row.key === FLAG_KEY) {
      const b = bool(row.value);
      if (b != null) enabled = b;
      continue;
    }
    const field = KEY_MAP[row.key];
    if (!field) continue;
    const n = num(row.value);
    if (n != null) overrides[field] = n;
  }
  cached = { ...DRIVER_SCORING_DEFAULTS, ...overrides, enabled };
  cachedAt = now;
  return cached;
}

export function invalidateDriverScoringCache() {
  cached = null;
  cachedAt = 0;
}
