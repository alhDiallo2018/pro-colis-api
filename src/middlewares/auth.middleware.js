import { prisma } from '../config/prisma.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { sessionIdleTimeoutMs, verifyAccessToken } from '../utils/tokens.js';

/**
 * Un compte actif emet plusieurs requetes par seconde : ecrire `lastUsedAt` a
 * chacune doublerait la charge d'ecriture de l'API pour une precision inutile.
 * L'horodatage n'est donc rafraichi qu'au-dela de ce pas.
 *
 * Le decalage joue toujours dans le sens prudent : `lastUsedAt` peut retarder
 * de 5 s au plus sur l'activite reelle, donc une session se ferme au plus tot
 * 5 s avant le delai configure, jamais apres.
 */
const IDLE_TOUCH_THROTTLE_MS = 5000;

/**
 * Ferme la session si elle dort depuis trop longtemps, sinon y date l'activite.
 *
 * Les jetons emis avant l'introduction du `sid` ne designent aucune session :
 * ils restent acceptes jusqu'a leur expiration naturelle plutot que de
 * deconnecter toute la base au deploiement.
 */
async function enforceSessionActivity(sid) {
  if (!sid) return;

  const session = await prisma.refreshToken.findUnique({ where: { jti: sid } });
  if (!session) return;

  if (session.revokedAt) {
    throw new UnauthorizedError('Session fermee');
  }

  const now = Date.now();
  const idleMs = now - session.lastUsedAt.getTime();

  if (idleMs > sessionIdleTimeoutMs()) {
    await prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'idle' }
    });
    throw new UnauthorizedError('Session expiree pour inactivite');
  }

  if (idleMs >= IDLE_TOUCH_THROTTLE_MS) {
    await prisma.refreshToken.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date(now) }
    });
  }
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

    await enforceSessionActivity(payload.sid);

    req.user = user;
    return next();
  } catch (error) {
    if (error.statusCode) {
      return next(error);
    }
    return next(new UnauthorizedError('Token invalide'));
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
