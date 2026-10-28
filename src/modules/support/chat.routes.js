import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import { ok, fail } from '../../utils/api-response.js';
import { ValidationError, normalizeError } from '../../utils/errors.js';
import * as chat from './chat.service.js';
import { prisma } from '../../config/prisma.js';
import { userSearchWhere } from '../../utils/user-search.js';

export const supportChatRouter = Router();
supportChatRouter.use(authenticate);
const staff = requireRoles(...chat.SUPPORT_ROLES);
const parse = (schema, value) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
  return parsed.data;
};
const id = req => parse(z.string().uuid(), req.params.id);
const body = z.object({ ticketId: z.string().uuid().optional(), body: z.string().trim().max(5000).default(''),
  audioUrl: z.string().max(2000).optional(), photoUrl: z.string().max(2000).optional(), videoUrl: z.string().max(2000).optional()
}).refine(value => value.body || value.audioUrl || value.photoUrl || value.videoUrl, 'Message vide');

// Toutes les actions BD passent par ce garde : erreur publique normalisee,
// contexte de requete journalise, jamais le contenu prive de la conversation.
const handle = (action, operation) => async (req, res) => {
  try { res.set('Cache-Control', 'private, no-store'); return ok(res, { data: await operation(req) }); }
  catch (error) {
    const normalized = normalizeError(error);
    req.log.error({ err: error, action, userId: req.user?.id, requestId: req.requestId }, 'Support chat failed');
    return fail(res, { status: normalized?.statusCode || 500, code: normalized?.code || 'INTERNAL_ERROR',
      message: normalized?.publicMessage || 'Support temporairement indisponible', details: normalized?.details || [] });
  }
};

supportChatRouter.post('/presence', staff, handle('support.presence', async req => {
  const value = parse(z.object({ connectionId: z.string().uuid(), available: z.boolean() }), req.body);
  return { presence: await chat.heartbeat(req.user, req.sessionFamilyId ?? null, value.connectionId, value.available) };
}));
supportChatRouter.get('/agents', staff, handle('support.agents', async () => ({ agents: await chat.listAvailableAgents() })));
supportChatRouter.get('/users', staff, handle('support.users', async req => ({ users: await prisma.user.findMany({
  where: { deletedAt: null, status: { not: 'deleted' }, ...userSearchWhere(req.query.search) },
  select: { id: true, fullName: true, role: true, email: true, phone: true }, orderBy: { fullName: 'asc' }, take: 25
}) })));
// Consulter son historique ne rouvre pas une demande cloturee.
supportChatRouter.get('/mine', handle('support.mine', async req => {
  const conversation = await prisma.supportChatConversation.findUnique({ where: { userId: req.user.id } });
  return { conversation: conversation ? (await chat.chatThread(req.user, conversation.id)).conversation : null };
}));
supportChatRouter.post('/conversations', handle('support.open', async req => {
  const value = parse(z.object({ userId: z.string().uuid().optional(),
    department: z.enum(['general', 'technique', 'commercial']).default('general') }), req.body);
  return { conversation: await chat.openChat(req.user, value.userId ?? req.user.id, value.department) };
}));
supportChatRouter.get('/conversations', staff, handle('support.queue', async () => ({ conversations: await chat.listChats() })));
supportChatRouter.get('/conversations/:id', handle('support.thread', req => chat.chatThread(req.user, id(req), req.query.ticketId ? parse(z.string().uuid(), req.query.ticketId) : undefined)));
supportChatRouter.post('/conversations/:id/messages', handle('support.send', async req => ({
  message: await chat.sendChatMessage(req.user, id(req), parse(body, req.body))
})));
supportChatRouter.post('/conversations/:id/claim', staff, handle('support.claim', async req => ({ conversation: await chat.takeChat(req.user, id(req)) })));
supportChatRouter.post('/conversations/:id/transfer', staff, handle('support.transfer', async req => {
  const value = parse(z.object({ agentId: z.string().uuid(), expectedAssignedToId: z.string().uuid().nullable() }), req.body);
  return { conversation: await chat.transferChat(req.user, id(req), value.agentId, value.expectedAssignedToId) };
}));
supportChatRouter.post('/conversations/:id/close', staff, handle('support.close', req => chat.closeChat(req.user, id(req))));
