import { normalizeVehicleType } from '../../utils/vehicle-types.js';
import bcrypt from 'bcryptjs';
import { releaseSupportSession } from '../support/chat.service.js';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { touchSession, withSessionLock } from './session.service.js';
import { ConflictError, UnauthorizedError, ValidationError } from '../../utils/errors.js';
import {
  compareSecret,
  durationToMs,
  hashSecret,
  refreshTokenExpiresAt,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from '../../utils/tokens.js';
import { serializeUser } from '../../utils/mobile-serializers.js';

// Relations a charger des qu'un utilisateur est renvoye au client : sans
// elles, `garageName` et les champs vehicule sont absents de la reponse.
const USER_INCLUDE = {
  garage: true,
  vehicles: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1
  },
  // Zone de rattachement : la reponse de connexion alimente directement la
  // session des clients, qui s'en servent pour l'ecran « Ma zone ».
  driverZones: {
    include: { zone: { select: { id: true, name: true, displayName: true } } },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
  }
};


/**
 * Emet un couple access/refresh et ouvre la ligne de session correspondante.
 *
 * `expiresAt` est derive de la meme configuration que le JWT (et donc du role) :
 * l'ancienne version ecrivait 30 jours en dur, si bien qu'une session staff
 * raccourcie par configuration serait restee ouverte un mois cote base.
 */
async function createTokenPair(user, client = prisma) {
  const now = new Date();
  const expiresAt = refreshTokenExpiresAt(user.role, now);
  const { token: refreshToken, jti } = signRefreshToken(user, undefined, now, expiresAt);
  const tokenHash = await hashSecret(refreshToken);

  await client.refreshToken.create({
    data: {
      userId: user.id,
      jti,
      tokenHash,
      expiresAt,
      createdAt: now,
      lastUsedAt: now
    }
  });

  // L'access token est signe apres la session : il en porte l'identifiant, ce
  // qui permet a chaque requete de dater l'activite de cette session precise.
  return { accessToken: signAccessToken(user, jti), refreshToken };
}

/** Une connexion Google utilise exactement les memes sessions que le PIN.
 * Le client transactionnel permet de consommer le challenge et d'ouvrir la
 * session atomiquement, sans compte partiellement associe en cas d'erreur.
 */
export async function openGoogleSession(userId, client = prisma) {
  const user = await client.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'active' || user.deletedAt) {
    throw new UnauthorizedError('Connexion impossible pour ce compte');
  }
  const updated = await client.user.update({
    where: { id: userId }, data: { lastLogin: new Date(), lastActiveAt: new Date() }, include: USER_INCLUDE
  });
  return { status: 'authenticated', user: serializeUser(updated), ...await createTokenPair(updated, client) };
}

/** Coupe toutes les sessions ouvertes d'un compte. */
async function revokeAllSessions(userId, reason, client = prisma) {
  return client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason }
  });
}

/**
 * Retrouve la ligne de session designee par un refresh token.
 *
 * Chemin nominal : le JWT porte un `jti`, une seule ligne est candidate et un
 * seul `bcrypt.compare` tranche. Chemin de repli : les jetons emis avant la
 * rotation n'ont pas de `jti`, il faut alors balayer les sessions actives —
 * elles sont peu nombreuses puisque l'ancien schema n'en creait qu'une par
 * connexion. Ce repli disparaitra de lui-meme a l'expiration des jetons.
 */
async function findSessionForToken(userId, refreshToken, jti) {
  if (jti) {
    const session = await prisma.refreshToken.findUnique({ where: { jti } });
    if (!session || session.userId !== userId) return null;
    return (await compareSecret(refreshToken, session.tokenHash)) ? session : null;
  }

  const candidates = await prisma.refreshToken.findMany({
    where: { userId, jti: null, revokedAt: null, expiresAt: { gt: new Date() } }
  });

  for (const candidate of candidates) {
    if (await compareSecret(refreshToken, candidate.tokenHash)) return candidate;
  }
  return null;
}

export async function registerUser(payload) {
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ phone: payload.phone }, ...(payload.email ? [{ email: payload.email }] : [])]
    }
  });

  if (existingUser) {
    throw new ConflictError('Un utilisateur existe deja avec ces informations');
  }

  const passwordHash = payload.password ? await bcrypt.hash(payload.password, 12) : null;
  const pinHash = payload.pin ? await bcrypt.hash(payload.pin, 12) : null;

  // Whitelist serveur : l'inscription publique n'autorise que CLIENT et DRIVER.
  // Le rôle du body n'est jamais repris tel quel (défense en profondeur, même si
  // le validateur le restreint déjà) : toute valeur inconnue ou privilégiée
  // retombe sur `client`, jamais sur un rôle staff.
  const role = payload.role === 'driver' ? 'driver' : 'client';
  // Les données fournies à l'inscription doivent alimenter la même table que
  // le profil chauffeur. Sinon la catégorie était perdue après connexion.
  let vehicleData = null;
  if (role === 'driver' && (payload.vehicleType || payload.vehiclePlate || payload.vehicleModel)) {
    const type = normalizeVehicleType(payload.vehicleType, 'vehicleType');
    const plateNumber = payload.vehiclePlate?.trim();
    const model = payload.vehicleModel?.trim();
    if (type !== 'gp' && (!plateNumber || !model)) throw new ValidationError([{ path: 'vehicle', message: 'Plaque et modèle requis pour enregistrer le véhicule' }]);
    if (plateNumber && await prisma.vehicle.findUnique({ where: { plateNumber } })) throw new ConflictError('Cette plaque est déjà enregistrée');
    vehicleData = { type, plateNumber, model: model || 'GP', capacity: payload.vehicleCapacity ?? 0 };
  }


  // Registration creates the user, initial score row and audit entry atomically.
  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email: payload.email,
        phone: payload.phone,
        fullName: payload.fullName,
        passwordHash,
        pinHash,
        role,
        address: payload.address,
        city: payload.city,
        region: payload.region,
        garageId: payload.garageId,
        driverStatus: role === 'driver' ? 'offline' : null,
        isProfileComplete: Boolean(payload.fullName && payload.phone)
      },
      include: USER_INCLUDE
    });

    if (vehicleData) {
      await tx.vehicle.create({ data: { ...vehicleData,
        // GP désigne un transporteur ; ne pas lui inventer une immatriculation routière.
        plateNumber: vehicleData.plateNumber || `GP-${createdUser.id}`,
        driverId: createdUser.id, garageId: payload.garageId || null } });
    }
    await tx.score.create({ data: { userId: createdUser.id } });
    await tx.auditLog.create({
      data: {
        actorId: createdUser.id,
        actorRole: createdUser.role,
        action: 'user.create',
        entityType: 'user',
        entityId: createdUser.id,
        afterData: { role: createdUser.role, phone: createdUser.phone }
      }
    });

    return vehicleData ? tx.user.findUnique({ where: { id: createdUser.id }, include: USER_INCLUDE }) : createdUser;
  });

  const tokens = await createTokenPair(user);
  return { user: serializeUser(user), ...tokens };
}

export async function loginWithPin({ identifier, pin }) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ phone: identifier }, { email: identifier }]
    }
  });

  if (!user || !user.pinHash || user.status !== 'active') {
    throw new UnauthorizedError('Identifiants invalides');
  }

  const pinMatches = await compareSecret(pin, user.pinHash);
  if (!pinMatches) {
    throw new UnauthorizedError('Identifiants invalides');
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date(), lastActiveAt: new Date() },
    include: USER_INCLUDE
  });

  const tokens = await createTokenPair(updatedUser);
  return { user: serializeUser(updatedUser), ...tokens };
}

/**
 * Consomme un refresh sous verrou BD, puis ouvre un unique successeur dans la
 * meme famille. Les retries proches rendent le successeur existant, sans
 * prolonger la fenetre de grace ; un rejeu tardif ne ferme que cet appareil.
 */
export async function refreshAccessToken(refreshToken) {
  const payload = verifyRefreshToken(refreshToken);
  const found = await findSessionForToken(payload.sub, refreshToken, payload.jti);
  if (!found) throw new UnauthorizedError('Refresh token invalide', 'REFRESH_TOKEN_INVALID');

  const result = await withSessionLock(payload.sub, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: payload.sub }, include: USER_INCLUDE });
    if (!user || user.status !== 'active') {
      return { error: new UnauthorizedError('Session invalide', 'SESSION_INVALID') };
    }
    // La lecture apres le verrou est indispensable : un autre serveur peut
    // avoir consomme le jeton pendant sa verification cryptographique.
    const session = await tx.refreshToken.findUnique({ where: { id: found.id } });
    const now = new Date();
    if (!session) return { error: new UnauthorizedError('Session fermee', 'SESSION_REVOKED') };

    if (session.revokedReason === 'rotated') {
      const withinGrace = now.getTime() - session.revokedAt.getTime() <= env.REFRESH_RETRY_GRACE_SECONDS * 1000;
      if (!withinGrace) {
        await tx.refreshToken.updateMany({
          where: { familyId: session.familyId, userId: user.id, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'reuse' }
        });
        logger.warn({ action: 'auth.session.revoked', reason: 'reuse', userId: user.id, familyId: session.familyId }, 'Rejeu hors delai : famille revoquee');
        return { error: new UnauthorizedError('Session revoquee, reconnexion requise', 'REFRESH_TOKEN_REUSED') };
      }
      const next = await tx.refreshToken.findFirst({ where: { familyId: session.familyId, userId: user.id, revokedAt: null } });
      if (!next) return { error: new UnauthorizedError('Session fermee', 'SESSION_REVOKED') };
      const error = await touchSession(tx, next, user.role, now);
      if (error) return { error };
      return {
        user: serializeUser(user), accessToken: signAccessToken(user, next.jti),
        refreshToken: signRefreshToken(user, next.jti, next.createdAt, next.expiresAt).token
      };
    }
    if (session.revokedAt) return { error: new UnauthorizedError('Session fermee', 'SESSION_REVOKED') };
    const error = await touchSession(tx, session, user.role, now);
    if (error) return { error };

    const expiresAt = refreshTokenExpiresAt(user.role, now);
    const { token, jti } = signRefreshToken(user, undefined, now, expiresAt);
    const tokenHash = await hashSecret(token);
    await tx.refreshToken.update({ where: { id: session.id }, data: { revokedAt: now, revokedReason: 'rotated' } });
    await tx.refreshToken.create({ data: {
      userId: user.id, familyId: session.familyId, jti, tokenHash,
      expiresAt, createdAt: now, lastUsedAt: now
    } });
    // Conserver les ancetres tant qu'un access token pourrait encore les citer.
    await tx.refreshToken.deleteMany({ where: {
      userId: user.id, expiresAt: { lt: new Date(now.getTime() - durationToMs(env.JWT_ACCESS_EXPIRES_IN)) }
    } });
    return { user: serializeUser(user), accessToken: signAccessToken(user, jti), refreshToken: token };
  });
  // Lever apres le commit conserve les revocations idle/reuse en base.
  if (result.error) throw result.error;
  return result;
}

/** Un logout ferme aussi le successeur si une rotation etait deja en vol. */
export async function logout(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    if (error.statusCode === 401) return { loggedOut: true };
    throw error;
  }
  const session = await findSessionForToken(payload.sub, refreshToken, payload.jti);
  if (session) {
    await withSessionLock(payload.sub, (tx) => tx.refreshToken.updateMany({
      where: { userId: payload.sub, familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' }
    }));
    await releaseSupportSession(payload.sub, session.familyId);
  }
  return { loggedOut: true };
}

/** Le meme verrou empeche un refresh en vol de survivre au logout global. */
export async function logoutAllSessions(userId) {
  const { count } = await withSessionLock(userId, (tx) => revokeAllSessions(userId, 'logout', tx));
  await releaseSupportSession(userId);
  return { loggedOut: true, sessions: count };
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function sendOtp({ phone, email, purpose }) {
  const identifier = phone || email;
  const type = `${purpose}:${identifier}`;

  const recent = await prisma.otpCode.findFirst({
    where: { type, isUsed: false, createdAt: { gt: new Date(Date.now() - 60 * 1000) } }
  });
  if (recent) {
    throw new ValidationError([{ path: 'body', message: 'Un code a deja ete envoye il y a moins d\'une minute. Veuillez patienter.' }]);
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60 * 1000);

  await prisma.otpCode.create({
    data: {
      phone: phone || null,
      email: email || null,
      codeHash: code,
      type,
      isUsed: false,
      expiresAt
    }
  });

  return { code, phone, email, purpose, expiresAt };
}

export async function verifyOtp({ phone, email, code, purpose }) {
  const identifier = phone || email;
  const type = `${purpose}:${identifier}`;

  const MAX_ATTEMPTS = 5;

  const record = await prisma.otpCode.findFirst({
    where: { type, codeHash: code, isUsed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) {
    const latest = await prisma.otpCode.findFirst({
      where: { type, isUsed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' }
    });

    const currentAttempts = (latest?.attempts ?? 0) + 1;

    if (currentAttempts >= MAX_ATTEMPTS) {
      if (latest) {
        await prisma.otpCode.update({
          where: { id: latest.id },
          data: { isUsed: true, attempts: currentAttempts }
        });
      }
      throw new ValidationError([{ path: 'body.code', message: 'Nombre maximum de tentatives atteint. Veuillez demander un nouveau code.' }]);
    }

    await prisma.otpCode.updateMany({
      where: { type, isUsed: false },
      data: { attempts: { increment: 1 } }
    });
    throw new ValidationError([{ path: 'body.code', message: 'Code invalide ou expire' }]);
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    throw new ValidationError([{ path: 'body.code', message: 'Nombre maximum de tentatives atteint. Veuillez demander un nouveau code.' }]);
  }

  await prisma.otpCode.update({
    where: { id: record.id },
    data: { isUsed: true }
  });

  return { verified: true, phone: record.phone, email: record.email };
}

export async function forgotPassword({ identifier }) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ phone: identifier }, { email: identifier }]
    }
  });

  if (!user || user.status === 'deleted') {
    throw new NotFoundError('Aucun compte trouve avec cet identifiant');
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60 * 1000);
  const type = `reset-password:${identifier}`;

  await prisma.otpCode.create({
    data: {
      phone: user.phone,
      email: user.email,
      codeHash: code,
      type,
      isUsed: false,
      expiresAt,
      userId: user.id
    }
  });

  return { code, phone: user.phone, email: user.email };
}

export async function resetPassword({ identifier, otpCode, newPassword, newPin }) {
  const type = `reset-password:${identifier}`;

  const record = await prisma.otpCode.findFirst({
    where: { type, codeHash: otpCode, isUsed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) {
    await prisma.otpCode.updateMany({
      where: { type, isUsed: false },
      data: { attempts: { increment: 1 } }
    });
    throw new ValidationError([{ path: 'body.otpCode', message: 'Code invalide ou expire' }]);
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ phone: identifier }, { email: identifier }]
    }
  });

  if (!user) {
    throw new NotFoundError('Utilisateur introuvable');
  }

  // Le PIN est la seule identification utilisee a la connexion : le
  // reinitialiser est le cas nominal, le mot de passe restant possible pour les
  // integrations qui s'en servent encore.
  const data = {};
  if (newPassword) data.passwordHash = await bcrypt.hash(newPassword, 12);
  if (newPin) data.pinHash = await bcrypt.hash(newPin, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data }),
    prisma.otpCode.update({
      where: { id: record.id },
      data: { isUsed: true }
    }),
    // Une reinitialisation revoque les sessions ouvertes : sans cela, un appareil
    // deja connecte survivrait a la reprise de controle du compte.
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'reset' }
    })
  ]);

  return { reset: true, pinReset: Boolean(newPin), passwordReset: Boolean(newPassword) };
}

export async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError('Utilisateur introuvable');
  }

  if (!user.passwordHash) {
    throw new ValidationError([{ path: 'body.currentPassword', message: 'Aucun mot de passe defini pour ce compte. Utilisez la reinitialisation.' }]);
  }

  const passwordMatches = await compareSecret(currentPassword, user.passwordHash);
  if (!passwordMatches) {
    throw new UnauthorizedError('Mot de passe actuel incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash }
  });

  return { changed: true };
}

export async function verifyEmail({ email, otpCode }) {
  const type = `verification:${email}`;

  const record = await prisma.otpCode.findFirst({
    where: { type, codeHash: otpCode, isUsed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) {
    await prisma.otpCode.updateMany({
      where: { type, isUsed: false },
      data: { attempts: { increment: 1 } }
    });
    throw new ValidationError([{ path: 'body.otpCode', message: 'Code invalide ou expire' }]);
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new NotFoundError('Utilisateur introuvable');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true }
    }),
    prisma.otpCode.update({
      where: { id: record.id },
      data: { isUsed: true }
    })
  ]);

  return { verified: true };
}

export async function resendVerification({ identifier }) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ phone: identifier }, { email: identifier }]
    }
  });

  if (!user || user.status === 'deleted') {
    throw new NotFoundError('Aucun compte trouve avec cet identifiant');
  }

  if (user.isEmailVerified && user.isPhoneVerified) {
    throw new ConflictError('Le compte est deja verifie');
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60 * 1000);

  await prisma.otpCode.create({
    data: {
      phone: user.phone,
      email: user.email,
      codeHash: code,
      type: `verification:${identifier}`,
      isUsed: false,
      expiresAt,
      userId: user.id
    }
  });

  return { code, phone: user.phone, email: user.email };
}
