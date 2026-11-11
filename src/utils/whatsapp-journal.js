/**
 * Journalisation des envois WhatsApp pour alimenter les métriques pilote
 * et préparer la réception du callback Meta.
 *
 * Deux responsabilités :
 *  - `recordWhatsAppSend(result, ctx)` : persiste chaque envoi après appel
 *    à l'API Meta, avec le `messageId` renvoyé pour que le callback puisse
 *    plus tard transitionner la ligne vers `delivered` / `read`.
 *  - `applyWhatsAppCallback(payload)` : digère un webhook Meta
 *    (`statuses[].{id, status}`) et met à jour les lignes correspondantes.
 *  - `countWhatsAppStatuses(since)` : compteurs pour le dashboard pilote.
 *
 * Jamais d'exception vers le caller : la métrique ne doit pas casser
 * l'envoi.
 */

import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';

/**
 * Tente d'extraire l'ID de message retourné par l'API Meta Cloud. Le
 * payload a la forme :
 *   { messages: [{ id: 'wamid.XXXX' }] }
 */
function extractMetaMessageId(apiResult) {
  if (!apiResult || typeof apiResult !== 'object') return null;
  const messages = apiResult.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const id = messages[0]?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * À appeler juste après `sendWhatsAppTemplate` (ou helpers métier) pour
 * persister l'envoi. `result` peut être `null` (envoi ignoré) : on ne
 * persiste alors rien.
 */
export async function recordWhatsAppSend(result, {
  phone,
  templateName,
  parcelId = null
} = {}) {
  if (!result) return null;
  const messageId = extractMetaMessageId(result);
  try {
    return await prisma.whatsAppDispatch.create({
      data: {
        messageId,
        phone,
        templateName,
        parcelId,
        status: 'sent'
      }
    });
  } catch (error) {
    logger.warn(
      {
        component: 'whatsapp-journal',
        templateName,
        error: error.message
      },
      'Journalisation envoi WhatsApp impossible'
    );
    return null;
  }
}

/**
 * Enregistre un envoi échoué (Meta a répondu en erreur, ou pas configuré).
 * Utile pour tracer les tentatives malgré l'absence de message_id.
 */
export async function recordWhatsAppFailure({
  phone,
  templateName,
  parcelId = null,
  reason = 'unknown'
} = {}) {
  try {
    return await prisma.whatsAppDispatch.create({
      data: {
        phone,
        templateName,
        parcelId,
        status: 'failed',
        failedAt: new Date(),
        errorReason: reason
      }
    });
  } catch (error) {
    logger.warn(
      { component: 'whatsapp-journal', error: error.message },
      'Journalisation échec WhatsApp impossible'
    );
    return null;
  }
}

/**
 * Transition d'état depuis un callback Meta. Le payload attendu suit la
 * structure webhook officielle :
 *   { entry: [{ changes: [{ value: { statuses: [{ id, status }] } }] }] }
 *
 * `status` ∈ { sent, delivered, read, failed }. On applique l'état le plus
 * avancé reçu (`read` > `delivered` > `sent`).
 *
 * @returns {Promise<{updated: number}>}
 */
export async function applyWhatsAppCallback(payload) {
  const statuses = extractStatusesFromMetaPayload(payload);
  if (statuses.length === 0) return { updated: 0 };

  let updated = 0;
  for (const { id, status } of statuses) {
    if (!id || typeof status !== 'string') continue;
    const data = {};
    if (status === 'delivered') data.deliveredAt = new Date();
    if (status === 'read') data.readAt = new Date();
    if (status === 'failed') {
      data.failedAt = new Date();
      data.status = 'failed';
    } else {
      data.status = status;
    }
    try {
      const res = await prisma.whatsAppDispatch.updateMany({
        where: { messageId: id },
        data
      });
      if (res.count > 0) updated += res.count;
    } catch (error) {
      logger.warn(
        {
          component: 'whatsapp-journal',
          messageId: id,
          status,
          error: error.message
        },
        'Transition callback WhatsApp impossible'
      );
    }
  }
  return { updated };
}

function extractStatusesFromMetaPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const out = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const raws = change?.value?.statuses;
      if (!Array.isArray(raws)) continue;
      for (const raw of raws) {
        if (!raw) continue;
        out.push({ id: raw.id, status: raw.status });
      }
    }
  }
  return out;
}

/**
 * Compteurs pour `getPilotMetrics`. Fenêtre optionnelle `since` (sinon
 * cumul depuis l'origine).
 */
export async function countWhatsAppStatuses(since) {
  const buckets = { sent: 0, delivered: 0, read: 0 };
  try {
    const whereClause = since ? { sentAt: { gte: since } } : undefined;
    // `sent` = tous les envois acceptés par Meta, inclut ceux qui ont
    // ensuite transitionné vers delivered/read.
    buckets.sent = await prisma.whatsAppDispatch.count({
      where: {
        ...(whereClause ?? {}),
        status: { in: ['sent', 'delivered', 'read'] }
      }
    });
    buckets.delivered = await prisma.whatsAppDispatch.count({
      where: {
        ...(whereClause ?? {}),
        deliveredAt: { not: null }
      }
    });
    buckets.read = await prisma.whatsAppDispatch.count({
      where: {
        ...(whereClause ?? {}),
        readAt: { not: null }
      }
    });
  } catch (error) {
    logger.warn(
      { component: 'whatsapp-journal', error: error.message },
      'Compte WhatsApp dispatches impossible'
    );
  }
  return buckets;
}
