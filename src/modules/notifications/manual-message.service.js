import { createHash } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { withSupportLock, reconcileAssignments } from '../support/chat.service.js';
import { recipientScope } from './recipient-scope.js';
import { ConflictError } from '../../utils/errors.js';
import { sendEmail, sendSms } from '../../utils/brevo.js';

export function escapeMessageHtml(text) {
  return text.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]).replace(/\r?\n/g, '<br>');
}

function outcome(row) {
  // Apres une interruption, un envoi peut avoir atteint le prestataire sans
  // que sa reponse ait ete sauvegardee. Ne jamais le renvoyer automatiquement.
  const stale = row.status === 'processing' && Date.now() - row.createdAt.getTime() > 120000;
  return { requestId: row.id, userId: row.userId, channel: row.channel,
    status: stale ? 'unknown' : row.status, ...row.result,
    ...(stale ? { message: 'Résultat non confirmé. Vérifiez avant de créer un nouvel envoi.' } : {}) };
}

export async function getManualMessage(actorId, requestId) {
  const row = await prisma.manualMessageDispatch.findFirst({ where: { id: requestId, actorId } });
  return row ? outcome(row) : null;
}

/** Un appel par utilisateur/canal ; le web limite les envois concurrents.
 * Les coordonnées proviennent toujours du compte en BD, jamais du navigateur.
 * L'injection des transporteurs permet de tester sans aucun envoi réel.
 */
export async function dispatchManualMessage(actor, payload, log, transports = { sendEmail, sendSms }) {
  const { requestId, userId, channel, subject, kind = 'message' } = payload;
  let { content } = payload;
  const scope = recipientScope(actor);
  const contentHash = createHash('sha256').update(JSON.stringify({ userId, channel, subject, content, ...(kind === 'message' ? {} : { kind }) })).digest('hex');
  let row;
  try {
    row = await prisma.manualMessageDispatch.create({ data: {
      id: requestId, actorId: actor.id, userId, channel, contentHash
    } });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const previous = await prisma.manualMessageDispatch.findUnique({ where: { id: requestId } });
    if (!previous || previous.actorId !== actor.id || previous.contentHash !== contentHash) {
      throw new ConflictError('Cette référence correspond à un autre envoi');
    }
    return outcome(previous);
  }

  const finish = async (status, message, messageId = null) => {
    const updated = await prisma.manualMessageDispatch.update({ where: { id: requestId },
      data: { status, result: { message, messageId } } });
    log.info({ action: 'notifications.manualSend', requestId, actorId: actor.id, userId, channel, status },
      'Envoi manuel traité');
    return outcome(updated);
  };

  try {
    const user = await prisma.user.findFirst({
      where: { AND: [scope, { id: userId, deletedAt: null, status: { not: 'deleted' } }] },
      select: { id: true, fullName: true, email: true, phone: true, role: true, city: true, status: true }
    });
    if (!user) return await finish('skipped', 'Compte introuvable ou hors de votre périmètre');
    if (channel === 'email' && !user.email) return await finish('skipped', 'Aucune adresse e-mail sur ce compte');
    if (channel === 'sms' && !user.phone) return await finish('skipped', 'Aucun téléphone sur ce compte');

    // La fiche est calculée en BD pour CE destinataire. Aucun PIN, mot de
    // passe, document d'identité ou renseignement d'un autre compte n'y figure.
    if (kind === 'account_summary') content = accountSummary(user);

    if (channel === 'chat') {
      if (actor.id === userId) return await finish('skipped', 'Choisissez un autre compte pour le chat');
      // Message, notification et reçu sont atomiques sous le même verrou que
      // les affectations support. Une diffusion ne vole pas une conversation
      // à l'agent qui l'assiste déjà ; les réponses suivent le circuit habituel.
      const result = await withSupportLock(async tx => {
        const existing = await tx.supportChatConversation.findUnique({ where: { userId } });
        const conversation = existing?.status === 'open' ? existing : await tx.supportChatConversation.upsert({
          where: { userId }, create: { userId, department: 'general' },
          update: { status: 'open', assignedToId: null, assignedAt: null }
        });
        const message = await tx.supportChatEntry.create({ data: {
          conversationId: conversation.id, senderId: actor.id, senderName: actor.fullName,
          fromSupport: true, body: `${subject}\n\n${content}`
        } });
        await tx.supportChatConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } });
        await tx.notification.create({ data: { userId, senderId: actor.id, senderName: actor.fullName,
          type: 'support_chat', title: subject, body: content,
          data: { conversationId: conversation.id, type: 'support_chat', manualDispatchId: requestId } } });
        await reconcileAssignments(tx);
        return tx.manualMessageDispatch.update({ where: { id: requestId }, data: {
          status: 'sent', result: { message: 'Message ajouté dans le chat privé', messageId: message.id }
        } });
      });
      log.info({ action: 'notifications.manualSend', requestId, actorId: actor.id, userId, channel, status: 'sent' }, 'Message chat diffusé');
      return outcome(result);
    }

    if (channel === 'in_app') {
      // Notification et reçu atomiques : un rollback ne laisse pas une
      // notification créée dont le journal annoncerait un échec.
      const result = await prisma.$transaction(async tx => {
        const notification = await tx.notification.create({ data: {
          userId, senderId: actor.id, senderName: actor.fullName,
          type: 'announcement', title: subject, body: content,
          data: { manualDispatchId: requestId }
        } });
        return tx.manualMessageDispatch.update({ where: { id: requestId }, data: {
          status: 'sent', result: { message: 'Notification ajoutée dans l’application', messageId: notification.id }
        } });
      });
      log.info({ action: 'notifications.manualSend', requestId, actorId: actor.id, userId, channel, status: 'sent' },
        'Notification manuelle créée');
      return outcome(result);
    }

    const result = channel === 'email'
      ? await transports.sendEmail({ to: user.email, subject, textContent: content,
        htmlContent: `<p>${escapeMessageHtml(content)}</p>` })
      : await transports.sendSms({ to: user.phone, content, tag: 'manual-admin' });
    // « accepté » signifie accepté par Brevo, pas livré/lu sur l'appareil.
    if (result) return await finish('sent', 'Accepté par le prestataire', String(result.messageId ?? result.reference ?? ''));
    return await finish('unknown', 'Envoi non confirmé par le prestataire. Vérifiez sa configuration et son historique avant de relancer.');
  } catch (error) {
    log.error({ err: error, action: 'notifications.manualSend', requestId, userId, channel }, 'Échec de traitement de l’envoi manuel');
    // Si le prestataire a déjà reçu le message, annoncer un échec certain
    // encouragerait un doublon. La référence reste consultable et idempotente.
    return await finish('unknown', 'Résultat non confirmé. Vérifiez avant de créer un nouvel envoi.');
  }
}

export function accountSummary(user) {
  const roles = { client: 'Client', driver: 'Chauffeur', admin: 'Admin zone', super_admin: 'Super admin',
    support: 'Support', support_technique: 'Support technique', support_commercial: 'Support commercial' };
  return [`Bonjour ${user.fullName},`, 'Voici les informations de votre compte ProColis :',
    `Nom : ${user.fullName}`, `E-mail : ${user.email || 'Non renseigné'}`, `Téléphone : ${user.phone}`,
    `Profil : ${roles[user.role] || user.role}`, `Ville : ${user.city || 'Non renseignée'}`,
    `Statut : ${user.status === 'active' ? 'Actif' : 'Suspendu'}`].join('\n');
}
