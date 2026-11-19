/**
 * Lecture mutualisée des timings (polling, timeouts, fenêtres) depuis
 * SystemConfig. Les valeurs sont stockées sous les clés `timings.*` (K-V JSON),
 * l'administrateur peut ajuster en runtime sans redéploiement.
 *
 * Cache mémoire 60 s pour ne pas interroger la DB à chaque requête (les
 * endpoints `/public/config` et les lectures internes passent tous ici). Les
 * mutations admin prennent effet dans les 60 s ou via
 * `invalidateTimingsCache()`.
 *
 * Toute valeur hors plage / non numérique est silencieusement remplacée par
 * le défaut : aucun endpoint n'échoue si la config est corrompue.
 */

import { prisma } from '../config/prisma.js';

const CACHE_TTL_MS = 60_000;
const CONFIG_KEY_PREFIX = 'timings.';

/**
 * Valeurs par défaut exposées. Toute clé ajoutée ici est aussi lue depuis
 * SystemConfig : les defaults servent de fallback (DB vide, démarrage, test).
 * Correspond au contrat consommé par Web (`usePollingConfig`) et Mobile
 * (`PublicConfigProvider`).
 */
export const TIMINGS_DEFAULTS = Object.freeze({
  // Polling (Web + Mobile)
  parcelStatusPollMs: 60_000,
  parcelsListPollMs: 15_000,
  announcementsFeedPollMs: 5_000,
  journeyPositionsPollMs: 15_000,
  operationsDashboardPollMs: 60_000,
  driverDiscoveryPollMs: 60_000,

  // Timeouts
  apiRequestTimeoutMs: 30_000,
  geolocationTimeoutMs: 15_000,
  googleAuthTimeoutMs: 15_000,

  // GPS
  locationUploadIntervalSec: 10,
  locationFreshnessSec: 60,

  // Messaging
  messageEditWindowMs: 900_000,
  broadcastSnoozeHours: 2,

  // Discovery
  positionTtlMs: 600_000,

  // Webhooks internes
  webhookRetryBackoffBaseMs: 30_000,
  webhookPollIntervalMs: 15_000,
  webhookMaxAttempts: 6,

  // PWA
  pwaSyncMaxAttempts: 10
});

let cachedTimings = null;
let cachedAt = 0;

function coerceNumber(raw) {
  if (raw == null) return null;
  const value = typeof raw === 'object' && raw !== null ? raw.value : raw;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Retourne la config timings effective (defaults + overrides SystemConfig).
 * Cache 60 s. Les valeurs non numériques ou négatives en DB sont ignorées
 * au profit du défaut.
 */
export async function readTimingsConfig() {
  const now = Date.now();
  if (cachedTimings && now - cachedAt < CACHE_TTL_MS) {
    return cachedTimings;
  }

  let rows = [];
  try {
    rows = await prisma.systemConfig.findMany({
      where: { key: { startsWith: CONFIG_KEY_PREFIX } }
    });
  } catch {
    // Boot avant migration ou DB momentanément indisponible : les defaults
    // garantissent la poursuite du service.
    rows = [];
  }

  const overrides = {};
  for (const row of rows) {
    const field = row.key.slice(CONFIG_KEY_PREFIX.length);
    if (!(field in TIMINGS_DEFAULTS)) continue;
    const num = coerceNumber(row.value);
    if (num != null) overrides[field] = num;
  }

  cachedTimings = Object.freeze({ ...TIMINGS_DEFAULTS, ...overrides });
  cachedAt = now;
  return cachedTimings;
}

/**
 * Version synchrone : retourne le dernier snapshot (ou les defaults si le
 * cache n'est pas encore amorcé). Utile pour les initialisations de workers
 * où un `await` est indésirable.
 */
export function readTimingsConfigSync() {
  return cachedTimings ?? TIMINGS_DEFAULTS;
}

/**
 * Invalide le cache. À appeler depuis une mutation admin ou les tests.
 */
export function invalidateTimingsCache() {
  cachedTimings = null;
  cachedAt = 0;
}
