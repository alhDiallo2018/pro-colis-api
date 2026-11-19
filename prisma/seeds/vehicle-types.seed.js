// Seed du referentiel `vehicle_types`.
//
// Les cinq premieres entrees reprennent la liste hardcodee du web
// (`CreateAnnonceDialog`) pour que la selection "shuttle" continue a
// matcher les valeurs stockees sur les vehicules existants. Les trois
// dernieres (moto/car/truck) correspondent aux categories deja utilisees
// par le reste du front mobile.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const items = [
  { code: 'bus',      label: 'Bus',       category: 'shuttle', sortOrder: 10 },
  { code: 'tata',     label: 'Tata',      category: 'shuttle', sortOrder: 20 },
  { code: 'horaire',  label: 'Horaire',   category: 'shuttle', sortOrder: 30 },
  { code: 'minibus',  label: 'Minibus',   category: 'shuttle', sortOrder: 40 },
  { code: 'autobus',  label: 'Autobus',   category: 'shuttle', sortOrder: 50 },
  { code: 'moto',     label: 'Moto',      category: 'moto',    sortOrder: 60 },
  { code: 'car',      label: 'Voiture',   category: 'car',     sortOrder: 70 },
  { code: 'truck',    label: 'Camion',    category: 'truck',   sortOrder: 80 },
  { code: 'van',      label: 'Van',       category: 'car',     sortOrder: 90 }
];

export async function seedVehicleTypes() {
  for (const item of items) {
    await prisma.vehicleType.upsert({
      where: { code: item.code },
      // Les champs metier (label, categorie, ordre) sont rafraichis ; `isActive`
      // n'est pas force pour respecter une desactivation manuelle en prod.
      update: { label: item.label, category: item.category, sortOrder: item.sortOrder },
      create: { ...item, isActive: true }
    });
  }
  console.log(`[seed] vehicle_types: ${items.length} entrees synchronisees`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedVehicleTypes()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
