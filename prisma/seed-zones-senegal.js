/**
 * Seed complet des zones du Sénégal : 14 régions + départements + grandes villes.
 * Idempotent (upsert par placeId).
 * Statut "approved", source "seed".
 * 
 * Lancer : node prisma/seed-zones-senegal-complet.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const slug = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Structure : [nom région, lat, lng, [ [département, lat, lng, [villes...] ], ... ] ]
const REGIONS = [
  ['Dakar', 14.6928, -17.4467, [
    ['Dakar', 14.6928, -17.4467, ['Dakar Plateau', 'Grand Dakar', 'Fann', 'Mermoz', 'Ouakam', 'Yoff', 'Sicap Baobab']],
    ['Guédiawaye', 14.7686, -17.4056, ['Guédiawaye', 'Wakhinane']],
    ['Pikine', 14.7549, -17.3900, ['Pikine', 'Thiaroye', 'Mbao', 'Yeumbeul', 'Keur Massar']],
    ['Rufisque', 14.7156, -17.2736, ['Rufisque', 'Bargny', 'Diamniadio']],
  ]],
  
  ['Thiès', 14.7910, -16.9256, [
    ['Thiès', 14.7910, -16.9256, ['Thiès Ville', 'Thiès Nord', 'Thiès Sud', 'Pout', 'Notto']],
    ['Mbour', 14.4198, -16.9636, ['Mbour', 'Saly', 'Joal-Fadiouth']],
    ['Tivaouane', 14.9500, -16.8167, ['Tivaouane', 'Mékhé']],
  ]],

  ['Diourbel', 14.6559, -16.2314, [
    ['Diourbel', 14.6559, -16.2314, ['Diourbel', 'Ngaye']],
    ['Bambey', 14.7000, -16.4667, ['Bambey']],
    ['Mbacké', 14.7833, -15.9167, ['Mbacké', 'Touba']],
  ]],

  ['Fatick', 14.3390, -16.4110, [
    ['Fatick', 14.3390, -16.4110, ['Fatick', 'Passy']],
    ['Foundiougne', 14.1333, -16.4667, ['Foundiougne']],
    ['Gossas', 14.4833, -16.0667, ['Gossas']],
  ]],

  ['Kaolack', 14.1652, -16.0726, [
    ['Kaolack', 14.1652, -16.0726, ['Kaolack', 'Kahone']],
    ['Guinguinéo', 14.2667, -15.9500, ['Guinguinéo']],
    ['Nioro du Rip', 13.7500, -15.7833, ['Nioro du Rip']],
  ]],

  ['Kaffrine', 14.1058, -15.5508, [
    ['Kaffrine', 14.1058, -15.5508, ['Kaffrine']],
    ['Birkelane', 14.1333, -15.7333, ['Birkelane']],
    ['Koungheul', 13.9833, -14.8000, ['Koungheul']],
    ['Malem Hodar', 14.1167, -15.3000, ['Malem Hodar']],
  ]],

  ['Louga', 15.6144, -16.2260, [
    ['Louga', 15.6144, -16.2260, ['Louga']],
    ['Kébémer', 15.3667, -16.4500, ['Kébémer']],
    ['Linguère', 15.3833, -15.1167, ['Linguère']],
  ]],

  ['Saint-Louis', 16.0179, -16.4896, [
    ['Saint-Louis', 16.0179, -16.4896, ['Saint-Louis Ville', 'Rao']],
    ['Dagana', 16.5167, -15.5000, ['Dagana']],
    ['Podor', 16.6500, -14.9667, ['Podor', 'Ndioum', 'Richard Toll']],
  ]],

  ['Matam', 15.6559, -13.2554, [
    ['Matam', 15.6559, -13.2554, ['Matam']],
    ['Kanel', 15.4919, -13.1811, ['Kanel']],
    ['Ranérou', 15.3000, -13.9667, ['Ranérou']],
  ]],

  ['Tambacounda', 13.7708, -13.6673, [
    ['Tambacounda', 13.7708, -13.6673, ['Tambacounda']],
    ['Bakel', 14.9000, -12.4667, ['Bakel']],
    ['Goudiry', 14.1833, -12.7167, ['Goudiry']],
    ['Koumpentoum', 13.9833, -14.5500, ['Koumpentoum']],
  ]],

  ['Kédougou', 12.5556, -12.1747, [
    ['Kédougou', 12.5556, -12.1747, ['Kédougou']],
    ['Salémata', 12.6333, -12.8167, ['Salémata']],
    ['Saraya', 12.8500, -11.7667, ['Saraya']],
  ]],

  ['Kolda', 12.8983, -14.9412, [
    ['Kolda', 12.8983, -14.9412, ['Kolda']],
    ['Médina Yoro Foulah', 13.1333, -14.6667, ['Médina Yoro Foulah']],
    ['Vélingara', 13.1500, -14.1167, ['Vélingara']],
  ]],

  ['Sédhiou', 12.7081, -15.5569, [
    ['Sédhiou', 12.7081, -15.5569, ['Sédhiou Ville']],
    ['Bounkiling', 13.0500, -15.7000, ['Bounkiling']],
    ['Goudomp', 12.5833, -15.8833, ['Goudomp']],
  ]],

  ['Ziguinchor', 12.5641, -16.2639, [
    ['Ziguinchor', 12.5641, -16.2639, ['Ziguinchor', 'Diembering']],
    ['Bignona', 12.8103, -16.2264, ['Bignona']],
    ['Oussouye', 12.4850, -16.5486, ['Oussouye']],
  ]],
];

async function upsertZone({ placeId, name, region, city, lat, lng, radiusKm, parentId }) {
  const data = {
    name,
    displayName: name,
    region,
    city: city || null,
    latitude: String(lat),
    longitude: String(lng),
    radiusKm: String(radiusKm),
    country: 'Sénégal',
    type: 'CIRCLE',
    status: 'approved',
    source: 'seed',
    isActive: true,
    parentId: parentId || null,
  };

  return prisma.zone.upsert({
    where: { placeId },
    update: data,
    create: { ...data, placeId },
  });
}

async function main() {
  console.log('🌍 Seed des zones du Sénégal (régions + départements + villes)...');

  let regionsCount = 0;
  let deptsCount = 0;
  let villesCount = 0;

  for (const [regionName, rLat, rLng, departments] of REGIONS) {
    // Créer la région
    const region = await upsertZone({
      placeId: `sn-region:${slug(regionName)}`,
      name: regionName,
      region: regionName,
      city: null,
      lat: rLat,
      lng: rLng,
      radiusKm: 60,
      parentId: null,
    });
    regionsCount++;
    console.log(`✅ Région: ${regionName}`);

    for (const [deptName, dLat, dLng, villes] of departments) {
      // Créer le département
      const dept = await upsertZone({
        placeId: `sn-dept:${slug(deptName)}`,
        name: deptName,
        region: regionName,
        city: deptName,
        lat: dLat,
        lng: dLng,
        radiusKm: 30,
        parentId: region.id,
      });
      deptsCount++;
      console.log(`  ✅ Département: ${deptName}`);

      // Créer les villes du département
      for (const ville of villes) {
        await upsertZone({
          placeId: `sn-ville:${slug(ville)}-${slug(regionName)}`,
          name: ville,
          region: regionName,
          city: ville,
          lat: dLat + (Math.random() - 0.5) * 0.05, // léger décalage pour ne pas superposer
          lng: dLng + (Math.random() - 0.5) * 0.05,
          radiusKm: 10,
          parentId: dept.id,
        });
        villesCount++;
      }
    }
  }

  console.log(`
📊 Résumé du seed:
  ✅ ${regionsCount} régions créées
  ✅ ${deptsCount} départements créés
  ✅ ${villesCount} villes créées
  ✅ Total: ${regionsCount + deptsCount + villesCount} zones

🌍 Seed des zones du Sénégal terminé avec succès !
  `);
}

main()
  .catch((e) => {
    console.error('❌ Seed zones échoué :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());