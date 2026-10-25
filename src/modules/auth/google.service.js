import { createHash, randomBytes, randomInt } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { AppError, ConflictError, UnauthorizedError } from '../../utils/errors.js';
import { compareSecret, hashSecret } from '../../utils/tokens.js';
import { sendOtpSms } from '../../utils/brevo.js';
import { openGoogleSession } from './auth.service.js';

const google = new OAuth2Client();
const digest = value => createHash('sha256').update(value).digest('hex');
const invalidChallenge = () => new UnauthorizedError('Cette demande a expiré. Reconnectez-vous avec Google.', 'GOOGLE_CHALLENGE_EXPIRED');
const invalidProof = () => new UnauthorizedError('Code incorrect. Vérifiez votre saisie.', 'GOOGLE_PROOF_INVALID');

export function googleConfiguration() {
  return { enabled: Boolean(env.GOOGLE_WEB_CLIENT_ID), serverClientId: env.GOOGLE_WEB_CLIENT_ID || null };
}

export async function startGoogle({ idToken }) {
  if (!env.GOOGLE_WEB_CLIENT_ID) {
    throw new AppError('La connexion Google est momentanément indisponible.', { statusCode: 503, code: 'GOOGLE_UNAVAILABLE' });
  }
  let claims;
  try {
    // verifyIdToken controle signature, audience, expiration et emetteur.
    // Ne jamais accepter un email/sub transmis directement par le mobile.
    const ticket = await google.verifyIdToken({ idToken, audience: env.GOOGLE_WEB_CLIENT_ID });
    claims = ticket.getPayload();
  } catch {
    // Les erreurs du SDK peuvent contenir le jeton fourni : ne pas les propager.
    throw new UnauthorizedError('Connexion Google impossible. Veuillez réessayer.', 'GOOGLE_TOKEN_INVALID');
  }
  if (!claims?.sub || !claims.email || claims.email_verified !== true) {
    throw new UnauthorizedError('Une adresse email Google vérifiée est nécessaire.', 'GOOGLE_EMAIL_UNVERIFIED');
  }
  const existing = await prisma.user.findUnique({ where: { googleSubject: claims.sub } });
  if (existing) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${existing.id}::uuid FOR UPDATE`;
      return openGoogleSession(existing.id, tx);
    });
  }
  const email = claims.email.trim().toLowerCase();
  const matching = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  const challengeToken = randomBytes(32).toString('hex');
  // Nettoyage borne dans le temps ; ne conserve pas indefiniment des profils
  // abandonnes. Les challenges recents restent disponibles pour les retries.
  await prisma.googleAuthChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } });
  const challenge = await prisma.googleAuthChallenge.create({ data: {
    tokenHash: digest(challengeToken), googleSubject: claims.sub,
    email, fullName: String(claims.name || '').slice(0, 100),
    linkUserId: matching?.id || null, expiresAt: new Date(Date.now() + 600000)
  } });
  return { status: matching ? 'link_required' : 'profile_required', challengeToken,
    email, fullName: challenge.fullName, expiresAt: challenge.expiresAt };
}

/** Verrou BD contre doubles clics/rejeux. Les tentatives invalides doivent
 * etre COMMIT avant de lever l'erreur, sinon le compteur serait annule.
 */
async function withChallenge(challengeToken, operation) {
  const tokenHash = digest(challengeToken);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM google_auth_challenges WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const challenge = await tx.googleAuthChallenge.findUnique({ where: { tokenHash } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) {
      return { error: invalidChallenge() };
    }
    return operation(tx, challenge);
  }, { maxWait: 10000, timeout: 15000 });
  if (result.error) throw result.error;
  return result;
}

async function failedProof(tx, challenge) {
  await tx.googleAuthChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
  return { error: invalidProof() };
}

export async function linkGoogle({ challengeToken, identifier, pin }) {
  return withChallenge(challengeToken, async (tx, challenge) => {
    const user = await tx.user.findFirst({ where: { OR: [
      { phone: identifier }, { email: { equals: identifier, mode: 'insensitive' } }
    ] } });
    if (!user || (challenge.linkUserId && challenge.linkUserId !== user.id)) return failedProof(tx, challenge);
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
    const fresh = await tx.user.findUnique({ where: { id: user.id } });
    if (!fresh?.pinHash || fresh.status !== 'active' || fresh.deletedAt || !await compareSecret(pin, fresh.pinHash)) {
      return failedProof(tx, challenge);
    }
    if (fresh.googleSubject && fresh.googleSubject !== challenge.googleSubject) {
      throw new ConflictError('Ce compte est déjà associé à un autre compte Google.');
    }
    const linked = await tx.user.findUnique({ where: { googleSubject: challenge.googleSubject } });
    if (linked && linked.id !== fresh.id) throw new ConflictError('Ce compte Google est déjà associé.');
    await tx.user.update({ where: { id: fresh.id }, data: { googleSubject: challenge.googleSubject } });
    await tx.googleAuthChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date(), otpHash: null } });
    await tx.auditLog.create({ data: { actorId: fresh.id, actorRole: fresh.role,
      action: 'auth.google.link', entityType: 'user', entityId: fresh.id } });
    return openGoogleSession(fresh.id, tx);
  });
}

export async function sendGooglePhoneOtp({ challengeToken, phone }) {
  const code = String(randomInt(100000, 1000000));
  const otpHash = await hashSecret(code);
  await withChallenge(challengeToken, async (tx, challenge) => {
    if (challenge.linkUserId) throw new ConflictError('Connectez-vous avec le PIN de votre compte existant.');
    if (challenge.otpSentAt && Date.now() - challenge.otpSentAt.getTime() < 60000) {
      throw new AppError('Veuillez patienter une minute avant de renvoyer un code.', { statusCode: 429, code: 'OTP_COOLDOWN' });
    }
    await tx.googleAuthChallenge.update({ where: { id: challenge.id }, data: { phone, otpHash, otpSentAt: new Date() } });
    return { sent: true };
  });
  try {
    // Attendre l'envoi reel : un service SMS en panne ne doit pas produire un
    // faux succes. Aucun OTP n'est renvoye au mobile, meme en developpement.
    const delivery = await sendOtpSms({ phone, code, purpose: 'verification' });
    if (!delivery) throw new Error('OTP delivery unavailable');
    return { sent: true, retryAfterSeconds: 60 };
  } catch {
    // Ne pas invalider un code plus recent si plusieurs envois se croisent.
    await prisma.googleAuthChallenge.updateMany({ where: { tokenHash: digest(challengeToken), otpHash },
      data: { otpHash: null, otpSentAt: null } });
    throw new AppError('Envoi du SMS impossible. Veuillez réessayer.', { statusCode: 503, code: 'OTP_DELIVERY_UNAVAILABLE' });
  }
}

export async function registerGoogle({ challengeToken, phone, otpCode, fullName, pin, role, acceptedTerms }) {
  if (!acceptedTerms || !['client', 'driver'].includes(role)) throw new ConflictError('Profil ou conditions invalides.');
  const pinHash = await hashSecret(pin);
  return withChallenge(challengeToken, async (tx, challenge) => {
    if (challenge.linkUserId) throw new ConflictError('Connectez-vous avec le PIN de votre compte existant.');
    if (challenge.phone !== phone || !challenge.otpHash || !await compareSecret(otpCode, challenge.otpHash)) {
      return failedProof(tx, challenge);
    }
    const existing = await tx.user.findFirst({ where: { OR: [
      { phone }, { email: { equals: challenge.email, mode: 'insensitive' } }, { googleSubject: challenge.googleSubject }
    ] } });
    if (existing) {
      // La possession du telephone ne remplace jamais le PIN d'un compte
      // existant ; une inscription ne modifie ni son role ni ses coordonnees.
      await tx.googleAuthChallenge.update({ where: { id: challenge.id }, data: { linkUserId: existing.id, otpHash: null } });
      return { status: 'link_required', identifier: existing.phone, email: challenge.email };
    }
    const user = await tx.user.create({ data: {
      phone, email: challenge.email, fullName, pinHash, googleSubject: challenge.googleSubject,
      role, driverStatus: role === 'driver' ? 'offline' : null,
      isEmailVerified: true, isPhoneVerified: true, isProfileComplete: true
    } });
    await tx.score.create({ data: { userId: user.id } });
    await tx.auditLog.create({ data: { actorId: user.id, actorRole: user.role,
      action: 'user.create', entityType: 'user', entityId: user.id,
      afterData: { provider: 'google', role, acceptedTerms: true } } });
    await tx.googleAuthChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date(), otpHash: null } });
    return openGoogleSession(user.id, tx);
  });
}
