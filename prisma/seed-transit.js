/**
 * Seed catalogue DDD + AFTU : zones d'arrêts puis TransitLine + TransitLineStop.
 * Idempotent (upsert par placeId pour zones, par (operator, number, direction) pour lignes).
 *
 * Prérequis :
 *   node scripts/transit/scrape.mjs   # → data/transit-raw.json
 *   node scripts/transit/geocode.mjs  # → data/zones-seed.json
 *
 * Lancer :
 *   node prisma/seed-transit.js
 */
import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

const slug = (s) =>
  (typeof s === 'string' ? s : '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function loadJson(p) {
  return JSON.parse(await readFile(resolve(ROOT, p), 'utf8'));
}

async function seedZones(zonesPayload) {
  const byKey = new Map();
  for (const z of zonesPayload.zones) {
    const placeId = `transit-stop:${z.key}`;
    const data = {
      name: z.name,
      displayName: z.name,
      country: z.country ?? 'Sénégal',
      region: z.region ?? 'Dakar',
      city: z.city ?? 'Dakar',
      latitude: String(z.latitude),
      longitude: String(z.longitude),
      radiusKm: '0.3',
      type: 'CIRCLE',
      status: z.status ?? 'pending',
      source: z.source ?? 'transit-seed',
      isActive: true,
    };
    const zone = await prisma.zone.upsert({
      where: { placeId },
      update: data,
      create: { ...data, placeId },
    });
    byKey.set(z.key, zone.id);
  }
  return byKey;
}

async function seedLines(raw, zoneIdByKey) {
  const operatorMap = { DDD: 'ddd', AFTU: 'aftu' };
  let created = 0, updated = 0, skipped = 0;
  for (const line of raw.lines) {
    const operator = operatorMap[line.operator];
    if (!operator || !line.origin || !line.destination) { skipped++; continue; }
    // Direction : chaque ligne scrapée = sens "aller". Un futur import importera les retours.
    const direction = 'aller';
    const name = `${line.operator} ${line.number} : ${line.origin} → ${line.destination}`;
    const source = line.source ?? null;
    const metadata = {
      kind: line.kind,
      startCoords: line.startCoords ?? null,
      finishCoords: line.finishCoords ?? null,
    };

    const existing = await prisma.transitLine.findUnique({
      where: { operator_number_direction: { operator, number: line.number, direction } },
    });
    const upserted = await prisma.transitLine.upsert({
      where: { operator_number_direction: { operator, number: line.number, direction } },
      update: { name, origin: line.origin, destination: line.destination, source, metadata },
      create: { operator, number: line.number, direction, name,
               origin: line.origin, destination: line.destination, source, metadata },
    });
    existing ? updated++ : created++;

    // Arrêts : on réécrit (deleteMany + createMany) pour refléter le scrape à l'identique.
    await prisma.transitLineStop.deleteMany({ where: { transitLineId: upserted.id } });
    const stops = line.stops
      .map((label, order) => {
        const zoneId = zoneIdByKey.get(slug(label));
        if (!zoneId) return null;
        return { transitLineId: upserted.id, order, zoneId, label };
      })
      .filter(Boolean);
    // Dédup par order (au cas où deux arrêts partagent le même slug après normalisation).
    const seen = new Set();
    const uniqueStops = [];
    for (const s of stops) {
      if (seen.has(s.order)) continue;
      // L'unicité (transitLineId, order) est la clé primaire : jamais de doublon d'ordre.
      // Mais si deux labels différents mappent sur la même zone, on garde la première occurrence.
      const key = `${s.transitLineId}:${s.zoneId}`;
      if (seen.has(key)) continue;
      seen.add(s.order); seen.add(key);
      uniqueStops.push(s);
    }
    // Renuméroter pour préserver un ordre dense 0..N-1.
    const renumbered = uniqueStops.map((s, i) => ({ ...s, order: i }));
    if (renumbered.length >= 2) {
      await prisma.transitLineStop.createMany({ data: renumbered });
    }
  }
  return { created, updated, skipped };
}

async function main() {
  console.log('🚌 Seed catalogue transit DDD + AFTU');
  const raw = await loadJson('data/transit-raw.json');
  const zones = await loadJson('data/zones-seed.json');
  console.log(`  → ${zones.zones.length} zones à importer`);
  const zoneIdByKey = await seedZones(zones);
  console.log(`  ✅ Zones upsertées (${zoneIdByKey.size})`);
  const r = await seedLines(raw, zoneIdByKey);
  console.log(`  ✅ Lignes : ${r.created} créées, ${r.updated} mises à jour, ${r.skipped} ignorées`);
  console.log('✨ Terminé');
}

main()
  .catch((e) => { console.error('❌ Seed transit échoué :', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
