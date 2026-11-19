/**
 * Lecture mutualisée des limites de formulaires et d'imports depuis
 * SystemConfig. Les valeurs sont stockées sous les clés `limits.*`
 * (K-V JSON), l'administrateur peut ajuster en runtime sans redéploiement.
 *
 * Cache mémoire 60 s pour ne pas interroger la DB à chaque requête (les
 * endpoints `/public/config` et les lectures internes passent tous ici). Les
 * mutations admin prennent effet dans les 60 s ou via
 * `invalidateLimitsCache()`.
 *
 * Toute valeur hors plage / non numérique est silencieusement remplacée par
 * le défaut : aucun endpoint n'échoue si la config est corrompue.
 *
 * Phase 4 externalisation : les limites UI (longueurs max de champ, tailles
 * d'import CSV, dimensions photo) ne sont plus codées en dur. Les clients
 * Web et Mobile exposent les mêmes clés via `/public/config.limits`.
 */

import { prisma } from '../config/prisma.js';

const CACHE_TTL_MS = 60_000;
const CONFIG_KEY_PREFIX = 'limits.';

/**
 * Valeurs par défaut exposées. Correspondent aux constantes historiques
 * trouvées dans les clients : garder cette table synchronisée avec
 * `DEFAULT_LIMITS` côté web (`src/lib/api/publicConfig.ts`) et
 * `kLimitsFallback` côté mobile (`lib/models/public_config.dart`).
 */
export const LIMITS_DEFAULTS = Object.freeze({
  // CSV / imports
  csvMaxLines: 50,
  csvMaxBytes: 2_097_152, // 2 MiB
  routesCsvMaxBytes: 131_072, // 128 KiB
  maxStopsPerRoute: 38,
  maxDeparturesPerPublish: 100,

  // Colis
  parcelWeightLightKg: 10,
  parcelPhotosMax: 4,
  parcelDescriptionMaxChars: 280,
  parcelDescriptionLongMaxChars: 100_000, // ParcelExperience
  addressMaxChars: 500,
  phoneMaxChars: 30,

  // Annonces / cash / messages courts
  annonceDescriptionMaxChars: 200,
  cashJustificationMaxChars: 200,
  disputeDescriptionMaxChars: 2000,

  // Médias
  imageMaxDimension: 1600,
  imageJpegQuality: 0.8,

  // Pagination API (zones)
  zonePageSize: 100,
  zoneMaxPages: 20
});

let cachedLimits = null;
let cachedAt = 0;

function coerceNumber(raw) {
  if (raw == null) return null;
  const value = typeof raw === 'object' && raw !== null ? raw.value : raw;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Retourne la config limites effective (defaults + overrides SystemConfig).
 * Cache 60 s. Les valeurs non numériques ou négatives en DB sont ignorées
 * au profit du défaut.
 */
export async function readLimitsConfig() {
  const now = Date.now();
  if (cachedLimits && now - cachedAt < CACHE_TTL_MS) {
    return cachedLimits;
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
    if (!(field in LIMITS_DEFAULTS)) continue;
    const num = coerceNumber(row.value);
    if (num != null) overrides[field] = num;
  }

  cachedLimits = Object.freeze({ ...LIMITS_DEFAULTS, ...overrides });
  cachedAt = now;
  return cachedLimits;
}

/**
 * Version synchrone : retourne le dernier snapshot (ou les defaults si le
 * cache n'est pas encore amorcé). Utile pour les initialisations de workers
 * où un `await` est indésirable.
 */
export function readLimitsConfigSync() {
  return cachedLimits ?? LIMITS_DEFAULTS;
}

/**
 * Invalide le cache. À appeler depuis une mutation admin ou les tests.
 */
export function invalidateLimitsCache() {
  cachedLimits = null;
  cachedAt = 0;
}
