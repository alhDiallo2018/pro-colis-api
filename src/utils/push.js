// Notifications push (Firebase Cloud Messaging, API HTTP v1).
//
// Le mobile enregistre son jeton d'appareil via POST /notifications/device-token
// et sait deja afficher une notification et poser un badge : ce module est la
// moitie serveur qui manquait, celle qui pousse reellement le message.
//
// L'authentification passe par un compte de service Google. Plutot que d'ajouter
// `firebase-admin` (et ses dizaines de dependances) pour un seul appel REST, le
// jeton d'acces est obtenu en signant un JWT avec `jsonwebtoken`, deja present.
//
// Sans compte de service configure, tout ce module est un no-op silencieux :
// l'API continue de fonctionner, seules les push sont desactivees (meme
// contrat que Brevo pour l'email/SMS).

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';

const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_ENDPOINT = (projectId) =>
  `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

/** Marge avant expiration du jeton d'acces : evite un envoi refuse a la seconde pres. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Delai avant l'envoi reel. Une notification est presque toujours creee dans une
 * transaction : pousser immediatement enverrait un message pour une action
 * finalement annulee par un rollback. On attend le commit, puis on relit la
 * ligne avant d'envoyer.
 */
const COMMIT_GRACE_MS = 200;

let serviceAccount;
let accessToken = null;
let accessTokenExpiresAt = 0;
let pendingTokenRequest = null;
let bridgeAttached = false;

function loadServiceAccount() {
  if (serviceAccount !== undefined) return serviceAccount;

  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const path = env.FIREBASE_SERVICE_ACCOUNT_PATH;

  try {
    if (inline) {
      // En conteneur le fichier n'est pas toujours montable : le JSON complet
      // peut alors etre injecte tel quel dans la variable d'environnement.
      serviceAccount = JSON.parse(inline);
    } else if (path) {
      const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
      serviceAccount = JSON.parse(readFileSync(absolute, 'utf8'));
    } else {
      serviceAccount = null;
    }
  } catch (error) {
    logger.warn(
      { component: 'push', err: error?.message },
      'Compte de service Firebase illisible : push desactivees'
    );
    serviceAccount = null;
  }

  if (serviceAccount && (!serviceAccount.client_email || !serviceAccount.private_key)) {
    logger.warn(
      { component: 'push' },
      'Compte de service Firebase incomplet (client_email / private_key) : push desactivees'
    );
    serviceAccount = null;
  }

  return serviceAccount;
}

function projectId() {
  return env.FIREBASE_PROJECT_ID || loadServiceAccount()?.project_id || null;
}

export function isPushConfigured() {
  return Boolean(loadServiceAccount() && projectId());
}

/** Reinitialise le cache : utile aux tests et apres rotation des identifiants. */
export function resetPushCache() {
  serviceAccount = undefined;
  accessToken = null;
  accessTokenExpiresAt = 0;
  pendingTokenRequest = null;
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    return { status: response.status, ok: response.ok, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAccessToken() {
  const account = loadServiceAccount();
  if (!account) return null;

  const issuedAt = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: account.token_uri || OAUTH_TOKEN_ENDPOINT,
      iat: issuedAt,
      exp: issuedAt + 3600
    },
    account.private_key,
    { algorithm: 'RS256' }
  );

  const { ok, status, body } = await fetchJson(account.token_uri || OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    }).toString()
  });

  if (!ok || !body?.access_token) {
    logger.warn({ component: 'push', status }, 'Jeton d\'acces FCM refuse');
    return null;
  }

  accessToken = body.access_token;
  accessTokenExpiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
  return accessToken;
}

async function getAccessToken({ force = false } = {}) {
  if (!force && accessToken && Date.now() < accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return accessToken;
  }
  // Une rafale de notifications ne doit declencher qu'un seul echange OAuth.
  pendingTokenRequest ??= requestAccessToken().finally(() => {
    pendingTokenRequest = null;
  });
  return pendingTokenRequest;
}

/**
 * FCM v1 n'accepte que des chaines dans `data`. Les valeurs nulles sont
 * retirees : une cle a "null" cote mobile serait interpretee comme un
 * identifiant valide.
 */
function stringifyData(data) {
  const result = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === null || value === undefined) continue;
    result[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return result;
}

/**
 * Nombre d'elements non lus, badge de l'icone comprise. Notifications et
 * messages sont comptes ensemble : pour l'utilisateur, "3" doit designer trois
 * choses a regarder, pas trois lignes d'une table precise.
 */
export async function countUnreadForUser(userId) {
  const [notifications, messages] = await Promise.all([
    prisma.notification.count({ where: { userId, isRead: false } }),
    prisma.message.count({ where: { receiverId: userId, isRead: false, deletedAt: null } })
  ]);
  return { notifications, messages, total: notifications + messages };
}

export function buildFcmMessage({ token, title, body, data, badge, priority }) {
  const highPriority = priority === 'high' || priority === 'urgent';
  return {
    message: {
      token,
      notification: { title, body },
      data: stringifyData({ ...data, badge: String(badge ?? 0) }),
      android: {
        priority: highPriority ? 'HIGH' : 'NORMAL',
        notification: {
          channel_id: 'sendprocolis_channel',
          // Les launchers qui gerent les badges numeriques lisent ce champ ;
          // les autres l'ignorent sans erreur.
          notification_count: badge ?? 0,
          default_sound: true
        }
      },
      apns: {
        headers: { 'apns-priority': highPriority ? '10' : '5' },
        payload: {
          aps: {
            alert: { title, body },
            sound: 'default',
            // iOS pose le badge lui-meme, meme application fermee.
            badge: badge ?? 0,
            'content-available': 1
          }
        }
      }
    }
  };
}

async function deleteDeadToken(token, reason) {
  try {
    await prisma.deviceToken.deleteMany({ where: { token } });
    logger.info({ component: 'push', reason }, 'Jeton d\'appareil purge');
  } catch {
    // La purge est opportuniste : un echec sera retente au prochain envoi.
  }
}

/**
 * Envoie une push a tous les appareils de [userId].
 *
 * Ne leve jamais : une notification metier ne doit pas echouer parce que FCM
 * est indisponible. Retourne le nombre d'appareils atteints.
 */
export async function sendPushToUser(userId, { title, body, data = {}, priority = 'normal' } = {}) {
  if (!userId || !isPushConfigured()) return 0;

  try {
    const tokens = await prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true }
    });
    if (tokens.length === 0) return 0;

    const badge = (await countUnreadForUser(userId)).total;
    let accessTokenValue = await getAccessToken();
    if (!accessTokenValue) return 0;

    const url = FCM_ENDPOINT(projectId());
    let delivered = 0;

    for (const { token } of tokens) {
      const payload = buildFcmMessage({ token, title, body, data, badge, priority });
      let response = await fetchJson(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessTokenValue}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      // Jeton d'acces expire cote Google : on le renouvelle une fois et on
      // rejoue l'envoi, sinon toute la rafale serait perdue.
      if (response.status === 401) {
        accessTokenValue = await getAccessToken({ force: true });
        if (!accessTokenValue) return delivered;
        response = await fetchJson(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessTokenValue}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
      }

      if (response.ok) {
        delivered += 1;
        continue;
      }

      const errorStatus = response.body?.error?.status;
      const desinstalled =
        response.status === 404 ||
        errorStatus === 'NOT_FOUND' ||
        errorStatus === 'UNREGISTERED' ||
        (response.status === 400 && errorStatus === 'INVALID_ARGUMENT');

      if (desinstalled) {
        // Application desinstallee ou jeton remplace : le garder ferait echouer
        // chaque envoi suivant.
        await deleteDeadToken(token, errorStatus ?? `http_${response.status}`);
      } else {
        logger.warn(
          { component: 'push', status: response.status, error: errorStatus },
          'Envoi push refuse'
        );
      }
    }

    return delivered;
  } catch (error) {
    logger.warn({ component: 'push', err: error?.message }, 'Envoi push impossible');
    return 0;
  }
}

/**
 * Pousse la notification [notificationId] si elle existe encore.
 *
 * La relecture confirme que la transaction d'origine a bien ete commitee : sans
 * elle, une action annulee (rollback) declencherait quand meme une push.
 */
async function pushCreatedNotification(notificationId) {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: {
        userId: true,
        type: true,
        title: true,
        body: true,
        data: true,
        parcelId: true,
        bidId: true,
        priority: true
      }
    });
    if (!notification) return;

    const extra =
      notification.data && typeof notification.data === 'object' && !Array.isArray(notification.data)
        ? notification.data
        : {};

    await sendPushToUser(notification.userId, {
      title: notification.title,
      body: notification.body,
      priority: notification.priority,
      data: {
        ...extra,
        notificationId,
        type: notification.type,
        parcelId: notification.parcelId,
        bidId: notification.bidId
      }
    });
  } catch (error) {
    logger.warn({ component: 'push', err: error?.message }, 'Push de notification impossible');
  }
}

/**
 * Branche l'envoi de push sur la creation de notifications.
 *
 * Les notifications naissent dans une trentaine d'endroits (offre recue, colis
 * accepte, paiement, message...). Un middleware Prisma les couvre toutes d'un
 * coup, la ou un appel explicite par site serait oublie au premier ajout.
 *
 * `$use` est deprecie au profit des extensions client, mais reste le seul
 * mecanisme qui intercepte aussi les ecritures faites via un client de
 * transaction (`tx.notification.create`), forme majoritaire ici.
 */
export function attachNotificationPushBridge() {
  if (bridgeAttached) return;
  bridgeAttached = true;

  prisma.$use(async (params, next) => {
    const result = await next(params);

    if (params.model !== 'Notification' || params.action !== 'create') return result;

    const notificationId = result?.id;
    if (!notificationId) return result;

    // Detache : l'appelant ne doit ni attendre le reseau, ni echouer avec lui.
    setTimeout(() => {
      void pushCreatedNotification(notificationId);
    }, COMMIT_GRACE_MS).unref?.();

    return result;
  });

  logger.info(
    { component: 'push', configured: isPushConfigured() },
    'Pont notifications -> push installe'
  );
}
