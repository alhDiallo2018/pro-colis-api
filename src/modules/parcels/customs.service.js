import { prisma } from '../../config/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

const PURPOSES = Object.freeze(['commercial', 'gift', 'sample', 'personal', 'return']);
const ISO2 = /^[A-Z]{2}$/;

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validateBody(body = {}) {
  const errors = [];
  const originCountry = String(body.originCountry ?? '').toUpperCase().trim();
  const destinationCountry = String(body.destinationCountry ?? '').toUpperCase().trim();
  if (!ISO2.test(originCountry)) errors.push({ path: 'originCountry', message: 'Code pays ISO-2 attendu (ex. SN)' });
  if (!ISO2.test(destinationCountry)) errors.push({ path: 'destinationCountry', message: 'Code pays ISO-2 attendu' });

  const contentsDescription = String(body.contentsDescription ?? '').trim();
  if (contentsDescription.length < 2) errors.push({ path: 'contentsDescription', message: 'Description trop courte' });
  if (contentsDescription.length > 500) errors.push({ path: 'contentsDescription', message: 'Description trop longue (500 max)' });

  const declaredValueRaw = body.declaredValue;
  const declaredValue = declaredValueRaw != null && declaredValueRaw !== '' ? Number(declaredValueRaw) : NaN;
  if (!Number.isFinite(declaredValue) || declaredValue < 0) {
    errors.push({ path: 'declaredValue', message: 'Valeur déclarée invalide' });
  }

  const purpose = String(body.purpose ?? 'personal');
  if (!PURPOSES.includes(purpose)) errors.push({ path: 'purpose', message: 'Usage invalide' });

  const quantityRaw = body.quantity ?? 1;
  const quantity = Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity < 1) errors.push({ path: 'quantity', message: 'Quantité entière positive requise' });

  const hsCode = body.hsCode == null ? null : String(body.hsCode).trim();
  if (hsCode && !/^\d{4,10}$/.test(hsCode)) errors.push({ path: 'hsCode', message: 'Code HS invalide (4 à 10 chiffres)' });

  const weightKgRaw = body.weightKg;
  const weightKg = weightKgRaw == null || weightKgRaw === '' ? null : Number(weightKgRaw);
  if (weightKg != null && (!Number.isFinite(weightKg) || weightKg < 0)) {
    errors.push({ path: 'weightKg', message: 'Poids invalide' });
  }

  if (errors.length) throw new ValidationError(errors);

  return {
    originCountry,
    destinationCountry,
    contentsDescription,
    hsCode: hsCode || null,
    declaredValue,
    declaredCurrency: String(body.declaredCurrency ?? 'XOF').toUpperCase().slice(0, 3),
    weightKg,
    quantity,
    category: body.category != null ? String(body.category).trim().slice(0, 100) : null,
    purpose,
    isDangerous: Boolean(body.isDangerous),
    documentsUrls: Array.isArray(body.documentsUrls)
      ? body.documentsUrls.filter((u) => typeof u === 'string').slice(0, 10)
      : []
  };
}

async function parcelAccessibleBy(parcelId, actor) {
  if (!isUuid(parcelId)) throw new ValidationError([{ path: 'parcelId', message: 'Identifiant invalide' }]);
  const parcel = await prisma.parcel.findUnique({
    where: { id: parcelId },
    select: { id: true, senderId: true, assignedDriverId: true, deletedAt: true }
  });
  if (!parcel || parcel.deletedAt) throw new NotFoundError('Colis introuvable');
  const allowed = actor.role === 'super_admin' ||
    parcel.senderId === actor.id ||
    parcel.assignedDriverId === actor.id;
  if (!allowed) throw new ForbiddenError('Accès refusé');
  return parcel;
}

export async function createParcelCustoms({ parcelId, actor, body }) {
  await parcelAccessibleBy(parcelId, actor);
  const data = validateBody(body);
  try {
    return await prisma.parcelCustoms.create({
      data: { parcelId, ...data }
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ConflictError('Une déclaration existe déjà pour ce colis — utiliser PUT pour la modifier');
    }
    throw err;
  }
}

export async function updateParcelCustoms({ parcelId, actor, body }) {
  await parcelAccessibleBy(parcelId, actor);
  const existing = await prisma.parcelCustoms.findUnique({ where: { parcelId } });
  if (!existing) throw new NotFoundError('Aucune déclaration à modifier');
  if (existing.signedAt) {
    throw new ConflictError('La déclaration est signée et ne peut plus être modifiée');
  }
  const data = validateBody(body);
  return prisma.parcelCustoms.update({ where: { parcelId }, data });
}

export async function getParcelCustoms({ parcelId, actor }) {
  await parcelAccessibleBy(parcelId, actor);
  return prisma.parcelCustoms.findUnique({ where: { parcelId } });
}

export async function signParcelCustoms({ parcelId, actor }) {
  const parcel = await parcelAccessibleBy(parcelId, actor);
  // Seul l'expéditeur ou l'admin peut signer.
  if (actor.role !== 'super_admin' && parcel.senderId !== actor.id) {
    throw new ForbiddenError('Seul l\'expéditeur peut signer la déclaration');
  }
  const existing = await prisma.parcelCustoms.findUnique({ where: { parcelId } });
  if (!existing) throw new NotFoundError('Aucune déclaration à signer');
  if (existing.signedAt) return existing;
  return prisma.parcelCustoms.update({
    where: { parcelId },
    data: { signedAt: new Date(), signedById: actor.id }
  });
}

export function serializeCustoms(c) {
  if (!c) return null;
  return {
    id: c.id,
    parcelId: c.parcelId,
    originCountry: c.originCountry,
    destinationCountry: c.destinationCountry,
    contentsDescription: c.contentsDescription,
    hsCode: c.hsCode,
    declaredValue: Number(c.declaredValue),
    declaredCurrency: c.declaredCurrency,
    weightKg: c.weightKg != null ? Number(c.weightKg) : null,
    quantity: c.quantity,
    category: c.category,
    purpose: c.purpose,
    isDangerous: c.isDangerous,
    documentsUrls: Array.isArray(c.documentsUrls) ? c.documentsUrls : [],
    signedAt: c.signedAt?.toISOString() ?? null,
    signedById: c.signedById,
    createdAt: c.createdAt?.toISOString() ?? null,
    updatedAt: c.updatedAt?.toISOString() ?? null
  };
}

export const CUSTOMS_PURPOSES = PURPOSES;
