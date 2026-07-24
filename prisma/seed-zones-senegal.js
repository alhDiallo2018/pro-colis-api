/**
 * Seed de l'ossature administrative du Sénégal : 14 régions + départements.
 * Idempotent (upsert par placeId synthétique "sn-region:<slug>" / "sn-dept:<slug>").
 * Statut "approved", source "seed". Les départements sont rattachés à leur région (parentId).
 *
 * Lancer : node prisma/seed-zones-senegal.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const slug = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// [nom région, lat, lng, [ [dép, lat, lng], ... ] ]
const REGIONS = [
  ['Dakar', 14.6928, -17.4467, [['Dakar', 14.6928, -17.4467], ['Guédiawaye', 14.7686, -17.4056], ['Pikine', 14.7549, -17.3900], ['Rufisque', 14.7156, -17.2736], ['Keur Massar', 14.7833, -17.3167]]],
  ['Thiès', 14.7910, -16.9256, [['Thiès', 14.7910, -16.9256], ['Mbour', 14.4198, -16.9636], ['Tivaouane', 14.9500, -16.8167]]],
  ['Diourbel', 14.6559, -16.2314, [['Diourbel', 14.6559, -16.2314], ['Bambey', 14.7000, -16.4667], ['Mbacké', 14.7833, -15.9167]]],
  ['Fatick', 14.3390, -16.4110, [['Fatick', 14.3390, -16.4110], ['Foundiougne', 14.1333, -16.4667], ['Gossas', 14.4833, -16.0667]]],
  ['Kaolack', 14.1652, -16.0726, [['Kaolack', 14.1652, -16.0726], ['Guinguinéo', 14.2667, -15.9500], ['Nioro du Rip', 13.7500, -15.7833]]],
  ['Kaffrine', 14.1058, -15.5508, [['Kaffrine', 14.1058, -15.5508], ['Birkelane', 14.1333, -15.7333], ['Koungheul', 13.9833, -14.8000], ['Malem Hodar', 14.1167, -15.3000]]],
  ['Louga', 15.6144, -16.2260, [['Louga', 15.6144, -16.2260], ['Kébémer', 15.3667, -16.4500], ['Linguère', 15.3833, -15.1167]]],
  ['Saint-Louis', 16.0179, -16.4896, [['Saint-Louis', 16.0179, -16.4896], ['Dagana', 16.5167, -15.5000], ['Podor', 16.6500, -14.9667]]],
  ['Matam', 15.6559, -13.2554, [['Matam', 15.6559, -13.2554], ['Kanel', 15.4919, -13.1811], ['Ranérou', 15.3000, -13.9667]]],
  ['Tambacounda', 13.7708, -13.6673, [['Tambacounda', 13.7708, -13.6673], ['Bakel', 14.9000, -12.4667], ['Goudiry', 14.1833, -12.7167], ['Koumpentoum', 13.9833, -14.5500]]],
  ['Kédougou', 12.5556, -12.1747, [['Kédougou', 12.5556, -12.1747], ['Salémata', 12.6333, -12.8167], ['Saraya', 12.8500, -11.7667]]],
  ['Kolda', 12.8983, -14.9412, [['Kolda', 12.8983, -14.9412], ['Médina Yoro Foulah', 13.1333, -14.6667], ['Vélingara', 13.1500, -14.1167]]],
  ['Sédhiou', 12.7081, -15.5569, [['Sédhiou', 12.7081, -15.5569], ['Bounkiling', 13.0500, -15.7000], ['Goudomp', 12.5833, -15.8833]]],
  ['Ziguinchor', 12.5641, -16.2639, [['Ziguinchor', 12.5641, -16.2639], ['Bignona', 12.8103, -16.2264], ['Oussouye', 12.4850, -16.5486]]],
];

async function upsertZone({ placeId, name, region, city, lat, lng, radiusKm, parentId }) {
  return prisma.zone.upsert({
    where: { placeId },
    update: {
      name, displayName: name, region, city, latitude: String(lat), longitude: String(lng),
      radiusKm: String(radiusKm), country: 'Sénégal', type: 'CIRCLE', status: 'approved',
      source: 'seed', isActive: true, parentId: parentId ?? null,
    },
    create: {
      placeId, name, displayName: name, region, city, latitude: String(lat), longitude: String(lng),
      radiusKm: String(radiusKm), country: 'Sénégal', type: 'CIRCLE', status: 'approved',
      source: 'seed', isActive: true, parentId: parentId ?? null,
    },
  });
}

async function main() {
  let regions = 0;
  let depts = 0;
  for (const [regionName, rLat, rLng, departments] of REGIONS) {
    const region = await upsertZone({
      placeId: `sn-region:${slug(regionName)}`,
      name: regionName, region: regionName, city: null, lat: rLat, lng: rLng, radiusKm: 60, parentId: null,
    });
    regions += 1;
    for (const [deptName, dLat, dLng] of departments) {
      await upsertZone({
        placeId: `sn-dept:${slug(deptName)}`,
        name: deptName, region: regionName, city: deptName, lat: dLat, lng: dLng, radiusKm: 30, parentId: region.id,
      });
      depts += 1;
    }
  }
  console.log(`✅ Seed zones Sénégal : ${regions} régions, ${depts} départements (upsert idempotent).`);
}

main()
  .catch((e) => { console.error('❌ Seed zones échoué :', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
