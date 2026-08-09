import 'dotenv/config';

/**
 * Derive une URL de connexion vers une autre base du meme serveur.
 *
 * La suite de tests vise `procolis_test` alors que le developpement vise
 * `procolis` : plutot que de dupliquer identifiants, hote et port dans les
 * scripts npm — ce qui les avait figes sur l'ancienne base Docker — on repart
 * de DATABASE_URL et on ne remplace que le nom de la base.
 *
 * Usage : node scripts/db-url.mjs procolis_test
 */
const database = process.argv[2];
if (!database) {
  console.error('Usage : node scripts/db-url.mjs <nom_de_base>');
  process.exit(1);
}

const source = process.env.DATABASE_URL;
if (!source) {
  console.error('DATABASE_URL absente : renseignez-la dans .env (voir deploy/setup-local-db.sh).');
  process.exit(1);
}

const url = new URL(source);
url.pathname = `/${database}`;
console.log(url.href);
