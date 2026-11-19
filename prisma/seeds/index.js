// Orchestrateur des seeds de referentiels. Permet de reinitialiser les sept
// listes editables (`vehicle_types`, `document_types`, `expense_categories`,
// `parcel_categories`, `payment_method_options`, `driver_status_options`,
// `incident_severity_levels`) en un seul appel :
// `node prisma/seeds/index.js`.
import { PrismaClient } from '@prisma/client';
import { seedVehicleTypes } from './vehicle-types.seed.js';
import { seedDocumentTypes } from './document-types.seed.js';
import { seedExpenseCategories } from './expense-categories.seed.js';
import { seedParcelCategories } from './parcel-categories.seed.js';
import { seedPaymentMethods } from './payment-methods.seed.js';
import { seedDriverStatuses } from './driver-statuses.seed.js';
import { seedIncidentSeverities } from './incident-severities.seed.js';

const prisma = new PrismaClient();

async function main() {
  await seedVehicleTypes();
  await seedDocumentTypes();
  await seedExpenseCategories();
  await seedParcelCategories();
  await seedPaymentMethods();
  await seedDriverStatuses();
  await seedIncidentSeverities();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
