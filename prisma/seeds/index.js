// Orchestrateur des seeds de referentiels. Permet de reinitialiser les trois
// listes editables (`vehicle_types`, `document_types`, `expense_categories`)
// en un seul appel : `node prisma/seeds/index.js`.
import { PrismaClient } from '@prisma/client';
import { seedVehicleTypes } from './vehicle-types.seed.js';
import { seedDocumentTypes } from './document-types.seed.js';
import { seedExpenseCategories } from './expense-categories.seed.js';

const prisma = new PrismaClient();

async function main() {
  await seedVehicleTypes();
  await seedDocumentTypes();
  await seedExpenseCategories();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
