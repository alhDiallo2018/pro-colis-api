import { notifyRouteAlerts } from '../experience/alerts.service.js';
import { createHash } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { normalizeItinerary } from './itinerary.js';
import { registeredTransport } from './live.service.js';
const invalid = (path, message) => { throw new ValidationError([{ path, message }]); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export function templateData(ad) {
  const route = ad.metadata?.itinerary;
  if (!route) return null;
  return {
    departureZoneId: ad.departureZoneId, arrivalZoneId: ad.arrivalZoneId,
    departureCity: ad.departureCity ?? null, arrivalCity: ad.arrivalCity ?? null,
    // Le tarif dépend du colis proposé : un trajet réutilisable ne mémorise
    // jamais le prix d'un ancien départ ou d'une ancienne négociation.
    availableWeight: Number(ad.availableWeight), proposedPrice: null,
    description: ad.description ?? null,
    itinerary: { serviceType: route.serviceType, lineNumber: route.lineNumber ?? null,
      stops: route.stops.map(s => ({ zoneId: s.zoneId, name: s.name, offsetMinutes: s.offsetMinutes })) }
  };
}

export async function rememberRoute(tx, ad, name) {
  const data = templateData(ad);
  if (!data) return null;
  // L'empreinte ignore la date, le prix, le véhicule et le GPS. Une même ligne
  // avec les mêmes arrêts n'engendre pas un nouveau modèle à chaque départ.
  const fingerprint = hash({ serviceType: data.itinerary.serviceType, lineNumber: data.itinerary.lineNumber,
    stops: data.itinerary.stops.map(({ zoneId, offsetMinutes }) => ({ zoneId, offsetMinutes })) });
  const label = `${data.itinerary.lineNumber ? `Ligne ${data.itinerary.lineNumber} · ` : ''}${data.itinerary.stops[0].name} → ${data.itinerary.stops.at(-1).name}`;
  return tx.routeTemplate.upsert({ where: { driverId_fingerprint: { driverId: ad.driverId, fingerprint } },
    create: { driverId: ad.driverId, fingerprint, name: name || label, data },
    update: { data, archivedAt: null, lastUsedAt: new Date(), ...(name ? { name } : {}) } });
}

export async function saveExistingRoute(actor, advertisementId) {
  if (!isUuid(advertisementId)) invalid('advertisementId', 'Identifiant invalide');
  const ad = await prisma.advertisement.findFirst({ where: { id: advertisementId, driverId: actor.id } });
  if (!ad) throw new NotFoundError('Trajet introuvable');
  if (!ad.metadata?.itinerary) throw new ConflictError('Ajoutez les arrêts et leurs durées à ce trajet avant de le mémoriser');
  return rememberRoute(prisma, ad);
}

export function reversedRoute(route) {
  const total = route.stops.at(-1).offsetMinutes;
  return { ...route, stops: [...route.stops].reverse().map(s => ({ ...s, offsetMinutes: total - s.offsetMinutes })) };
}

export function expandDepartures(data, departures, weight, price) {
  return departures.map(({ departureAt, reverse }) => {
    const source = reverse ? reversedRoute(data.itinerary) : data.itinerary;
    const itinerary = { ...source, stops: source.stops.map(s => ({ ...s,
      scheduledAt: new Date(departureAt.getTime() + s.offsetMinutes * 60000).toISOString() })) };
    return { departureAt, departureZoneId: itinerary.stops[0].zoneId, arrivalZoneId: itinerary.stops.at(-1).zoneId,
      departureCity: reverse ? data.arrivalCity : data.departureCity,
      arrivalCity: reverse ? data.departureCity : data.arrivalCity,
      availableWeight: weight, proposedPrice: price, description: data.description, itinerary };
  });
}

function period(ad) {
  const start = new Date(ad.departureAt).getTime();
  const end = new Date((ad.itinerary ?? ad.metadata?.itinerary)?.stops?.at(-1)?.scheduledAt).getTime();
  return { start, end };
}
export function assertNoOverlaps(planned, existing = []) {
  const intervals = planned.map(period).sort((a, b) => a.start - b.start);
  for (let i = 0; i < intervals.length; i++) {
    const current = intervals[i];
    if (i && intervals[i - 1].end > current.start) throw new ConflictError('Les départs se chevauchent : augmentez l’intervalle selon la durée du trajet');
    if (existing.some(ad => { const p = period(ad); return p.start < current.end && current.start < p.end; })) {
      throw new ConflictError('Ce véhicule possède déjà un départ ouvert sur l’un de ces créneaux');
    }
  }
}

export async function scheduleRoute(actor, templateId, body) {
  if (!isUuid(templateId) || !isUuid(body.requestId)) invalid('requestId', 'Identifiants de trajet et de demande requis');
  if (!Array.isArray(body.departures) || body.departures.length < 1 || body.departures.length > 100) invalid('departures', 'Choisissez entre 1 et 100 départs');
  const departures = body.departures.map((value, i) => {
    if (!value || typeof value.departureAt !== 'string' || !Number.isFinite(Date.parse(value.departureAt))) invalid(`departures.${i}`, 'Horaire invalide');
    if (value.reverse !== undefined && typeof value.reverse !== 'boolean') invalid(`departures.${i}.reverse`, 'Sens invalide');
    return { departureAt: new Date(value.departureAt), reverse: value.reverse === true };
  });
  if (new Set(departures.map(d => d.departureAt.toISOString())).size !== departures.length) invalid('departures', 'Deux départs ne peuvent pas avoir le même horaire');
  const payloadHash = hash({ templateId, departures, availableWeight: body.availableWeight ?? null, proposedPrice: { specified: body.proposedPrice !== undefined, value: body.proposedPrice ?? null } });
  return prisma.$transaction(async tx => {
    // Une seule planification à la fois pour ce chauffeur. Le même identifiant
    // rejoué renvoie le résultat initial, y compris après une coupure réseau.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id}::uuid FOR UPDATE`;
    const previous = await tx.routeScheduleBatch.findUnique({ where: { driverId_requestId: { driverId: actor.id, requestId: body.requestId } } });
    if (previous) {
      if (previous.payloadHash !== payloadHash) throw new ConflictError('Cette demande a déjà été utilisée avec un autre planning');
      return { advertisementIds: previous.advertisementIds, replayed: true };
    }
    const template = await tx.routeTemplate.findFirst({ where: { id: templateId, driverId: actor.id, archivedAt: null } });
    if (!template) throw new NotFoundError('Trajet habituel introuvable');
    const now = Date.now();
    if (departures.some(d => d.departureAt.getTime() <= now || d.departureAt.getTime() > now + 90 * 86400000)) invalid('departures', 'Les départs doivent être futurs et prévus dans les 90 prochains jours');
    const transport = await registeredTransport(actor.id, undefined, tx);
    if (transport.serviceType !== template.data.itinerary.serviceType) throw new ConflictError('Le véhicule actuel ne correspond pas à la catégorie de ce trajet habituel');
    const weight = Number(body.availableWeight ?? template.data.availableWeight);
    // Même les anciens modèles tarifés démarrent désormais à négocier.
    // Un prix explicitement transmis reste compatible avec les anciens clients.
    const price = body.proposedPrice === undefined ? null : body.proposedPrice;
    if (!Number.isFinite(weight) || weight <= 0 || (transport.capacity > 0 && weight > transport.capacity)) invalid('availableWeight', 'Capacité disponible invalide pour le véhicule enregistré');
    if (price !== null && (!Number.isFinite(Number(price)) || Number(price) <= 0)) invalid('proposedPrice', 'Prix positif requis');
    // Résoudre les zones une seule fois pour les 100 départs possibles.
    const itinerary = await normalizeItinerary(template.data.itinerary, { ...template.data, availableWeight: weight, departureAt: departures[0].departureAt }, tx);
    const plans = expandDepartures({ ...template.data, itinerary }, departures, weight, price === null ? null : Number(price));
    const existing = await tx.advertisement.findMany({ where: { status: 'open', metadata: { path: ['transport', 'vehicleId'], equals: transport.vehicleId } }, select: { departureAt: true, metadata: true } });
    assertNoOverlaps(plans, existing);
    const advertisementIds = [];
    for (const plan of plans) {
      const { itinerary: route, ...fields } = plan;
      const ad = await tx.advertisement.create({ data: { ...fields, driverId: actor.id,
        metadata: { itinerary: route, transport, routeTemplateId: template.id, scheduleRequestId: body.requestId } }, select: { id: true } });
      await notifyRouteAlerts(tx, { ...plan, id: ad.id, status: 'open', driverId: actor.id, metadata: { itinerary: route } });
      advertisementIds.push(ad.id);
    }
    await tx.routeScheduleBatch.create({ data: { driverId: actor.id, requestId: body.requestId, payloadHash, advertisementIds } });
    await tx.routeTemplate.update({ where: { id: template.id }, data: { lastUsedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'journey.schedule', entityType: 'route_template', entityId: template.id,
      afterData: { count: advertisementIds.length, requestId: body.requestId } } });
    return { advertisementIds, replayed: false };
  }, { timeout: 20000 });
}
