import multer from 'multer';
import { Worker } from 'node:worker_threads';
import rateLimit from 'express-rate-limit';
import { attachComplaint } from '../support/chat.service.js';
import { once } from '../reliability/idempotency.js';
import { Router } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import { ok, fail } from '../../utils/api-response.js';
import { NotFoundError, ConflictError, ValidationError, normalizeError } from '../../utils/errors.js';
import { calculateCommissionSync } from '../../utils/commission.js';
import { nextAction, trackingHealth, repeatData } from './presentation.js';

export const experienceRouter = Router();
experienceRouter.use(authenticate, requireRoles('client', 'driver'));
const client = requireRoles('client');
const parse = (schema, input) => {
  const value = schema.safeParse(input);
  if (!value.success) throw new ValidationError(value.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })));
  return value.data;
};
const uuid = value => parse(z.string().uuid(), value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Un seul garde couvre toutes les opérations BD. Le corps des réclamations,
// les numéros de téléphone et les documents ne sont jamais journalisés.
const handle = (action, operation) => async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return ok(res, { data: await operation(req) });
  } catch (error) {
    const normalized = normalizeError(error);
    req.log.error({ errorName: error.name, errorCode: normalized?.code ?? error.code, action, userId: req.user?.id, requestId: req.requestId }, 'Delivery workspace failed');
    return fail(res, { status: normalized?.statusCode ?? 500, code: normalized?.code ?? 'INTERNAL_ERROR',
      message: normalized?.publicMessage ?? 'Service temporairement indisponible', details: normalized?.details ?? [] });
  }
};

async function ownedParcel(req) {
  const parcel = await prisma.parcel.findFirst({ where: { id: uuid(req.params.id), deletedAt: null,
    ...(req.user.role === 'driver' ? { assignedDriverId: req.user.id } : { senderId: req.user.id }) },
    include: { _count: { select: { bids: { where: { status: { in: ['pending', 'countered'] } } } } } } });
  if (!parcel) throw new NotFoundError('Colis introuvable');
  return parcel;
}

experienceRouter.get('/parcels/:id', handle('experience.parcel', async req => {
  const parcel = await ownedParcel(req);
  const driver = req.user.role === 'driver';
  const [position, payments, tickets, walletEntries, scoreEntries, wallet, debts, config] = await Promise.all([
    prisma.driverLocation.findFirst({ where: { parcelId: parcel.id, driverId: parcel.assignedDriverId ?? '00000000-0000-0000-0000-000000000000' }, orderBy: { createdAt: 'desc' } }),
    prisma.payment.findMany({ where: { parcelId: parcel.id, ...(driver ? {} : { userId: req.user.id }) }, select: { id: true, amount: true, status: true, method: true, reference: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
    prisma.supportTicket.findMany({ where: { requesterId: req.user.id, category: `parcel:${parcel.id}` }, select: { id: true, reference: true, subject: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
    driver ? prisma.walletTransaction.findMany({ where: { walletUserId: req.user.id, parcelId: parcel.id, type: 'commission', status: 'completed' } }) : [],
    driver ? prisma.scoreTransaction.findMany({ where: { userId: req.user.id, parcelId: parcel.id, type: { in: ['commission_deduction', 'commission_debt'] } } }) : [],
    driver ? prisma.wallet.findUnique({ where: { userId: req.user.id }, select: { commissionDebt: true } }) : null,
    driver ? [] : prisma.clientPenaltyDebt.findMany({ where: { userId: req.user.id, parcelId: parcel.id }, select: { remaining: true } }),
    driver ? prisma.commissionConfig.findFirst({ where: { profile: 'local', isActive: true } }) : null,
  ]);
  const agreedPrice = parcel.assignedDriverId && !['free', 'pending', 'proposal_sent', 'negotiating'].includes(parcel.status) ? (parcel.negotiatedPrice ?? parcel.price) : null;
  const amount = agreedPrice === null ? null : Number(agreedPrice);
  // Les écritures historiques gardent leur montant d'origine. Une estimation
  // au barème actuel est nommée comme telle, jamais présentée comme un débit.
  const pointsPayments = scoreEntries.filter(e => e.type === 'commission_deduction')
    .map(e => e.metadata?.pointsCFADeducted ?? (e.source === 'driver_payment' ? e.metadata?.commission : null));
  // Les anciens mouvements sans contre-valeur FCFA ne sont pas convertis au
  // taux actuel : il serait faux de réécrire leur valeur historique.
  const paidCommission = pointsPayments.some(v => v == null) ? null :
    walletEntries.reduce((n, e) => n + Number(e.amount), 0) + pointsPayments.reduce((n, v) => n + Number(v), 0);
  const debtCreated = scoreEntries.filter(e => e.type === 'commission_debt').reduce((n, e) => n + Number(e.metadata?.debt ?? 0), 0);
  const recorded = walletEntries.length > 0 || scoreEntries.length > 0;
  const historicalCommissions = scoreEntries.map(e => e.metadata?.commission).filter(v => v != null).map(Number);
  const recordedCommission = historicalCommissions.length ? Math.max(...historicalCommissions) : paidCommission === null ? null : paidCommission + debtCreated;
  const commission = driver ? (recorded ? recordedCommission : (config && amount !== null ? calculateCommissionSync(amount, Number(config.percentage), Number(config.minAmount), Number(config.maxAmount)) : null)) : null;
  const collected = payments.filter(p => p.status === 'completed').reduce((n, p) => n + Number(p.amount), 0);
  return { experience: { trackingNumber: parcel.trackingNumber, nextAction: nextAction(parcel, req.user.role), tracking: trackingHealth(parcel, position),
    finance: { agreedPrice: amount, paymentStatus: parcel.paymentStatus, collected, currency: 'XOF',
      ...(driver ? { commission, commissionEstimated: !recorded, paidCommission, debtCreated, accountCommissionDebt: Number(wallet?.commissionDebt ?? 0), netAfterCommission: amount !== null && commission !== null ? Math.max(0, amount - commission) : null }
        : { parcelPenaltyDue: debts.reduce((n, d) => n + Number(d.remaining), 0) }) },
    // Les références de paiement appartiennent au payeur. Le chauffeur ne reçoit
    // que le total encaissé nécessaire à sa mission, jamais les reçus du client.
    receipts: driver ? [] : payments.filter(p => p.status === 'completed'), complaints: tickets, canRepeat: !driver } };
}));

experienceRouter.get('/parcels/:id/repeat', client, handle('experience.repeat', async req => ({ draft: repeatData(await ownedParcel(req)) })));

const complaint = z.object({ requestId: z.string().uuid(), reason: z.enum(['delay', 'damage', 'missing', 'payment', 'other']),
  message: z.string().trim().min(10).max(3000), photos: z.array(z.string().max(2000).refine(v => /^https?:\/\//.test(v) || v.startsWith('/uploads/'), 'URL de photo invalide')).max(4).default([]) });
experienceRouter.post('/parcels/:id/complaints', handle('experience.complaint', async req => {
  const parcel = await ownedParcel(req);
  const value = parse(complaint, req.body);
  const reference = `REC-${value.requestId}`;
  const fingerprint = hash({ parcelId: parcel.id, ...value });
  const reason = { delay: 'Retard', damage: 'Colis endommagé', missing: 'Colis manquant', payment: 'Paiement', other: 'Autre problème' }[value.reason];
  const ticket = await prisma.$transaction(async tx => {
    // La sérialisation par demande évite une double réclamation après un timeout.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user.id}::uuid FOR UPDATE`;
    const existing = await tx.supportTicket.findUnique({ where: { reference } });
    if (existing) {
      const link = await tx.supportMessage.findFirst({ where: { userId: req.user.id, metadata: { path: ['fingerprint'], equals: fingerprint } } });
      if (existing.requesterId !== req.user.id || !link) throw new ConflictError('Cette référence de demande est déjà utilisée');
      return existing;
    }
    const created = await tx.supportTicket.create({ data: { reference, requesterId: req.user.id, category: `parcel:${parcel.id}`,
      subject: `${reason} · ${parcel.trackingNumber}`, body: `${value.message}${value.photos.length ? '\n\nPhotos :\n' + value.photos.join('\n') : ''}` } });
    const conversationId = await attachComplaint(tx, req.user, created, value.photos);
    await tx.supportMessage.create({ data: { userId: req.user.id, subject: created.subject, message: value.message,
      metadata: { parcelId: parcel.id, ticketId: created.id, conversationId, reference, reason: value.reason, photos: value.photos, fingerprint } } });
    return created;
  });
  return { complaint: { id: ticket.id, reference: ticket.reference, status: ticket.status, subject: ticket.subject } };
}));

experienceRouter.get('/workspace', client, handle('experience.workspace', async req => {
  const page = parse(z.coerce.number().int().min(1).max(10000).default(1), req.query.page);
  const [drafts, alerts, receipts] = await Promise.all([
    prisma.shipmentDraft.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.routeAlert.findMany({ where: { userId: req.user.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
    prisma.payment.findMany({ where: { userId: req.user.id, status: 'completed', parcelId: { not: null } },
      select: { id: true, amount: true, method: true, reference: true, createdAt: true, parcelId: true, parcel: { select: { trackingNumber: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 25, skip: (page - 1) * 25 }),
  ]);
  return { drafts, alerts, receipts, page, hasMore: receipts.length === 25 };
}));

const draftData = z.object({ receiverName: z.string().trim().max(120).default(''), receiverPhone: z.string().trim().max(30).default(''),
  receiverEmail: z.string().max(200).default(''), receiverAddress: z.string().max(500).default(''),
  departureZoneId: z.string().uuid().optional(), arrivalZoneId: z.string().uuid().optional(), description: z.string().max(2000).default(''),
  weight: z.coerce.number().positive().max(100000).optional(), type: z.enum(['document', 'package', 'fragile', 'perishable', 'valuable']).default('package'),
  isUrgent: z.boolean().default(false), isInsured: z.boolean().default(false) }).strict();
experienceRouter.post('/drafts', client, handle('experience.drafts', async req => {
  const value = parse(z.object({ drafts: z.array(z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(100), data: draftData })).min(1).max(50) }), req.body);
  if (new Set(value.drafts.map(d => d.id)).size !== value.drafts.length) throw new ValidationError([], 'Identifiants de brouillons répétés');
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user.id}::uuid FOR UPDATE`;
    const previous = await tx.shipmentDraft.findMany({ where: { id: { in: value.drafts.map(d => d.id) } } });
    for (const old of previous) {
      const incoming = value.drafts.find(d => d.id === old.id);
      if (old.userId !== req.user.id || old.label !== incoming.label || hash(draftData.parse(old.data)) !== hash(incoming.data)) throw new ConflictError('Un brouillon utilise déjà cet identifiant avec un autre contenu');
    }
    const fresh = value.drafts.filter(d => !previous.some(p => p.id === d.id));
    if (await tx.shipmentDraft.count({ where: { userId: req.user.id } }) + fresh.length > 100) throw new ConflictError('Terminez ou supprimez vos brouillons avant d’en ajouter (100 maximum)');
    if (fresh.length) await tx.shipmentDraft.createMany({ data: fresh.map(d => ({ ...d, userId: req.user.id })) });
  });
  return { saved: value.drafts.length };
}));
experienceRouter.get('/drafts/:id', client, handle('experience.draft', async req => {
  const draft = await prisma.shipmentDraft.findFirst({ where: { id: uuid(req.params.id), userId: req.user.id } });
  if (!draft) throw new NotFoundError('Brouillon introuvable');
  if (draft.completedParcelId) throw new ConflictError('Ce brouillon a déjà été publié. Retrouvez-le dans vos colis.');
  return { draft: draft.data };
}));
experienceRouter.delete('/drafts/:id', client, handle('experience.deleteDraft', async req => ({ deleted: (await prisma.shipmentDraft.deleteMany({ where: { id: uuid(req.params.id), userId: req.user.id } })).count })));

experienceRouter.post('/alerts', client, handle('experience.alert', async req => {
  const value = parse(z.object({ departureZoneId: z.string().uuid(), arrivalZoneId: z.string().uuid(), consent: z.literal(true), days: z.number().int().min(1).max(90).default(30) }), req.body);
  if (value.departureZoneId === value.arrivalZoneId) throw new ValidationError([], 'Choisissez deux zones différentes');
  const alert = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user.id}::uuid FOR UPDATE`;
    if (await tx.zone.count({ where: { id: { in: [value.departureZoneId, value.arrivalZoneId] }, isActive: true } }) !== 2) throw new ValidationError([], 'Zone indisponible');
    await tx.routeAlert.deleteMany({ where: { userId: req.user.id, expiresAt: { lte: new Date() } } });
    const key = { userId: req.user.id, departureZoneId: value.departureZoneId, arrivalZoneId: value.arrivalZoneId };
    const old = await tx.routeAlert.findUnique({ where: { userId_departureZoneId_arrivalZoneId: key } });
    if (!old && await tx.routeAlert.count({ where: { userId: req.user.id } }) >= 20) throw new ConflictError('20 alertes maximum');
    const expiresAt = new Date(Date.now() + value.days * 86400000);
    return tx.routeAlert.upsert({ where: { userId_departureZoneId_arrivalZoneId: key }, create: { ...key, expiresAt }, update: { expiresAt } });
  });
  return { alert };
}));
experienceRouter.delete('/alerts/:id', client, handle('experience.deleteAlert', async req => ({ deleted: (await prisma.routeAlert.deleteMany({ where: { id: uuid(req.params.id), userId: req.user.id } })).count })));

experienceRouter.get('/requests/:id', handle('experience.request', async req => {
  const record = await prisma.operationRequest.findUnique({ where: { actorId_scope_requestId: { actorId: req.user.id, scope: 'parcel.create', requestId: uuid(req.params.id) } } });
  return { result: record?.result ?? null };
}));
experienceRouter.get('/recipients', client, handle('experience.recipients', async req => ({ recipients: await prisma.savedRecipient.findMany({ where: { userId: req.user.id }, orderBy: { name: 'asc' }, take: 200 }) })));
experienceRouter.get('/recipients/:id', client, handle('experience.recipient', async req => {
  const recipient = await prisma.savedRecipient.findFirst({where:{id:uuid(req.params.id),userId:req.user.id}});
  if (!recipient) throw new NotFoundError('Destinataire introuvable');
  return {draft:{receiverName:recipient.name,receiverPhone:recipient.phone,receiverEmail:recipient.email ?? '',receiverAddress:recipient.address ?? ''}};
}));
const recipientSchema = z.object({ requestId: z.string().uuid(), name: z.string().trim().min(2).max(100), phone: z.string().trim().min(8).max(30), email: z.string().email().max(200).optional().or(z.literal('')), address: z.string().max(500).optional() });
experienceRouter.post('/recipients', client, handle('experience.saveRecipient', async req => {
  const {requestId,...data}=parse(recipientSchema,req.body);
  const recipient=await prisma.$transaction(tx=>once(tx,req.user.id,'recipient.save',requestId,data,async()=>{
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user.id}::uuid FOR UPDATE`;
    if(await tx.savedRecipient.count({where:{userId:req.user.id}})>=200) throw new ConflictError('200 destinataires maximum');
    return JSON.parse(JSON.stringify(await tx.savedRecipient.create({data:{...data,userId:req.user.id}})));
  }));
  return {recipient};
}));
experienceRouter.delete('/recipients/:id', client, handle('experience.deleteRecipient', async req => ({ deleted:(await prisma.savedRecipient.deleteMany({where:{id:uuid(req.params.id),userId:req.user.id}})).count })));
experienceRouter.post('/events', client, handle('experience.event', async req => {
  const data=parse(z.object({attemptId:z.string().uuid(),event:z.enum(['creation_started','creation_submitted','creation_failed','creation_completed']),platform:z.enum(['web','mobile'])}),req.body);
  await prisma.journeyEvent.createMany({data:[{...data,userId:req.user.id}],skipDuplicates:true});
  return {recorded:true};
}));

const importUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1}}).single('file');
const importLimit = rateLimit({windowMs:60000,limit:10,keyGenerator:req=>req.user.id,standardHeaders:true,legacyHeaders:false});
experienceRouter.post('/imports/preview', client, importLimit, (req,res,next)=>importUpload(req,res,error=>error?fail(res,{status:422,code:'INVALID_IMPORT',message:'Fichier limité à 2 Mo'}):next()), handle('experience.import', async req => {
  if(!req.file) throw new ValidationError([], 'Choisissez un fichier CSV ou XLSX');
  // L'analyse s'exécute hors du serveur HTTP, avec mémoire et durée bornées.
  return await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./import-worker.js',import.meta.url),{workerData:{buffer:req.file.buffer,filename:req.file.originalname},resourceLimits:{maxOldGenerationSizeMb:96}});
    const timer=setTimeout(()=>{worker.terminate();reject(new ValidationError([], 'Classeur trop complexe ; exportez une feuille simple en CSV'));},8000);
    worker.once('message',message=>{clearTimeout(timer);worker.terminate();message.error?reject(new ValidationError([],message.error)):resolve(message.result);});
    worker.once('error',()=>{clearTimeout(timer);reject(new ValidationError([], 'Impossible de lire ce fichier'));});
  });
}));
