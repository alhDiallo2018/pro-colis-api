// Notifications Web Push (W3C Push API) pour la PWA.
//
// Pendant web du module FCM `push.js` : meme contrat, meme pont Prisma
// (installe une seule fois dans `notificationPushBridge`), meme comportement
// silencieux quand la configuration VAPID est absente.
//
// `web-push` signe le payload avec la cle privee VAPID et parle au service
// de push de chaque navigateur (Mozilla, FCM Web, Apple). Un echec 404/410
// signifie que l'abonnement est mort cote client : on le purge, exactement
// comme un jeton FCM desenregistre.

// `web-push` est publié en CommonJS sans export `default` : on consomme donc
// les named exports directement (sinon Jest + `--experimental-vm-modules`
// échouent avec « does not provide an export named 'default' »).
import { setVapidDetails, sendNotification } from 'web-push';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';

let vapidConfigured = false;

export function configureWebPush() {
  if (vapidConfigured) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;

  try {
    setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    return true;
  } catch (error) {
    logger.warn(
      { component: 'web-push', err: error?.message },
      'Cles VAPID invalides : Web Push desactivees'
    );
    return false;
  }
}

export function isWebPushConfigured() {
  return configureWebPush();
}

export function getVapidPublicKey() {
  return env.VAPID_PUBLIC_KEY || null;
}

async function deleteDeadSubscription(id, reason) {
  try {
    await prisma.pushSubscription.deleteMany({ where: { id } });
    logger.info({ component: 'web-push', reason }, 'Abonnement Web Push purge');
  } catch {
    // Purge opportuniste : un echec sera retente au prochain envoi.
  }
}

/**
 * Envoie une notification Web Push a tous les abonnements de [userId].
 *
 * Ne leve jamais : la notification metier est deja persistee avant l'appel,
 * un service de push indisponible ne doit pas casser la requete d'origine.
 * Retourne le nombre d'abonnements reellement notifies.
 */
export async function sendWebPushToUser(userId, { title, body, data = {}, badge, priority = 'normal' } = {}) {
  if (!userId || !configureWebPush()) return 0;

  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true }
    });
    if (subscriptions.length === 0) return 0;

    const payload = JSON.stringify({
      title,
      body,
      data: { ...data, badge: typeof badge === 'number' ? badge : 0 },
      badge: typeof badge === 'number' ? badge : 0,
      priority
    });

    const options = {
      TTL: priority === 'high' || priority === 'urgent' ? 3600 : 86400,
      urgency: priority === 'high' || priority === 'urgent' ? 'high' : 'normal'
    };

    let delivered = 0;

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth }
            },
            payload,
            options
          );
          delivered += 1;
          // Ne pas attendre la mise a jour : l'horodatage est informatif,
          // pas un verrou de correctness.
          prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { lastSuccessAt: new Date(), failureCount: 0 }
          }).catch(() => {});
        } catch (error) {
          const status = error?.statusCode;
          // 404/410 : l'abonnement n'est plus valide (desinstallation PWA,
          // permission revoquee, reinstallation navigateur).
          if (status === 404 || status === 410) {
            await deleteDeadSubscription(sub.id, `http_${status}`);
          } else {
            // Erreur transitoire : on incremente le compteur pour permettre
            // une purge differee apres plusieurs echecs consecutifs.
            prisma.pushSubscription.update({
              where: { id: sub.id },
              data: { failureCount: { increment: 1 } }
            }).catch(() => {});
            logger.warn(
              { component: 'web-push', status, err: error?.message },
              'Envoi Web Push refuse'
            );
          }
        }
      })
    );

    return delivered;
  } catch (error) {
    logger.warn({ component: 'web-push', err: error?.message }, 'Envoi Web Push impossible');
    return 0;
  }
}
