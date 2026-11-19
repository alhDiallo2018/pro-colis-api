/**
 * Lecture mutualisée du branding PWA / Web + fallbacks des notifications depuis
 * SystemConfig. Les valeurs sont stockées sous les clés `branding.*` et
 * `notifications.*` (K-V JSON), l'administrateur peut ajuster en runtime sans
 * redéploiement.
 *
 * Cache mémoire 60 s pour ne pas interroger la DB à chaque requête (les
 * endpoints `/public/config` et `/manifest.webmanifest` passent tous ici). Les
 * mutations admin prennent effet dans les 60 s ou via
 * `invalidateBrandingCache()`.
 *
 * Toute valeur hors type attendu est silencieusement remplacée par le défaut :
 * ni `/public/config` ni le manifest ne doivent échouer si la config est
 * corrompue (ex. clé `theme_color` manquante casserait l'install PWA).
 */

import { prisma } from '../config/prisma.js';

const CACHE_TTL_MS = 60_000;
const BRANDING_PREFIX = 'branding.';
const NOTIFICATIONS_PREFIX = 'notifications.';

/**
 * Valeurs par défaut exposées. Correspond au contrat consommé par Web
 * (`useBranding`, `useNotificationsConfig`, `applyBranding`) et par le service
 * worker (`pwa/sw.js` fallback notification).
 *
 * Toute clé ajoutée ici est aussi lue depuis SystemConfig : les defaults
 * servent de fallback (DB vide, démarrage, test, build Vite statique).
 */
export const BRANDING_DEFAULTS = Object.freeze({
  appName: 'ProColis',
  shortName: 'ProColis',
  themeColor: '#018982',
  backgroundColor: '#FFFFFF',
  logoUrl: '/icons/icon-192.png',
  logoDarkUrl: null,
  faviconUrl: '/favicon.ico',
  iconUrl: '/icons/icon-192.png',
  badgeUrl: '/icons/icon-72.png',
  primaryColor: '#018982',
  secondaryColor: null
});

export const NOTIFICATIONS_DEFAULTS = Object.freeze({
  fallbackTitle: 'ProColis',
  fallbackBody: 'Nouvelle activité',
  defaultIconUrl: '/icons/icon-192.png',
  defaultBadgeUrl: '/icons/icon-72.png',
  highPriorityValues: ['high', 'urgent']
});

let cachedBranding = null;
let cachedNotifications = null;
let cachedAt = 0;

function coerceString(raw) {
  if (raw == null) return null;
  const value = typeof raw === 'object' && raw !== null && 'value' in raw ? raw.value : raw;
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function coerceStringList(raw) {
  if (raw == null) return null;
  const value = Array.isArray(raw) ? raw : raw?.value;
  if (!Array.isArray(value)) return null;
  const out = value.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0);
  return out.length > 0 ? out : null;
}

/**
 * Hex color simple validation : `#RGB`, `#RRGGBB`, `#RRGGBBAA`. Toute autre
 * valeur retombe sur le défaut : un `theme_color` invalide fait rejeter le
 * manifest par Chrome et casse l'installation PWA.
 */
function coerceColor(raw) {
  const s = coerceString(raw);
  if (!s) return null;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return s;
  return null;
}

/**
 * URL/chemin pour icône, logo, favicon. Autorise aussi bien un chemin absolu
 * (`/icons/...`) servi par le web, qu'une URL `https://...`. Interdit
 * `javascript:` et autres schémas exotiques pour éviter l'injection via
 * manifest ou notification icon.
 */
function coerceUrl(raw) {
  const s = coerceString(raw);
  if (!s) return null;
  if (s.startsWith('/')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

/**
 * Retourne la config branding + notifications effective
 * (defaults + overrides SystemConfig). Cache 60 s. Les valeurs invalides en DB
 * sont ignorées au profit du défaut : le manifest reste installable.
 */
export async function readBrandingConfig() {
  const now = Date.now();
  if (cachedBranding && cachedNotifications && now - cachedAt < CACHE_TTL_MS) {
    return { branding: cachedBranding, notifications: cachedNotifications };
  }

  let rows = [];
  try {
    rows = await prisma.systemConfig.findMany({
      where: {
        OR: [
          { key: { startsWith: BRANDING_PREFIX } },
          { key: { startsWith: NOTIFICATIONS_PREFIX } }
        ]
      }
    });
  } catch {
    // Boot avant migration ou DB momentanément indisponible : les defaults
    // garantissent la poursuite du service (manifest + notifications).
    rows = [];
  }

  const brandingOverrides = {};
  const notificationsOverrides = {};

  for (const row of rows) {
    if (row.key.startsWith(BRANDING_PREFIX)) {
      const field = row.key.slice(BRANDING_PREFIX.length);
      if (!(field in BRANDING_DEFAULTS)) continue;
      // Couleurs vs URL vs libellés : chaque type a son coerceur strict pour
      // empêcher un champ corrompu (ex. `themeColor: "rouge"`) d'atteindre
      // Chrome / un `<meta>` HTML.
      let coerced = null;
      if (field === 'themeColor' || field === 'backgroundColor' || field === 'primaryColor' || field === 'secondaryColor') {
        coerced = coerceColor(row.value);
      } else if (field.endsWith('Url')) {
        coerced = coerceUrl(row.value);
      } else {
        coerced = coerceString(row.value);
      }
      if (coerced != null) brandingOverrides[field] = coerced;
    } else if (row.key.startsWith(NOTIFICATIONS_PREFIX)) {
      const field = row.key.slice(NOTIFICATIONS_PREFIX.length);
      if (!(field in NOTIFICATIONS_DEFAULTS)) continue;
      if (field === 'highPriorityValues') {
        const list = coerceStringList(row.value);
        if (list) notificationsOverrides[field] = list;
      } else if (field.endsWith('Url')) {
        const url = coerceUrl(row.value);
        if (url) notificationsOverrides[field] = url;
      } else {
        const s = coerceString(row.value);
        if (s) notificationsOverrides[field] = s;
      }
    }
  }

  cachedBranding = Object.freeze({ ...BRANDING_DEFAULTS, ...brandingOverrides });
  cachedNotifications = Object.freeze({ ...NOTIFICATIONS_DEFAULTS, ...notificationsOverrides });
  cachedAt = now;
  return { branding: cachedBranding, notifications: cachedNotifications };
}

/**
 * Version synchrone : retourne le dernier snapshot (ou les defaults si le
 * cache n'est pas encore amorcé). Utile pour les logs/diagnostics.
 */
export function readBrandingConfigSync() {
  return {
    branding: cachedBranding ?? BRANDING_DEFAULTS,
    notifications: cachedNotifications ?? NOTIFICATIONS_DEFAULTS
  };
}

/**
 * Invalide le cache. À appeler depuis une mutation admin ou les tests.
 */
export function invalidateBrandingCache() {
  cachedBranding = null;
  cachedNotifications = null;
  cachedAt = 0;
}
