/**
 * Lecture mutualisée des constantes ETA depuis SystemConfig.
 *
 * Les clés sont stockées sous le préfixe `eta.*` (ex. `eta.routeFactor`).
 * Cache mémoire 10 s pour éviter de solliciter la DB à chaque polling
 * tracking (5 s côté mobile par colis actif). Les mutations admin
 * invalideront implicitement le cache dans les 10 s.
 */

import { prisma } from '../config/prisma.js';
import { ETA_DEFAULTS } from './eta-calculator.js';

const CACHE_TTL_MS = 10_000;
const CONFIG_KEY_PREFIX = 'eta.';
const FLAG_KEY = 'eta.enabled';
const DEFAULT_ENABLED = true;

let cachedConfig = null;
let cachedAt = 0;

const KEY_MAP = Object.freeze({
  'eta.routeFactor': 'routeFactor',
  'eta.defaultSpeedKmh': 'defaultSpeedKmh',
  'eta.minSpeedKmh': 'minSpeedKmh',
  'eta.stopThresholdKmh': 'stopThresholdKmh',
  'eta.freshPositionMaxAgeSec': 'freshPositionMaxAgeSec',
  'eta.stalePositionMaxAgeSec': 'stalePositionMaxAgeSec',
  'eta.recentWindowMinutes': 'recentWindowMinutes',
  'eta.minPointsForMeasuredSpeed': 'minPointsForMeasuredSpeed',
  'eta.aberrationMaxSpeedKmh': 'aberrationMaxSpeedKmh',
  'eta.marginHigh': 'marginHigh',
  'eta.marginMedium': 'marginMedium',
  'eta.marginLow': 'marginLow'
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

/**
 * Retourne la configuration ETA effective (defaults + overrides SystemConfig).
 * Cache 10 s. Les valeurs non-numériques en DB sont silencieusement ignorées
 * au profit du défaut (jamais d'erreur côté endpoint tracking).
 *
 * Inclut le flag `enabled` (défaut `true`) permettant de désactiver
 * globalement l'ETA dynamique sans redéploiement : si `eta.enabled = false`
 * dans SystemConfig, le backend renvoie `eta: null` sur tous les endpoints
 * tracking et le mobile retombe sur `estimatedDeliveryDate` statique.
 *
 * @returns {Promise<typeof ETA_DEFAULTS & {enabled: boolean}>}
 */
export async function readEtaConfig() {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

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
    const fieldName = KEY_MAP[row.key];
    if (!fieldName) continue;
    const num = coerceNumber(row.value);
    if (num != null) overrides[fieldName] = num;
  }

  cachedConfig = { ...ETA_DEFAULTS, ...overrides, enabled };
  cachedAt = now;
  return cachedConfig;
}

/**
 * À utiliser depuis les tests ou après une mutation admin qui doit
 * reprendre effet immédiatement (sans attendre l'expiration du cache).
 */
export function invalidateEtaConfigCache() {
  cachedConfig = null;
  cachedAt = 0;
}
