import { prisma } from '../config/prisma.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { activeSessionForAccess, touchSession, withSessionLock } from '../modules/auth/session.service.js';

/** Les anciens JWT sans sid restent valides jusqu'a leur expiration. */
async function enforceSessionActivity(sid, user) {
  if (!sid) return;
  const result = await withSessionLock(user.id, async (tx) => {
    const session = await activeSessionForAccess(tx, sid, user.id);
    if (!session) return new UnauthorizedError('Session fermee', 'SESSION_REVOKED');
    const error = await touchSession(tx, session, user.role);
    return error || { familyId: session.familyId };
  });
  if (result instanceof Error) throw result;
  return result?.familyId;
}

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    const [, token] = header?.split(' ') || [];

    if (!token) {
      throw new UnauthorizedError('Token absent');
    }

    const payload = verifyAccessToken(token);
    // Garage et vehicule sont des relations : sans include, /auth/me renvoie un
    // utilisateur sans nom de zone ni plaque, et les clients affichent des
    // champs vides alors que la donnee existe.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        garage: true,
        vehicles: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        // Zone de rattachement (referentiel courant) : sans elle les ecrans
        // « Ma zone » des deux clients croient l'utilisateur non rattache.
        driverZones: {
          include: { zone: { select: { id: true, name: true, displayName: true } } },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
        }
      }
    });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedError('Session invalide');
    }

    req.sessionFamilyId = await enforceSessionActivity(payload.sid, user);

    req.user = user;
    return next();
  } catch (error) {
    if (error.statusCode) {
      return next(error);
    }
    // Le gestionnaire central journalise la cause technique et renvoie 5xx.
    // La convertir en 401 detruirait inutilement les sessions des clients.
    return next(error);
  }
}

export function optionalAuthenticate(req, res, next) {
  if (!req.headers.authorization) {
    return next();
  }
  return authenticate(req, res, next);
}

export function ensureActiveUser(req, _res, next) {
  if (!req.user || req.user.status !== 'active') {
    return next(new ForbiddenError('Compte inactif'));
  }
  return next();
}
