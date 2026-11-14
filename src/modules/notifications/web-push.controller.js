// Abonnements Web Push (PWA).
//
// Pendant web du `registerDeviceToken` FCM : la PWA pousse son PushSubscription
// via le Service Worker, l'API le persiste et le reutilisera au prochain envoi
// (voir `utils/web-push.js`).
//
// Les cles `p256dh` et `auth` sont celles generees par le navigateur pour
// chiffrer le payload : ce ne sont pas des secrets au sens strict (elles sont
// aussi stockees cote navigateur) mais elles restent comparables a un jeton
// d'appareil — on ne les expose jamais en lecture.

import { z } from 'zod';

import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { ok, fail } from '../../utils/api-response.js';
import { ValidationError, normalizeError } from '../../utils/errors.js';
import { getVapidPublicKey, isWebPushConfigured } from '../../utils/web-push.js';

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512)
  }),
  expirationTime: z.union([z.number().int().nonnegative(), z.null()]).optional()
});

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log?.error(
        {
          errorType: error.name,
          errorCode: normalized?.code || 'INTERNAL_ERROR',
          action,
          userId: req.user?.id,
          requestId: req.requestId
        },
        `Web Push endpoint failed: ${action}`
      );
      return fail(res, {
        status: normalized?.statusCode || 500,
        message:
          normalized?.publicMessage ||
          (env.NODE_ENV === 'production' ? 'Operation impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || []
      });
    }
  };
}

// La clef publique n'est jamais secrete — le client en a besoin pour appeler
// `PushManager.subscribe`. L'exposer via l'API evite de dupliquer la valeur
// dans le bundle front : rotation = un seul endroit a mettre a jour.
export const getPublicKey = handle('webPush.publicKey', async (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    return fail(res, {
      status: 503,
      message: 'Web Push non configure',
      code: 'WEB_PUSH_NOT_CONFIGURED'
    });
  }
  return ok(res, { data: { publicKey: key } });
});

export const subscribe = handle('webPush.subscribe', async (req, res) => {
  if (!isWebPushConfigured()) {
    return fail(res, {
      status: 503,
      message: 'Web Push non configure',
      code: 'WEB_PUSH_NOT_CONFIGURED'
    });
  }

  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    );
  }

  const { endpoint, keys, expirationTime } = parsed.data;
  const userAgent = req.get('user-agent')?.slice(0, 500) || null;
  const expirationDate =
    typeof expirationTime === 'number' && expirationTime > 0 ? new Date(expirationTime) : null;

  // Upsert sur l'endpoint : un meme navigateur qui reprend son abonnement
  // doit ecraser l'ancien, pas creer un doublon. Si l'endpoint existait chez
  // un autre utilisateur (compte partage sur un poste), on le reattribue.
  const subscription = await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: {
      userId: req.user.id,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
      expirationTime: expirationDate,
      failureCount: 0
    },
    create: {
      userId: req.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
      expirationTime: expirationDate
    }
  });

  return ok(res, {
    status: 201,
    message: 'Abonnement Web Push enregistre',
    data: {
      subscription: {
        id: subscription.id,
        createdAt: subscription.createdAt.toISOString(),
        updatedAt: subscription.updatedAt.toISOString()
      }
    }
  });
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048)
});

export const unsubscribe = handle('webPush.unsubscribe', async (req, res) => {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    );
  }

  // Deconnexion volontaire : on ne garde pas l'abonnement d'un autre user.
  // La condition composee evite qu'un attaquant ne purge l'abonnement d'un
  // tiers en connaissant son endpoint.
  const result = await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: req.user.id }
  });

  return ok(res, {
    message: 'Abonnement Web Push supprime',
    data: { removed: result.count }
  });
});
