// Seed du referentiel `document_types`.
//
// Les quatre premiers codes reprennent exactement les cles utilisees par
// `VehicleDocumentsScreen` du web (`driver_license`, `vehicle_registration`,
// `insurance`, `id_card`). On conserve `id_card` tel quel pour ne pas casser
// les URL recto/verso deja stockees sur les comptes existants.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const items = [
  { code: 'driver_license',       label: 'Permis de conduire',      appliesTo: 'driver',  isRequired: true,  sortOrder: 10 },
  { code: 'vehicle_registration', label: 'Carte grise',             appliesTo: 'vehicle', isRequired: true,  sortOrder: 20 },
  { code: 'insurance',            label: 'Assurance',               appliesTo: 'vehicle', isRequired: true,  sortOrder: 30 },
  { code: 'id_card',              label: "Pièce d'identité (CNI)",  appliesTo: 'driver',  isRequired: true,  sortOrder: 40 },
  { code: 'national_id',          label: "Pièce d'identité",         appliesTo: 'user',    isRequired: false, sortOrder: 50 }
];

export async function seedDocumentTypes() {
  for (const item of items) {
    await prisma.documentType.upsert({
      where: { code: item.code },
      update: {
        label: item.label,
        appliesTo: item.appliesTo,
        isRequired: item.isRequired,
        sortOrder: item.sortOrder
      },
      create: { ...item, isActive: true }
    });
  }
  console.log(`[seed] document_types: ${items.length} entrees synchronisees`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDocumentTypes()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
