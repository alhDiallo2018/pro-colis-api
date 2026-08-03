import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectPrisma } from './config/prisma.js';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'PRO COLIS API started');
});

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal, exitCode }, 'Stopping PRO COLIS API');

  // Une erreur fatale ne doit pas laisser le processus bloque indefiniment si
  // une connexion reste ouverte. Docker redemarrera ensuite le conteneur.
  const forcedExit = setTimeout(() => process.exit(exitCode || 1), 10000);
  forcedExit.unref();

  server.close(async () => {
    await disconnectPrisma();
    clearTimeout(forcedExit);
    process.exit(exitCode);
  });
}

// Les callbacks explicites conservent le nom du signal dans les logs. Les
// listeners Node ne transmettent pas ce nom comme argument a la fonction.
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  logger.fatal({ err: error }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});
