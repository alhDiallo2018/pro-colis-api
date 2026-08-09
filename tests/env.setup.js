import 'dotenv/config';

/**
 * Les tests creent et effacent des donnees : ils doivent viser la base dediee
 * `procolis_test`, jamais la base de developpement.
 *
 * L'URL est deduite de DATABASE_URL plutot que redefinie : identifiants, hote,
 * port et parametre de socket restent en un seul endroit (.env). C'est ce qui
 * manquait auparavant — les scripts npm figeaient l'ancienne base Docker.
 *
 * Le nom force se termine toujours par `_test` : meme mal configuree, la suite
 * ne peut pas tomber sur la base de travail.
 */
const TEST_DATABASE = 'procolis_test';

if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.pathname.endsWith('_test')) {
    url.pathname = `/${TEST_DATABASE}`;
    process.env.DATABASE_URL = url.href;
  }
}
