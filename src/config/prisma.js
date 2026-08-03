import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  // Les evenements sont rediriges vers Pino pour obtenir le meme format JSON
  // que l'API. Les requetes et leurs parametres ne sont jamais actives ici.
  log: [
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' }
  ]
});

prisma.$on('warn', (event) => {
  logger.warn({ component: 'prisma', target: event.target }, 'Prisma client warning');
});

prisma.$on('error', (event) => {
  // `event.message` peut contenir une requete ou une valeur fournie par un
  // utilisateur. Une contrainte attendue (P2002, P2025...) ne doit pas non plus
  // declencher une alerte critique ; le controleur classe l'erreur finale.
  logger.warn({ component: 'prisma', target: event.target }, 'Prisma client error');
});

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
