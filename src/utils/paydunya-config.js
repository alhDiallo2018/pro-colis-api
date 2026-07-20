import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

// Config PayDunya gérable par l'admin : stockée dans SystemConfig sous les
// clés "paydunya.*" (convention existante du checkout). La base PRIME sur
// l'env, qui ne sert que de valeur par défaut. Snapshot mémoire TTL 30s.
const TTL_MS = 30_000;
const KEYS = ['masterKey', 'privateKey', 'token', 'mode', 'storeName'];

let dbConfig = null;
let loadedAt = 0;
let loading = null;

export async function loadPaydunyaConfig(force = false) {
  const stale = force || dbConfig === null || Date.now() - loadedAt > TTL_MS;
  if (!stale) return effective();
  if (!loading) {
    loading = prisma.systemConfig
      .findMany({ where: { key: { startsWith: 'paydunya.' } } })
      .then((rows) => {
        const cfg = {};
        for (const row of rows) {
          const name = row.key.slice('paydunya.'.length);
          if (KEYS.includes(name) && row.value != null && row.value !== '') cfg[name] = row.value;
        }
        dbConfig = cfg;
        loadedAt = Date.now();
      })
      .catch(() => {
        dbConfig = dbConfig ?? {};
        loadedAt = Date.now();
      })
      .finally(() => {
        loading = null;
      });
  }
  await loading;
  return effective();
}

export function invalidatePaydunyaConfigCache() {
  dbConfig = null;
  loadedAt = 0;
}

function effective() {
  const db = dbConfig ?? {};
  return {
    masterKey: db.masterKey || env.PAYDUNYA_MASTER_KEY || '',
    privateKey: db.privateKey || env.PAYDUNYA_PRIVATE_KEY || '',
    token: db.token || env.PAYDUNYA_TOKEN || '',
    mode: db.mode || env.PAYDUNYA_MODE || 'test',
    storeName: db.storeName || env.PAYDUNYA_STORE_NAME || 'ProColis'
  };
}

/** Accès synchrone au snapshot (rafraîchi paresseusement en arrière-plan). */
export function paydunyaConfigSnapshot() {
  void loadPaydunyaConfig();
  return effective();
}
