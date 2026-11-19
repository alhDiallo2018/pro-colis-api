// Seed du referentiel `payment_method_options`.
//
// Les codes reprennent les valeurs manipulees cote front/mobile
// (`cash`, `wave`, `orange_money`, `mobile_money`, `bank_transfer`,
// `paydunya`). Le modele Prisma s'appelle `PaymentMethodOption` pour ne pas
// entrer en collision avec l'enum Prisma `PaymentMethod` encore utilise
// cote parcels ; les deux cohabitent le temps de la migration.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const items = [
  { code: 'cash',          label: 'Espèces',               provider: null,       channel: 'cash',     sortOrder: 10 },
  { code: 'mobile_money',  label: 'Mobile Money',          provider: null,       channel: 'in_app',   sortOrder: 20 },
  { code: 'orange_money',  label: 'Orange Money',          provider: 'orange',   channel: 'in_app',   sortOrder: 30 },
  { code: 'wave',          label: 'Wave',                  provider: 'wave',     channel: 'in_app',   sortOrder: 40 },
  { code: 'bank_transfer', label: 'Virement bancaire',     provider: null,       channel: 'external', sortOrder: 50 },
  { code: 'paydunya',      label: 'PayDunya (carte, MM)',  provider: 'paydunya', channel: 'in_app',   sortOrder: 60 }
];

export async function seedPaymentMethods() {
  for (const item of items) {
    await prisma.paymentMethodOption.upsert({
      where: { code: item.code },
      update: {
        label: item.label,
        provider: item.provider,
        channel: item.channel,
        sortOrder: item.sortOrder
      },
      create: { ...item, isActive: true }
    });
  }
  console.log(`[seed] payment_method_options: ${items.length} entrees synchronisees`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedPaymentMethods()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
