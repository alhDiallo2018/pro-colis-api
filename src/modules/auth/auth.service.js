import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ConflictError, UnauthorizedError, ValidationError } from '../../utils/errors.js';
import {
  compareSecret,
  hashSecret,
  refreshTokenExpiresAt,
  sessionIdleTimeoutMs,
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
async function createTokenPair(user) {
  const { token: refreshToken, jti } = signRefreshToken(user);
  const tokenHash = await hashSecret(refreshToken);
  const now = new Date();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      jti,
      tokenHash,
      expiresAt: refreshTokenExpiresAt(user.role),
      lastUsedAt: now
    }
  });

  // L'access token est signe apres la session : il en porte l'identifiant, ce
  // qui permet a chaque requete de dater l'activite de cette session precise.
  return { accessToken: signAccessToken(user, jti), refreshToken };
}

/** Coupe toutes les sessions ouvertes d'un compte. */
async function revokeAllSessions(userId, reason, client = prisma) {
  return client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason }
  });
}

/** Une session inactive depuis plus longtemps que le delai configure est morte. */
export function isSessionIdle(session, now = Date.now()) {
  return now - session.lastUsedAt.getTime() > sessionIdleTimeoutMs();
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

  // Registration creates the user, initial score row and audit entry atomically.
  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email: payload.email,
        phone: payload.phone,
        fullName: payload.fullName,
        passwordHash,
        pinHash,
        role: payload.role,
        address: payload.address,
        city: payload.city,
        region: payload.region,
        garageId: payload.garageId,
        driverStatus: payload.role === 'driver' ? 'offline' : null,
        isProfileComplete: Boolean(payload.fullName && payload.phone)
      },
      include: USER_INCLUDE
    });

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

    return createdUser;
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
 * Renouvelle la session en faisant tourner le refresh token.
 *
 * Le jeton presente est consomme : il est revoque et remplace. Un jeton vole ne
 * vaut donc plus un mois d'acces mais une seule utilisation, et sa reutilisation
 * est detectable — c'est tout l'interet de la rotation.
 *
 * Reutilisation d'un jeton deja revoque : soit la victime a continue de s'en
 * servir apres le vol, soit c'est l'attaquant qui rejoue. Impossible de trancher,
 * donc on coupe toutes les sessions du compte et on force une reconnexion.
 */
export async function refreshAccessToken(refreshToken) {
  const payload = verifyRefreshToken(refreshToken);
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: USER_INCLUDE
  });

  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('Session invalide');
  }

  const session = await findSessionForToken(user.id, refreshToken, payload.jti);

  if (!session) {
    throw new UnauthorizedError('Refresh token invalide');
  }

  // Seule une revocation par rotation signe un rejeu. Une session fermee pour
  // inactivite ou par deconnexion est un evenement normal : la representer
  // couperait les autres appareils du compte sans raison.
  if (session.revokedReason === 'rotated') {
    await revokeAllSessions(user.id, 'reuse');
    throw new UnauthorizedError('Session revoquee, reconnexion requise');
  }

  if (session.revokedAt || session.expiresAt <= new Date()) {
    throw new UnauthorizedError('Session expiree, reconnexion requise');
  }

  if (isSessionIdle(session)) {
    await prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'idle' }
    });
    throw new UnauthorizedError('Session expiree pour inactivite');
  }

  const { token: nextRefreshToken, jti } = signRefreshToken(user);
  const accessToken = signAccessToken(user, jti);
  const tokenHash = await hashSecret(nextRefreshToken);
  const now = new Date();

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: now, revokedReason: 'rotated' }
    }),
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        jti,
        tokenHash,
        expiresAt: refreshTokenExpiresAt(user.role),
        lastUsedAt: now
      }
    }),
    // Les lignes revoquees restent le temps de detecter un rejeu, puis n'ont
    // plus d'utilite : sans cette purge la table grossit d'une ligne par
    // renouvellement, soit des centaines par compte et par mois.
    prisma.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } }
    })
  ]);

  return {
    user: serializeUser(user),
    accessToken,
    refreshToken: nextRefreshToken
  };
}

/**
 * Ferme une session. Detenir le refresh token vaut preuve de possession, aucune
 * authentification supplementaire n'est exigee : un client dont l'access token
 * a deja expire doit pouvoir se deconnecter proprement.
 */
export async function logout(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    // Un jeton expire ou illisible ne designe aucune session : il n'y a rien a
    // fermer, et le dire reviendrait a renseigner un attaquant.
    return { loggedOut: true };
  }

  const session = await findSessionForToken(payload.sub, refreshToken, payload.jti);
  if (session && !session.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'logout' }
    });
  }

  return { loggedOut: true };
}

/** Ferme toutes les sessions du compte (appareil perdu, doute sur un acces). */
export async function logoutAllSessions(userId) {
  const { count } = await revokeAllSessions(userId, 'logout');
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
