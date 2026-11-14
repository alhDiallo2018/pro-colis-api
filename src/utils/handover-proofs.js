import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Génère un PIN à 6 chiffres remis au chauffeur entrant hors bande (SMS, chat,
 * oralement). Jamais persisté en clair : seul son hash SHA-256 est stocké.
 *
 * `randomInt` est cryptographiquement sûr (crypto natif Node ≥ 15).
 */
export function generatePickupPin() {
  return String(randomInt(100000, 1000000));
}

/**
 * Génère un token QR opaque (encodé base64url, 24 octets) à scanner par le
 * chauffeur entrant. Comme pour le PIN, seul le hash est persisté.
 */
export function generatePickupQrToken() {
  return randomBytes(24).toString('base64url');
}

export function hashProof(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Compare un claim (PIN ou QR token envoyé par le chauffeur entrant) au hash
 * stocké. Compare les hashs pour garder un temps constant via SHA-256.
 */
export function proofMatches(claim, storedHash) {
  if (!storedHash) return false;
  const claimed = hashProof(String(claim ?? ''));
  if (claimed.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < claimed.length; i++) {
    diff |= claimed.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}
