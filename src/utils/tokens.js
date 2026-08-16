import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

// Un compte staff lit les colis, les paiements et les messages de toute la
// plateforme : sa session doit se refermer en heures, la ou un client garde la
// sienne des semaines sans que cela expose autre chose que ses propres donnees.
export const STAFF_ROLES = ['super_admin', 'admin', 'support', 'support_technique', 'support_commercial'];

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

/** Duree de vie du refresh token, dans le format accepte par `jsonwebtoken`. */
export function refreshTokenTtl(role) {
  return isStaffRole(role) ? env.JWT_REFRESH_EXPIRES_IN_STAFF : env.JWT_REFRESH_EXPIRES_IN;
}

const DURATION_UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Convertit `15m` / `12h` / `30d` / `900` en millisecondes.
 *
 * La date `expiresAt` stockee en base doit venir de la meme chaine que le JWT :
 * quand les deux divergeaient, raccourcir la variable d'environnement ne
 * fermait que la moitie de la session.
 */
export function durationToMs(duration) {
  const match = /^(\d+)([smhd]?)$/.exec(String(duration));
  if (!match) throw new Error(`Duree invalide : ${duration}`);
  const [, amount, unit] = match;
  return Number(amount) * (unit ? DURATION_UNITS[unit] : 1000);
}

export function refreshTokenExpiresAt(role, from = new Date()) {
  return new Date(from.getTime() + durationToMs(refreshTokenTtl(role)));
}

/**
 * `sid` rattache l'access token a sa ligne de session.
 *
 * Sans ce lien, une requete authentifiee ne peut pas dire de quelle session
 * elle releve : impossible alors d'y dater l'activite, donc impossible de
 * fermer la session sur inactivite. Optionnel, car les jetons emis avant cette
 * version n'en portent pas et doivent rester acceptes jusqu'a leur expiration.
 */
export function signAccessToken(user, sid) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      status: user.status,
      garageId: user.garageId,
      ...(sid ? { sid } : {})
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
  );
}

/** Delai d'inactivite, en millisecondes. */
export function sessionIdleTimeoutMs() {
  return durationToMs(env.SESSION_IDLE_TIMEOUT);
}

/**
 * Le `jti` rend la ligne de session retrouvable en O(1).
 *
 * Sans lui, verifier un refresh token impose un `bcrypt.compare` sur chaque
 * ligne du compte — supportable tant qu'il n'y a qu'une session, ruineux des
 * que la rotation empile une ligne revoquee par renouvellement.
 */
export function signRefreshToken(user, jti = randomUUID()) {
  const token = jwt.sign({ sub: user.id, jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: refreshTokenTtl(user.role)
  });
  return { token, jti };
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}

export async function hashSecret(secret) {
  return bcrypt.hash(secret, 12);
}

export async function compareSecret(secret, hash) {
  return bcrypt.compare(secret, hash);
}
