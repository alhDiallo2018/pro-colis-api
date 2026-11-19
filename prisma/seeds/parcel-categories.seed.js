// Seed du referentiel `parcel_categories`.
//
// Les cinq premiers codes miroitent l'enum Prisma `ParcelType`
// (`document`, `package`, `fragile`, `perishable`, `valuable`) pour que le
// front puisse basculer sur la table sans divergence. Les deux dernieres
// entrees (`electronics`, `clothing`) ajoutent des categories demandees par
// les clients e-commerce ; elles restent cosmetiques tant que la colonne
// `parcels.type` reste typee sur l'enum.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const items = [
  { code: 'document',    label: 'Document',                 icon: 'description',   isFragile: false, maxWeightKg: 2,    sortOrder: 10 },
  { code: 'package',     label: 'Colis standard',           icon: 'inventory_2',   isFragile: false, maxWeightKg: 30,   sortOrder: 20 },
  { code: 'fragile',     label: 'Fragile',                  icon: 'egg_alt',       isFragile: true,  maxWeightKg: 15,   sortOrder: 30 },
  { code: 'perishable',  label: 'Alimentaire / Périssable', icon: 'restaurant',    isFragile: true,  maxWeightKg: 25,   sortOrder: 40 },
  { code: 'valuable',    label: 'Objet de valeur',          icon: 'diamond',       isFragile: true,  maxWeightKg: 5,    sortOrder: 50 },
  { code: 'electronics', label: 'Électronique',             icon: 'devices',       isFragile: true,  maxWeightKg: 20,   sortOrder: 60 },
  { code: 'clothing',    label: 'Vêtements',                icon: 'checkroom',     isFragile: false, maxWeightKg: 30,   sortOrder: 70 }
];

export async function seedParcelCategories() {
  for (const item of items) {
    await prisma.parcelCategory.upsert({
      where: { code: item.code },
      update: {
        label: item.label,
        icon: item.icon,
        isFragile: item.isFragile,
        maxWeightKg: item.maxWeightKg,
        sortOrder: item.sortOrder
      },
      create: { ...item, isActive: true }
    });
  }
  console.log(`[seed] parcel_categories: ${items.length} entrees synchronisees`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedParcelCategories()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
