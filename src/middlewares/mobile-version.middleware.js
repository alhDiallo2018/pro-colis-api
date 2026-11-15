import { env } from '../config/env.js';

// Routes qui doivent rester accessibles même à un client obsolète : sinon la
// bannière de mise à jour ne peut plus charger sa politique et l'utilisateur
// se retrouve coincé sans message clair.
const ALLOWLIST_PREFIXES = [
  '/public/mobile-update',
  '/public/app-update',
  '/api/v1/public/mobile-update',
  '/api/v1/public/app-update',
  '/health',
  '/api/v1/health',
  '/auth/',
  '/api/v1/auth/',
  '/webhooks/',
  '/api/v1/webhooks/'
];

function isAllowlisted(originalUrl) {
  if (!originalUrl) return false;
  const path = originalUrl.split('?')[0];
  return ALLOWLIST_PREFIXES.some(prefix => path === prefix.replace(/\/$/, '') || path.startsWith(prefix));
}

// Les clients mobiles s'identifient via `X-App-Platform`. Sans cet en-tête (web,
// cURL, anciens APK non instrumentés), aucune règle n'est appliquée : la gate
// côté app reste la première ligne de défense.
export function mobileVersionMiddleware(req, res, next) {
  if (!env.MOBILE_ANDROID_UPDATE_ENABLED) return next();
  const platform = String(req.get('X-App-Platform') || '').toLowerCase();
  if (platform !== 'android') return next();
  if (isAllowlisted(req.originalUrl)) return next();

  const rawBuild = req.get('X-App-Build');
  const build = Number.parseInt(rawBuild, 10);
  if (!Number.isFinite(build) || build < 0) return next();

  if (build < env.MOBILE_ANDROID_MIN_VERSION_CODE) {
    return res.status(426).json({
      success: false,
      code: 'UPDATE_REQUIRED',
      message: 'Une mise à jour de l\'application est obligatoire pour continuer.',
      minVersionCode: env.MOBILE_ANDROID_MIN_VERSION_CODE,
      latestVersionCode: env.MOBILE_ANDROID_LATEST_VERSION_CODE,
      updateUrl: env.MOBILE_ANDROID_UPDATE_URL
    });
  }

  return next();
}
