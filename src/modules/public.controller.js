/**
 * Endpoints publics "chrome" : fichiers consommés directement par le navigateur
 * pour l'install PWA (manifest.webmanifest). Pas d'auth, pas de dépendances
 * mobiles : ce controller reste volontairement minuscule pour pouvoir être
 * monté avant n'importe quel middleware d'authentification.
 */

import { readBrandingConfig } from '../utils/branding-config.js';
import { logger } from '../config/logger.js';

/**
 * GET /manifest.webmanifest
 *
 * Retourne un manifest Web App construit dynamiquement depuis SystemConfig
 * (`branding.*`). Permet à l'admin de changer le nom, le theme color et le
 * logo sans redéploiement : il suffit de recharger la PWA pour que Chrome
 * récupère la nouvelle version (prochain `beforeinstallprompt` ou ré-install).
 *
 * Headers :
 *  - `Content-Type: application/manifest+json` (standard W3C)
 *  - `Cache-Control: public, max-age=300` (5 min : équilibre entre réactivité
 *    admin et charge serveur ; le cache in-memory 60 s reste prédominant).
 *
 * Fallback de sécurité : `public/manifest.webmanifest` statique sert si le
 * endpoint est injoignable (reverse proxy down, migration DB en cours).
 */
export async function getManifest(_req, res) {
  let branding;
  try {
    ({ branding } = await readBrandingConfig());
  } catch (error) {
    logger?.warn?.({ error }, '[manifest] Lecture branding impossible, fallback defaults');
    // Fallback inline : un manifest absent casse l'installation PWA, on
    // préfère exposer des defaults codés dur plutôt qu'une 500.
    branding = {
      appName: 'ProColis',
      shortName: 'ProColis',
      themeColor: '#018982',
      backgroundColor: '#FFFFFF',
      iconUrl: '/icons/icon-192.png'
    };
  }

  // Icônes : on garde la triplette 192/512/maskable servie par le web
  // (`public/icons/*`). `iconUrl` configurable sert aussi aux notifications :
  // on ne l'injecte pas ici pour ne pas casser l'install si l'admin pointe
  // vers une URL distante non-PNG.
  const manifest = {
    name: branding.appName,
    short_name: branding.shortName,
    description: 'Envoyez et suivez vos colis interurbains au Sénégal.',
    lang: 'fr',
    id: '/',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    theme_color: branding.themeColor,
    background_color: branding.backgroundColor,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    share_target: {
      action: '/track',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' }
    }
  };

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).send(JSON.stringify(manifest));
}
