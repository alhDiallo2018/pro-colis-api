// Configuration d'authentification administrable via `SystemConfig`.
//
// Centralise la lecture des clés `auth.*` (durée OTP, tentatives max) afin
// que `.env` n'en soit plus la source primaire. Le repli sur `env` reste
// présent pour préserver la compatibilité ascendante le temps que l'admin
// alimente les clés.

import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

const TTL_MS = 30_000;

let dbSnapshot = null;
let loadedAt = 0;
let loading = null;

const KEYS = ['auth.otpExpiryMinutes', 'auth.otpMaxAttempts'];

function unwrap(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
    return raw.value;
  }
  return raw;
}

async function refresh() {
  try {
    const rows = await prisma.systemConfig.findMany({ where: { key: { in: KEYS } } });
    const map = Object.fromEntries(rows.map((row) => [row.key, unwrap(row.value)]));
    dbSnapshot = map;
  } catch {
    // Ne pas bloquer la ligne critique OTP sur un incident Prisma : on
    // retombe sur l'env et on retentera au prochain appel (TTL expiré).
    dbSnapshot = dbSnapshot ?? {};
  } finally {
    loadedAt = Date.now();
    loading = null;
  }
}

export async function loadAuthConfig(force = false) {
  const stale = force || dbSnapshot === null || Date.now() - loadedAt > TTL_MS;
  if (stale) {
    if (!loading) loading = refresh();
    await loading;
  }

  const db = dbSnapshot ?? {};

  const dbExpiry = Number(db['auth.otpExpiryMinutes']);
  const dbAttempts = Number(db['auth.otpMaxAttempts']);

  return {
    otpExpiryMinutes:
      Number.isFinite(dbExpiry) && dbExpiry > 0
        ? dbExpiry
        : Number(env.OTP_EXPIRES_MINUTES) || 10,
    otpMaxAttempts:
      Number.isFinite(dbAttempts) && dbAttempts > 0 ? dbAttempts : 5
  };
}

export function invalidateAuthConfigCache() {
  dbSnapshot = null;
  loadedAt = 0;
}
