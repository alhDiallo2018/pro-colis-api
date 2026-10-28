import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';

export const SUPPORT_ROLES = ['support', 'support_technique', 'support_commercial', 'super_admin'];
export const isSupportAgent = user => SUPPORT_ROLES.includes(user.role);
const person = { id: true, fullName: true, profilePhoto: true, role: true };
const include = { user: { select: person }, assignedTo: { select: person },
  messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 } };

// Verrou transactionnel partage entre les instances : deux agents ne peuvent
// pas prendre simultanement une demande, ni fausser le calcul de charge.
export function withSupportLock(operation) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78120491)`;
    return operation(tx);
  }, { timeout: 15000, maxWait: 10000 });
}

async function availableAgents(tx, now) {
  const presences = await tx.supportPresence.findMany({ where: {
    available: true, lastSeenAt: { gte: new Date(now.getTime() - env.SUPPORT_PRESENCE_TTL_SECONDS * 1000) },
    user: { role: { in: SUPPORT_ROLES }, status: 'active', deletedAt: null }
  }, include: { user: { select: person } } });
  const families = [...new Set(presences.map(row => row.familyId).filter(Boolean))];
  const sessions = families.length ? await tx.refreshToken.findMany({ where: {
    familyId: { in: families }, revokedAt: null, expiresAt: { gt: now }
  }, select: { familyId: true } }) : [];
  const liveFamilies = new Set(sessions.map(row => row.familyId));
  // Les jetons legacy n'ont pas de sid ; leur presence reste bornee par le TTL.
  return [...new Map(presences.filter(row => !row.familyId || liveFamilies.has(row.familyId))
    .map(row => [row.userId, row.user])).values()];
}

async function assign(tx, conversation, agentId, reason, now, actorId = null) {
  if (conversation.assignedToId === agentId) return;
  await tx.supportChatConversation.update({ where: { id: conversation.id }, data: {
    assignedToId: agentId, assignedAt: agentId ? now : null
  } });
  if (agentId) await tx.notification.create({ data: { userId: agentId, type: 'support_chat',
    title: 'Demande de support affectée', body: 'Une conversation vous attend dans la boîte support.',
    data: { conversationId: conversation.id, type: 'support_chat' } } });
  await tx.auditLog.create({ data: {
    actorId, action: 'support.assignment', entityType: 'support_conversation', entityId: conversation.id,
    beforeData: { assignedToId: conversation.assignedToId }, afterData: { assignedToId: agentId, reason }
  } });
}

export async function reconcileAssignments(tx, now = new Date()) {
  const agents = await availableAgents(tx, now);
  const ids = new Set(agents.map(agent => agent.id));
  const chats = await tx.supportChatConversation.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'asc' } });
  const loads = new Map(agents.map(agent => [agent.id, 0]));
  for (const chat of chats) if (ids.has(chat.assignedToId)) loads.set(chat.assignedToId, loads.get(chat.assignedToId) + 1);
  for (const chat of chats) {
    if (ids.has(chat.assignedToId)) continue;
    // Priorite a la specialite demandee ; en son absence, un autre support
    // disponible peut assurer la continuite, sans perdre la conversation.
    const eligible = agents.filter(agent => agent.id !== chat.userId);
    const preferred = eligible.filter(agent => agent.role === `support_${chat.department}`);
    const candidates = preferred.length ? preferred : eligible;
    candidates.sort((a, b) => loads.get(a.id) - loads.get(b.id) || a.id.localeCompare(b.id));
    const next = candidates[0]?.id ?? null;
    await assign(tx, chat, next, chat.assignedToId ? 'agent_unavailable' : 'queue', now);
    if (next) loads.set(next, loads.get(next) + 1);
  }
  await tx.supportPresence.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - 86400000) } } });
  return agents;
}

export async function heartbeat(user, familyId, connectionId, available) {
  return withSupportLock(async tx => {
    await tx.supportPresence.upsert({ where: { userId_connectionId: { userId: user.id, connectionId } },
      create: { userId: user.id, connectionId, familyId, available },
      update: { familyId, available, lastSeenAt: new Date() } });
    await reconcileAssignments(tx);
    return { available, expiresInSeconds: env.SUPPORT_PRESENCE_TTL_SECONDS };
  });
}

export async function releaseSupportSession(userId, familyId) {
  return withSupportLock(async tx => {
    await tx.supportPresence.deleteMany({ where: { userId, ...(familyId ? { familyId } : {}) } });
    await reconcileAssignments(tx);
  });
}

export function serializeChat(chat) {
  return { id: chat.id, userId: chat.userId, department: chat.department, status: chat.status,
    assignedTo: chat.assignedTo, assignedAt: chat.assignedAt, user: chat.user,
    lastMessage: chat.messages?.[0] ?? null, lastMessageAt: chat.lastMessageAt,
    waiting: chat.status === 'open' && !chat.assignedToId };
}

export async function openChat(actor, userId, department = 'general') {
  if (userId !== actor.id && !isSupportAgent(actor)) throw new ForbiddenError();
  return withSupportLock(async tx => {
    const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null, status: { not: 'deleted' } } });
    if (!user) throw new NotFoundError('Utilisateur introuvable');
    const existing = await tx.supportChatConversation.findUnique({ where: { userId } });
    const chat = existing?.status === 'open' ? existing : await tx.supportChatConversation.upsert({ where: { userId },
      create: { userId, department }, update: { status: 'open', department, assignedToId: null } });
    if (actor.id !== userId && !chat.assignedToId &&
        (await availableAgents(tx, new Date())).some(agent => agent.id === actor.id)) {
      await assign(tx, chat, actor.id, 'outbound_contact', new Date(), actor.id);
    }
    await reconcileAssignments(tx);
    return serializeChat(await tx.supportChatConversation.findUnique({ where: { id: chat.id }, include }));
  });
}

export async function listChats() {
  return withSupportLock(async tx => {
    await reconcileAssignments(tx);
    const chats = await tx.supportChatConversation.findMany({ include, orderBy: { lastMessageAt: 'desc' }, take: 200 });
    const unread = await tx.supportChatEntry.groupBy({ by: ['conversationId'], where: {
      conversationId: { in: chats.map(chat => chat.id) }, fromSupport: false, readAt: null, deletedAt: null
    }, _count: { _all: true } });
    const counts = new Map(unread.map(row => [row.conversationId, row._count._all]));
    return chats.map(chat => ({ ...serializeChat(chat), unreadCount: counts.get(chat.id) ?? 0 }));
  });
}

async function authorizedChat(tx, actor, id) {
  const chat = await tx.supportChatConversation.findUnique({ where: { id }, include });
  if (!chat) throw new NotFoundError('Conversation introuvable');
  if (chat.userId !== actor.id && !isSupportAgent(actor)) throw new ForbiddenError();
  return chat;
}

export async function chatThread(actor, id, ticketId) {
  return withSupportLock(async tx => {
    await reconcileAssignments(tx);
    const chat = await authorizedChat(tx, actor, id);
    // Consulter en supervision ne doit pas marquer les messages comme lus
    // a la place de l'agent affecte. Le demandeur lit les reponses du support.
    if (chat.userId === actor.id || chat.assignedToId === actor.id) {
      await tx.supportChatEntry.updateMany({ where: { conversationId: id, readAt: null,
        fromSupport: chat.userId === actor.id }, data: { readAt: new Date() } });
      await tx.notification.updateMany({ where: { userId: actor.id, type: 'support_chat',
        data: { path: ['conversationId'], equals: id }, isRead: false }, data: { isRead: true, readAt: new Date() } });
    }
    if (ticketId && !await tx.supportTicket.findFirst({ where: { id: ticketId, requesterId: chat.userId } })) throw new NotFoundError('Réclamation introuvable');
    const messages = await tx.supportChatEntry.findMany({ where: { conversationId: id, deletedAt: null, ...(ticketId ? { ticketId } : {}) },
      orderBy: { createdAt: 'asc' } });
    return { conversation: serializeChat(chat), messages: messages.map(message => ({ ...message,
      isRead: Boolean(message.readAt), senderId: message.senderId ?? '', receiverId: message.fromSupport ? chat.userId : '',
      sender: { id: message.senderId, fullName: message.senderName } })) };
  });
}

export async function listAvailableAgents() {
  return withSupportLock(async tx => {
    const agents = await availableAgents(tx, new Date());
    const loads = await tx.supportChatConversation.groupBy({ by: ['assignedToId'],
      where: { status: 'open', assignedToId: { in: agents.map(agent => agent.id) } }, _count: { _all: true } });
    const counts = new Map(loads.map(row => [row.assignedToId, row._count._all]));
    return agents.map(agent => ({ ...agent, activeCases: counts.get(agent.id) ?? 0 }))
      .sort((a, b) => a.activeCases - b.activeCases || a.fullName.localeCompare(b.fullName));
  });
}

export async function takeChat(actor, id) {
  if (!isSupportAgent(actor)) throw new ForbiddenError();
  return withSupportLock(async tx => {
    // Une prise manuelle précède la répartition automatique : autrement le
    // rééquilibrage pouvait attribuer le dossier libre à un autre agent avant
    // d'examiner le clic de celui qui souhaitait le prendre en charge.
    const agents = await availableAgents(tx, new Date());
    const chat = await authorizedChat(tx, actor, id);
    if (chat.userId === actor.id) throw new ForbiddenError('Vous ne pouvez pas traiter votre propre demande');
    if (!agents.some(agent => agent.id === actor.id)) throw new ConflictError('Passez disponible avant de prendre une demande');
    if (chat.assignedToId && chat.assignedToId !== actor.id && agents.some(agent => agent.id === chat.assignedToId)) {
      throw new ConflictError('Un autre agent traite déjà cette conversation');
    }
    if (chat.status === 'closed') await tx.supportChatConversation.update({ where: { id }, data: { status: 'open' } });
    await assign(tx, chat, actor.id, 'claimed', new Date(), actor.id);
    await reconcileAssignments(tx);
    return serializeChat(await tx.supportChatConversation.findUnique({ where: { id }, include }));
  });
}

export async function transferChat(actor, id, agentId, expectedAssignedToId) {
  if (!isSupportAgent(actor)) throw new ForbiddenError();
  return withSupportLock(async tx => {
    const chat = await authorizedChat(tx, actor, id);
    if (chat.userId === actor.id) throw new ForbiddenError('Vous ne pouvez pas affecter votre propre demande');
    if (chat.status !== 'open') throw new ConflictError('Reprenez la conversation avant de la transférer');
    // L'affectation observée par l'opérateur fait partie de la commande. Le
    // verrou et cette précondition empêchent deux transferts concurrents de
    // s'écraser, y compris lorsqu'ils proviennent du même super administrateur.
    if (chat.assignedToId !== expectedAssignedToId) {
      throw new ConflictError('L’affectation a changé. Actualisez avant de transférer.');
    }
    if (chat.assignedToId && chat.assignedToId !== actor.id && actor.role !== 'super_admin') {
      throw new ForbiddenError('Seul l’agent affecté ou le super administrateur peut transférer cette demande');
    }
    const agents = await availableAgents(tx, new Date());
    if (agentId === chat.userId || !agents.some(agent => agent.id === agentId)) {
      throw new ConflictError('Le support choisi doit être disponible et ne peut pas être le demandeur');
    }
    await assign(tx, chat, agentId, 'manual_transfer', new Date(), actor.id);
    return serializeChat(await tx.supportChatConversation.findUnique({ where: { id }, include }));
  });
}

export async function sendChatMessage(actor, id, payload) {
  return withSupportLock(async tx => {
    await reconcileAssignments(tx);
    let chat = await authorizedChat(tx, actor, id);
    const fromSupport = actor.id !== chat.userId;
    if (fromSupport && chat.assignedToId !== actor.id) throw new ConflictError('La conversation a été réaffectée. Actualisez avant de répondre.');
    if (chat.status === 'closed') {
      if (fromSupport) throw new ConflictError('Reprenez la conversation avant de répondre');
      await tx.supportChatConversation.update({ where: { id }, data: { status: 'open', assignedToId: null } });
      await reconcileAssignments(tx);
      chat = await tx.supportChatConversation.findUnique({ where: { id }, include });
    }
    if (payload.ticketId && !await tx.supportTicket.findFirst({ where: { id: payload.ticketId, requesterId: chat.userId } })) throw new NotFoundError('Réclamation introuvable');
    const entry = await tx.supportChatEntry.create({ data: { conversationId: id, senderId: actor.id,
      senderName: actor.fullName, fromSupport, ...payload } });
    await tx.supportChatConversation.update({ where: { id }, data: { lastMessageAt: entry.createdAt } });
    const recipientId = fromSupport ? chat.userId : chat.assignedToId;
    if (recipientId) await tx.notification.create({ data: { userId: recipientId, senderId: actor.id,
      senderName: actor.fullName, type: 'support_chat', title: fromSupport ? 'Réponse du support' : 'Demande de support',
      body: payload.body || 'Nouveau média', data: { conversationId: id, type: 'support_chat' } } });
    return { ...entry, isRead: false, receiverId: recipientId ?? '' };
  });
}

export async function closeChat(actor, id) {
  return withSupportLock(async tx => {
    const chat = await authorizedChat(tx, actor, id);
    if (chat.assignedToId !== actor.id && actor.role !== 'super_admin') throw new ForbiddenError('Seul l’agent affecté peut clôturer');
    await tx.supportChatConversation.update({ where: { id }, data: { status: 'closed', assignedToId: null, assignedAt: null } });
    await tx.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'support.close',
      entityType: 'support_conversation', entityId: id } });
    return { closed: true };
  });
}

export function startSupportReassignmentWorker() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await withSupportLock(tx => reconcileAssignments(tx)); }
    catch (error) { logger.error({ err: error, action: 'support.reassign' }, 'Reaffectation support impossible'); }
    finally { running = false; }
  }, 15000);
  timer.unref();
  return () => clearInterval(timer);
}

// Même verrou que l'affectation du support : création atomique du ticket et
// de son premier message dans la transaction appelante.
export async function attachComplaint(tx, actor, ticket, photos) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78120491)`;
  let chat = await tx.supportChatConversation.findUnique({ where: { userId: actor.id } });
  if (!chat) chat = await tx.supportChatConversation.create({ data: { userId: actor.id, department: 'technique' } });
  else if (chat.status === 'closed') chat = await tx.supportChatConversation.update({ where: { id: chat.id }, data: { status: 'open', assignedToId: null, department: 'technique' } });
  await tx.supportChatEntry.create({ data: { conversationId: chat.id, ticketId: ticket.id, senderId: actor.id, senderName: actor.fullName,
    fromSupport: false, body: `${ticket.reference} · ${ticket.subject}\n${ticket.body?.split('\n\nPhotos :')[0] ?? ''}`, photoUrl: photos[0] ?? null } });
  for (const photoUrl of photos.slice(1)) await tx.supportChatEntry.create({ data: { conversationId: chat.id, ticketId: ticket.id,
    senderId: actor.id, senderName: actor.fullName, fromSupport: false, body: ticket.reference, photoUrl } });
  await tx.supportChatConversation.update({ where: { id: chat.id }, data: { lastMessageAt: new Date() } });
  await reconcileAssignments(tx);
  return chat.id;
}
