import { csvRows } from '../experience/imports.js';
import { prisma } from '../../config/prisma.js';
import { ValidationError } from '../../utils/errors.js';
import { registeredTransport } from './live.service.js';
import { normalizeItinerary } from './itinerary.js';
import { rememberRoute, templateData } from './templates.service.js';

const invalid = (message, line) => {
  throw new ValidationError([{ path: line ? `file.${line}` : 'file', message }], line ? `Ligne ${line} : ${message}` : message);
};
const key = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** Une ligne CSV par arrêt ; les lignes de même numéro composent un trajet. */
export function parseShuttleCsv(buffer) {
  if (!buffer?.length || buffer.length > 128 * 1024) invalid('Choisissez un CSV non vide de 128 Ko maximum');
  const rows = csvRows(buffer.toString('utf8'));
  if (rows.length < 3 || rows.length > 51) invalid('Le CSV doit contenir un en-tête puis 2 à 50 arrêts');
  const aliases = { ligne: 'lineNumber', linenumber: 'lineNumber', zone: 'zone', zoneid: 'zone', arret: 'zone', minutes: 'offsetMinutes', offsetminutes: 'offsetMinutes' };
  const headers = rows[0].map(h => aliases[key(h).replace(/[\s_]/g, '')]);
  if (headers.length !== 3 || new Set(headers).size !== 3 || headers.some(h => !h)) {
    invalid('Colonnes attendues : ligne, zone, minutes');
  }
  const groups = new Map();
  for (const [index, row] of rows.slice(1).entries()) {
    const line = index + 2;
    if (row.length !== headers.length) invalid('Chaque arrêt doit avoir exactement trois colonnes', line);
    const data = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
    if (!data.lineNumber || data.lineNumber.length > 40 || !data.zone || data.zone.length > 160 || !/^\d+$/.test(data.offsetMinutes)) {
      invalid('Ligne, zone et durée entière en minutes requises', line);
    }
    const stop = { zone: data.zone, offsetMinutes: Number(data.offsetMinutes), line };
    const stops = groups.get(data.lineNumber) ?? [];
    // Ne pas trier silencieusement : le fichier exprime le sens de circulation.
    if ((!stops.length && stop.offsetMinutes !== 0) ||
        (stops.length && stop.offsetMinutes <= stops.at(-1).offsetMinutes) || stop.offsetMinutes > 43200) {
      invalid('Les minutes doivent commencer à 0 et augmenter à chaque arrêt (maximum 43200)', line);
    }
    stops.push(stop);
    if (stops.length > 40) invalid('40 arrêts maximum par ligne', line);
    groups.set(data.lineNumber, stops);
  }
  for (const stops of groups.values()) if (stops.length < 2) invalid('Chaque ligne doit comporter au moins deux arrêts', stops[0].line);
  return [...groups].map(([lineNumber, stops]) => ({ lineNumber, stops }));
}

export async function previewShuttleImport(actor, buffer, db = prisma) {
  const groups = parseShuttleCsv(buffer);
  const transport = await registeredTransport(actor.id, undefined, db);
  if (transport.serviceType !== 'shuttle') invalid('Un véhicule de type navette / bus est requis pour cet import');
  if (!(Number(transport.capacity) > 0)) invalid('Renseignez la capacité du véhicule dans le profil');
  const zones = await db.zone.findMany({ select: { id: true, name: true, displayName: true } });
  const plans = [];
  for (const group of groups) {
    const stops = group.stops.map(stop => {
      // Un UUID évite les homonymes. Un libellé n’est accepté que s’il désigne
      // exactement une zone : aucune géolocalisation approximative à l’import.
      const matches = zones.filter(z => z.id.toLowerCase() === stop.zone.toLowerCase() ||
        key(z.name) === key(stop.zone) || (z.displayName && key(z.displayName) === key(stop.zone)));
      if (matches.length !== 1) invalid(matches.length ? 'Zone ambiguë : utilisez son identifiant UUID' : `Zone introuvable : ${stop.zone}`, stop.line);
      return { zoneId: matches[0].id, offsetMinutes: stop.offsetMinutes };
    });
    const source = { departureZoneId: stops[0].zoneId, arrivalZoneId: stops.at(-1).zoneId,
      availableWeight: Number(transport.capacity), departureAt: new Date() };
    const itinerary = await normalizeItinerary({ serviceType: 'shuttle', lineNumber: group.lineNumber, stops }, source, db);
    plans.push({ ...source, driverId: actor.id, metadata: { itinerary } });
  }
  return plans;
}

export async function importShuttleRoutes(actor, buffer) {
  return prisma.$transaction(async tx => {
    // Même verrou et même empreinte que le carnet existant : un double envoi
    // ou la reprise après coupure ne crée jamais deux fois le même itinéraire.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id}::uuid FOR UPDATE`;
    const plans = await previewShuttleImport(actor, buffer, tx);
    const templates = [];
    for (const plan of plans) templates.push(await rememberRoute(tx, plan));
    await tx.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role,
      action: 'route.templates.import', entityType: 'route_template', afterData: { count: templates.length } } });
    return templates;
  }, { timeout: 20000 });
}

export const shuttleImportPreview = plans => plans.map(plan => ({ data: templateData(plan) }));
