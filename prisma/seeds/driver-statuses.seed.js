// Seed du referentiel `driver_status_options`.
//
// Les trois premiers codes miroitent l'enum Prisma `DriverStatus`
// (`available`, `busy`, `offline`). `on_leave` est un ajout UI qui permet
// aux admins d'identifier les chauffeurs en conge sans impacter l'enum DB.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const items = [
  { code: 'available', label: 'Disponible', color: '#22c55e', sortOrder: 10 },
  { code: 'busy',      label: 'Occupé',     color: '#f97316', sortOrder: 20 },
  { code: 'offline',   label: 'Hors ligne', color: '#94a3b8', sortOrder: 30 },
  { code: 'on_leave',  label: 'En congé',   color: '#3b82f6', sortOrder: 40 }
];

export async function seedDriverStatuses() {
  for (const item of items) {
    await prisma.driverStatusOption.upsert({
      where: { code: item.code },
      update: { label: item.label, color: item.color, sortOrder: item.sortOrder },
      create: { ...item, isActive: true }
    });
  }
  console.log(`[seed] driver_status_options: ${items.length} entrees synchronisees`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDriverStatuses()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
