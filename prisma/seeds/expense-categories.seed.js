// Seed du referentiel `expense_categories`.
//
// Les huit entrees couvrent les categories deja presentes dans le code web
// (`ExpensesPage`) plus trois charges recurrentes de l'exploitation
// (electricite, eau, internet) demandees par la comptabilite.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const items = [
  { code: 'rent',         label: 'Loyer',        sortOrder: 10 },
  { code: 'salaries',     label: 'Salaires',     sortOrder: 20 },
  { code: 'fuel',         label: 'Carburant',    sortOrder: 30 },
  { code: 'maintenance',  label: 'Maintenance',  sortOrder: 40 },
  { code: 'electricity',  label: 'Électricité',  sortOrder: 50 },
  { code: 'water',        label: 'Eau',          sortOrder: 60 },
  { code: 'internet',     label: 'Internet',     sortOrder: 70 },
  { code: 'other',        label: 'Autres',       sortOrder: 80 }
];

export async function seedExpenseCategories() {
  for (const item of items) {
    await prisma.expenseCategory.upsert({
      where: { code: item.code },
      update: { label: item.label, sortOrder: item.sortOrder },
      create: { ...item, isActive: true }
    });
  }
  console.log(`[seed] expense_categories: ${items.length} entrees synchronisees`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedExpenseCategories()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
