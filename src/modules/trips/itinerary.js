import { ValidationError, ConflictError } from '../../utils/errors.js';
const invalid = message => { throw new ValidationError([{ path: 'itinerary', message }]); };

// Une annonce représente un départ daté, même pour une ligne régulière.
// Les arrêts utilisent les zones partagées : pas de correspondance approximative
// entre deux libellés pouvant désigner des lieux différents.
export async function normalizeItinerary(input, source, db) {
  if (input === null) return null;
  if (!input || !['trip', 'gp', 'shuttle'].includes(input.serviceType)) invalid('Type de service invalide');
  const lineNumber = String(input.lineNumber ?? '').trim();
  if (lineNumber.length > 40 || (input.serviceType === 'shuttle' && !lineNumber)) invalid('Numéro de ligne requis (40 caractères maximum)');
  if (!Array.isArray(input.stops) || input.stops.length < 2 || input.stops.length > 40) invalid('Précisez entre 2 et 40 arrêts ordonnés');
  const start = new Date(source.departureAt).getTime();
  if (!source.departureAt || !Number.isFinite(start)) invalid('Date de départ requise');
  if (!(Number(source.availableWeight) > 0)) invalid('Capacité en kg requise');
  let previous = -1;
  const ids = new Set();
  const stops = input.stops.map((stop, index) => {
    const minutes = Number(stop.offsetMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 43200 || minutes <= previous || (index === 0 && minutes !== 0)) invalid('Les horaires doivent progresser depuis le départ (0 minute)');
    if (typeof stop.zoneId !== 'string' || !/^[0-9a-f-]{36}$/i.test(stop.zoneId) || ids.has(stop.zoneId)) invalid('Chaque arrêt doit correspondre à une zone distincte');
    previous = minutes; ids.add(stop.zoneId);
    return { zoneId: stop.zoneId, offsetMinutes: minutes };
  });
  if (stops[0].zoneId !== source.departureZoneId || stops.at(-1).zoneId !== source.arrivalZoneId) invalid('Les terminus doivent correspondre au départ et à l’arrivée');
  const zones = await db.zone.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, displayName: true, latitude: true, longitude: true } });
  if (zones.length !== ids.size) invalid('Un arrêt est introuvable');
  return { serviceType: input.serviceType, lineNumber: input.serviceType === 'shuttle' ? lineNumber : null,
    stops: stops.map(stop => { const zone = zones.find(z => z.id === stop.zoneId); return { ...stop,
      name: zone.displayName || zone.name, latitude: zone.latitude === null ? null : Number(zone.latitude), longitude: zone.longitude === null ? null : Number(zone.longitude),
      scheduledAt: new Date(start + stop.offsetMinutes * 60000).toISOString() }; }) };
}

export function segmentFor(ad, parcel, now = Date.now(), checkTime = true) {
  const itinerary = ad.metadata?.itinerary;
  if (!itinerary) return null; // Compatibilité avec les anciennes annonces.
  const from = itinerary.stops.findIndex(s => s.zoneId === parcel.departureZoneId);
  const to = itinerary.stops.findIndex(s => s.zoneId === parcel.arrivalZoneId);
  if (from < 0 || to <= from) throw new ConflictError('Le retrait et la remise doivent suivre le sens des arrêts de ce trajet');
  if (checkTime && new Date(itinerary.stops[from].scheduledAt).getTime() <= now) throw new ConflictError('L’heure de prise en charge à cet arrêt est passée');
  if (!(Number(parcel.weight) > 0)) throw new ConflictError('Le poids du colis est requis pour réserver ce trajet');
  return { from, to, pickup: itinerary.stops[from], dropoff: itinerary.stops[to] };
}

// Addition par tronçon, et non par voyage : la capacité est libérée après
// l’arrêt de remise, mais pas tant que deux réservations se chevauchent.
export function assertSegmentCapacity(ad, parcel, reservations, now = Date.now()) {
  const segment = segmentFor(ad, parcel, now);
  if (!segment) return null;
  for (let leg = segment.from; leg < segment.to; leg++) {
    let used = 0;
    for (const reservation of reservations) {
      const other = reservation.parcel;
      if (!other || other.id === parcel.id || ['cancelled', 'delivered'].includes(other.status)) continue;
      const occupied = segmentFor(ad, other, now, false);
      if (occupied.from <= leg && leg < occupied.to) used += Number(other.weight);
    }
    if (used + Number(parcel.weight) > Number(ad.availableWeight)) throw new ConflictError('Capacité insuffisante sur cette portion du trajet');
  }
  return segment;
}
