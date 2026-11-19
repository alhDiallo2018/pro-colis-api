/**
 * Reader de configuration Consolidation / backhaul (`consolidation.*`).
 * Même pattern que eta-config / anomaly-config.
 *
 * Clés supportées :
 *  - `consolidation.enabled` (bool) — kill-switch ; false ⇒ l'endpoint
 *    retourne des matches tous marqués `compatible=false, reasons=['disabled']`.
 *  - `consolidation.onRouteToleranceKm` (number) — distance max point-colis ↔
 *    droite trajet.
 *  - `consolidation.parcelLookbackDays` (number) — fenêtre de recherche des
 *    colis candidats.
 *  - `consolidation.parcelLimit` (number) — top-N candidats chargés en base.
 *  - `consolidation.rejectedPreviewLimit` (number) — nb de rejetés renvoyés
 *    pour debug.
 *  - `consolidation.weightPickupDistance` / `weightDropoffDistance` /
 *    `weightWeightFit` (number) — pondérations du score de tie-break.
 *  - `consolidation.adoptableStatuses` (list CSV) — statuts colis adossables
 *    (défaut : pending,free).
 */

import { prisma } from '../config/prisma.js';
import { CONSOLIDATION_DEFAULTS } from './consolidation-matcher.js';

const CACHE_TTL_MS = 10_000;
const CONFIG_KEY_PREFIX = 'consolidation.';
const FLAG_KEY = 'consolidation.enabled';
const STATUSES_KEY = 'consolidation.adoptableStatuses';

const DEFAULTS = Object.freeze({
  parcelLookbackDays: 14,
  parcelLimit: 100,
  rejectedPreviewLimit: 20
});

let cachedConfig = null;
let cachedAt = 0;

const NUMBER_KEYS = Object.freeze({
  'consolidation.onRouteToleranceKm': 'onRouteToleranceKm',
  'consolidation.parcelLookbackDays': 'parcelLookbackDays',
  'consolidation.parcelLimit': 'parcelLimit',
  'consolidation.rejectedPreviewLimit': 'rejectedPreviewLimit',
  'consolidation.weightPickupDistance': 'weightPickupDistance',
  'consolidation.weightDropoffDistance': 'weightDropoffDistance',
  'consolidation.weightWeightFit': 'weightWeightFit'
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

function coerceStringList(value) {
  if (Array.isArray(value)) {
    const arr = value.map((v) => String(v).trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  }
  if (typeof value === 'string') {
    const arr = value.split(',').map((v) => v.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  }
  return null;
}

export async function readConsolidationConfig() {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) return cachedConfig;

  const rows = await prisma.systemConfig.findMany({
    where: { key: { startsWith: CONFIG_KEY_PREFIX } }
  });

  const overrides = {};
  let enabled = true;
  let adoptableStatuses = null;

  for (const row of rows) {
    if (row.key === FLAG_KEY) {
      const b = coerceBool(row.value);
      if (b != null) enabled = b;
      continue;
    }
    if (row.key === STATUSES_KEY) {
      const list = coerceStringList(row.value);
      if (list) adoptableStatuses = list;
      continue;
    }
    const field = NUMBER_KEYS[row.key];
    if (!field) continue;
    const num = coerceNumber(row.value);
    if (num != null) overrides[field] = num;
  }

  cachedConfig = {
    enabled,
    // Matcher-facing config (consommée par matchCompatibleParcels)
    matcher: {
      enabled,
      onRouteToleranceKm: overrides.onRouteToleranceKm ?? CONSOLIDATION_DEFAULTS.onRouteToleranceKm,
      adoptableStatuses: adoptableStatuses ?? CONSOLIDATION_DEFAULTS.adoptableStatuses,
      weightPickupDistance: overrides.weightPickupDistance ?? CONSOLIDATION_DEFAULTS.weightPickupDistance,
      weightDropoffDistance: overrides.weightDropoffDistance ?? CONSOLIDATION_DEFAULTS.weightDropoffDistance,
      weightWeightFit: overrides.weightWeightFit ?? CONSOLIDATION_DEFAULTS.weightWeightFit
    },
    // Controller-facing config
    parcelLookbackDays: overrides.parcelLookbackDays ?? DEFAULTS.parcelLookbackDays,
    parcelLimit: overrides.parcelLimit ?? DEFAULTS.parcelLimit,
    rejectedPreviewLimit: overrides.rejectedPreviewLimit ?? DEFAULTS.rejectedPreviewLimit,
    adoptableStatuses: adoptableStatuses ?? CONSOLIDATION_DEFAULTS.adoptableStatuses
  };
  cachedAt = now;
  return cachedConfig;
}

export function invalidateConsolidationConfigCache() {
  cachedConfig = null;
  cachedAt = 0;
}
