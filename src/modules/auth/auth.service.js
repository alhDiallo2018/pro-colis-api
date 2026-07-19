import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ConflictError, UnauthorizedError, ValidationError } from '../../utils/errors.js';
import {
  compareSecret,
  hashSecret,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from '../../utils/tokens.js';
import { serializeUser } from '../../utils/user-serializer.js';

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

async function createTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const tokenHash = await hashSecret(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: addDays(new Date(), 30)
    }
  });

  return { accessToken, refreshToken };
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
      }
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
    data: { lastLogin: new Date(), lastActiveAt: new Date() }
  });

  const tokens = await createTokenPair(updatedUser);
  return { user: serializeUser(updatedUser), ...tokens };
}

export async function refreshAccessToken(refreshToken) {
  const payload = verifyRefreshToken(refreshToken);
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });

  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('Session invalide');
  }

  const storedTokens = await prisma.refreshToken.findMany({
    where: {
      userId: user.id,
      revokedAt: null,
      expiresAt: { gt: new Date() }
    }
  });

  const matchingToken = await Promise.any(
    storedTokens.map(async (storedToken) => {
      const matches = await compareSecret(refreshToken, storedToken.tokenHash);
      if (!matches) {
        throw new Error('Token mismatch');
      }
      return storedToken;
    })
  ).catch(() => null);

  if (!matchingToken) {
    throw new UnauthorizedError('Refresh token invalide');
  }

  return {
    user: serializeUser(user),
    accessToken: signAccessToken(user)
  };
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

export async function resetPassword({ identifier, otpCode, newPassword }) {
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

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    }),
    prisma.otpCode.update({
      where: { id: record.id },
      data: { isUsed: true }
    })
  ]);

  return { reset: true };
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
