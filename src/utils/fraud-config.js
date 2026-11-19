/**
 * Reader de configuration Fraude (`fraud.*` dans SystemConfig).
 * Même pattern que eta-config / anomaly-config.
 *
 * Ces knobs permettent à un super-admin d'ajuster les seuils et pondérations
 * du scoring de fraude sans redéploiement. Tous les signaux restent calculés
 * côté backend — l'humain reste dans la boucle (jamais de blocage automatique).
 *
 * Clés supportées :
 *  - `fraud.enabled` (bool) — kill-switch global.
 *  - `fraud.newAccountDays` (number)
 *  - `fraud.cancellationRatioRiskThreshold` (number 0..1)
 *  - `fraud.otpFailures24hRiskThreshold` (number)
 *  - `fraud.multiDevicesRiskThreshold` (number)
 *  - `fraud.recentCancellationsRiskThreshold` (number)
 *  - `fraud.pointsNewAccount` (number)
 *  - `fraud.pointsHighCancellationRatio` (number)
 *  - `fraud.pointsHasCancellationDebt` (number)
 *  - `fraud.pointsOtpFailures` (number)
 *  - `fraud.pointsMultiDevices` (number)
 *  - `fraud.pointsRecentCancellations` (number)
 *  - `fraud.flagThresholdLow` / `fraud.flagThresholdMedium` /
 *    `fraud.flagThresholdHigh` (number)
 *  - `fraud.activeLookbackDays` (number) — fenêtre utilisée par
 *    `refreshFraudAlerts` pour sélectionner les users à scanner.
 */

import { prisma } from '../config/prisma.js';
import { FRAUD_SCORING_DEFAULTS } from './fraud-scoring.js';

const CACHE_TTL_MS = 10_000;
const CONFIG_KEY_PREFIX = 'fraud.';
const FLAG_KEY = 'fraud.enabled';

const DEFAULT_ACTIVE_LOOKBACK_DAYS = 30;

let cachedConfig = null;
let cachedAt = 0;

const NUMBER_KEYS = Object.freeze({
  'fraud.newAccountDays': 'newAccountDays',
  'fraud.cancellationRatioRiskThreshold': 'cancellationRatioRiskThreshold',
  'fraud.otpFailures24hRiskThreshold': 'otpFailures24hRiskThreshold',
  'fraud.multiDevicesRiskThreshold': 'multiDevicesRiskThreshold',
  'fraud.recentCancellationsRiskThreshold': 'recentCancellationsRiskThreshold',
  'fraud.pointsNewAccount': 'pointsNewAccount',
  'fraud.pointsHighCancellationRatio': 'pointsHighCancellationRatio',
  'fraud.pointsHasCancellationDebt': 'pointsHasCancellationDebt',
  'fraud.pointsOtpFailures': 'pointsOtpFailures',
  'fraud.pointsMultiDevices': 'pointsMultiDevices',
  'fraud.pointsRecentCancellations': 'pointsRecentCancellations'
});

const THRESHOLD_KEYS = Object.freeze({
  'fraud.flagThresholdLow': 'low',
  'fraud.flagThresholdMedium': 'medium',
  'fraud.flagThresholdHigh': 'high'
});

function coerceNumber(value) {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
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
 * Retourne la config complète. `scoringConfig` est prêt à passer à
 * `scoreFraud(signals, { config: scoringConfig })`.
 */
export async function readFraudConfig() {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) return cachedConfig;

  const rows = await prisma.systemConfig.findMany({
    where: { key: { startsWith: CONFIG_KEY_PREFIX } }
  });

  const overrides = {};
  const thresholdOverrides = {};
  let enabled = true;
  let activeLookbackDays = DEFAULT_ACTIVE_LOOKBACK_DAYS;

  for (const row of rows) {
    if (row.key === FLAG_KEY) {
      const b = coerceBool(row.value);
      if (b != null) enabled = b;
      continue;
    }
    if (row.key === 'fraud.activeLookbackDays') {
      const n = coerceNumber(row.value);
      if (n != null && n > 0) activeLookbackDays = n;
      continue;
    }
    if (NUMBER_KEYS[row.key]) {
      const n = coerceNumber(row.value);
      if (n != null) overrides[NUMBER_KEYS[row.key]] = n;
      continue;
    }
    if (THRESHOLD_KEYS[row.key]) {
      const n = coerceNumber(row.value);
      if (n != null) thresholdOverrides[THRESHOLD_KEYS[row.key]] = n;
    }
  }

  const scoringConfig = {
    ...FRAUD_SCORING_DEFAULTS,
    ...overrides,
    enabled,
    flagThresholds: {
      ...FRAUD_SCORING_DEFAULTS.flagThresholds,
      ...thresholdOverrides
    }
  };

  cachedConfig = {
    enabled,
    activeLookbackDays,
    scoringConfig
  };
  cachedAt = now;
  return cachedConfig;
}

export function invalidateFraudConfigCache() {
  cachedConfig = null;
  cachedAt = 0;
}
