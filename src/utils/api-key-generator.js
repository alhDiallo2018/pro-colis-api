/**
 * Génération sûre d'une clé API partenaire.
 *
 * Format : `<keyId>.<secret>` où
 *   - keyId  : préfixe stable `biz_` + 10 caractères alphanumériques,
 *   - secret : 40 caractères base64url (≈ 240 bits d'entropie).
 *
 * Le secret est AFFICHÉ UNE SEULE FOIS au moment de la création (ou de la
 * rotation) et est immédiatement haché (sha256) côté serveur. Il ne doit
 * jamais être redistribué ni stocké en clair ailleurs.
 *
 * Service pur — aucune dépendance DB. Testable isolément.
 */

import { randomBytes } from 'node:crypto';

const KEY_ID_PREFIX = 'biz_';
const KEY_ID_RANDOM_LEN = 10;
const SECRET_BYTES = 30; // → 40 chars base64url

const KEY_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';

function randomKeyId() {
  const bytes = randomBytes(KEY_ID_RANDOM_LEN);
  let out = '';
  for (let i = 0; i < KEY_ID_RANDOM_LEN; i++) {
    out += KEY_ID_ALPHABET[bytes[i] % KEY_ID_ALPHABET.length];
  }
  return KEY_ID_PREFIX + out;
}

/**
 * Génère une nouvelle paire { keyId, secret }. Le secret doit être remis
 * à l'utilisateur immédiatement et ne peut pas être retrouvé après.
 */
export function generateApiKey() {
  return {
    keyId: randomKeyId(),
    secret: randomBytes(SECRET_BYTES).toString('base64url')
  };
}

export const API_KEY_CONSTANTS = Object.freeze({
  KEY_ID_PREFIX,
  KEY_ID_RANDOM_LEN,
  SECRET_BYTES
});
