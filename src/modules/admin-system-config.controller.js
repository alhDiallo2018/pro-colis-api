/**
 * Endpoints d'administration super-admin pour la table `SystemConfig`.
 *
 * - `GET /admin/system-config` → dump complet des ~90 clés, regroupées par
 *   préfixe (`timings.*`, `limits.*`, `branding.*`, …) et sérialisées en
 *   JSON structuré pour alimenter l'UI admin.
 * - `PUT /admin/system-config/:key` → upsert d'une clé unique + invalidation
 *   du cache mémoire correspondant (`invalidateByKey`).
 * - `PUT /admin/system-config/batch` → upsert transactionnel de N clés +
 *   invalidation dédupliquée par groupe (`invalidateByKeys`).
 *
 * Toutes les mutations sont journalisées dans `AuditLog` (best-effort). Les
 * valeurs secrètes (clés PayDunya, Brevo) ont leur propre endpoint masqué
 * historique : ce module ne les touche pas et interdit leur écriture pour
 * éviter une régression sécurité (`PROTECTED_WRITE_KEYS`).
 */

import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ok, fail } from '../utils/api-response.js';
import { ValidationError, NotFoundError, normalizeError } from '../utils/errors.js';
import { invalidateByKey, invalidateByKeys, groupForKey } from '../utils/system-config-invalidation.js';

/**
 * Clés explicitement interdites à l'écriture via cet endpoint : on force le
 * passage par `/admin/payments/paydunya-config` (masque en lecture, filtre
 * les valeurs masquées) et `/admin/notifications/brevo-config`. Les secrets
 * en clair ne doivent JAMAIS passer par une mutation batch anodine.
 */
const PROTECTED_WRITE_KEYS = Object.freeze(
  new Set([
    'paydunya.masterKey',
    'paydunya.privateKey',
    'paydunya.token',
    'brevo.apiKey',
    'brevo.smsApiKey'
  ])
);

/**
 * Préfixes autorisés à l'écriture. Tout ce qui n'est pas listé ici est
 * refusé pour empêcher l'injection d'une clé parasite (`user.password=x`)
 * via l'endpoint batch.
 */
const ALLOWED_PREFIXES = Object.freeze([
  'auth.',
  'commission.',
  'paydunya.',
  'international.',
  'currency.',
  'timings.',
  'limits.',
  'branding.',
  'notifications.',
  'support.',
  'legal.',
  'help.',
  'cancellation.',
  'points.',
  'withdrawal.',
  'fraud.',
  'anomaly.',
  'driverScoring.',
  'referral.',
  'score.',
  'finance.',
  'brevo.',
  'eta.',
  'consolidation.',
  'ai.'
]);

/**
 * Clés scalaires simples sans préfixe, autorisées en écriture.
 */
const ALLOWED_SCALAR_KEYS = Object.freeze(new Set(['insufficientPolicy', 'debtLimit']));

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log?.error?.(
        {
          error,
          action,
          userId: req.user?.id,
          role: req.user?.role,
          requestId: req.requestId
        },
        `Admin system-config endpoint failed: ${action}`
      );
      return fail(res, {
        status: normalized?.statusCode || 500,
        message:
          normalized?.publicMessage ||
          (env.NODE_ENV === 'production' ? 'Opération impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || []
      });
    }
  };
}

function isAllowedKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) return false;
  if (ALLOWED_SCALAR_KEYS.has(key)) return true;
  return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function groupKeyForRead(key) {
  // Pour la lecture, on regroupe par premier segment (`auth`, `timings`, …) ;
  // les clés sans point (`insufficientPolicy`, `debtLimit`) tombent dans un
  // groupe synthétique `general`.
  if (typeof key !== 'string') return 'general';
  const idx = key.indexOf('.');
  if (idx < 0) return 'general';
  return key.slice(0, idx);
}

/**
 * GET /admin/system-config
 *
 * Retourne toutes les clés de `SystemConfig` regroupées par préfixe :
 * ```
 * { groups: { timings: { parcelStatusPollMs: 60000, ... }, ... }, keys: [...] }
 * ```
 *
 * `keys` est la liste à plat (key, value, updatedAt, updatedBy) pour un éditeur
 * avancé "clé par clé" sans dépendre du schéma frontend.
 */
export const listSystemConfig = handle('systemConfig.list', async (_req, res) => {
  const rows = await prisma.systemConfig.findMany({
    orderBy: { key: 'asc' }
  });

  const groups = {};
  const keys = [];
  for (const row of rows) {
    const group = groupKeyForRead(row.key);
    // La valeur en DB est stockée en JSON brut ; on expose telle quelle pour
    // que l'UI décide comment la rendre (color picker, number input, textarea
    // JSON, …) selon le schéma côté client.
    const value = row.value;

    if (group === 'general') {
      groups[row.key] = value;
    } else {
      if (!groups[group]) groups[group] = {};
      // Enlève le préfixe pour grouper (`timings.parcelStatusPollMs` → `parcelStatusPollMs`).
      const field = row.key.slice(group.length + 1);
      groups[group][field] = value;
    }

    keys.push({
      key: row.key,
      value,
      updatedAt: row.updatedAt?.toISOString() || null,
      updatedBy: row.updatedBy || null
    });
  }

  return ok(res, {
    message: 'Configuration système',
    data: { groups, keys, count: keys.length }
  });
});

/**
 * PUT /admin/system-config/:key
 *
 * Upsert d'une clé unique. Body : `{ "value": <any JSON> }`. La valeur
 * acceptée est validée côté reader (coerceurs stricts) : une valeur invalide
 * (ex. couleur non-hex) est stockée telle quelle mais ignorée au profit du
 * défaut lors de la lecture. L'UI admin peut ajouter sa propre validation.
 */
export const updateSystemConfigKey = handle('systemConfig.update', async (req, res) => {
  const key = req.params.key;
  if (!isAllowedKey(key)) {
    throw new ValidationError([{ path: 'params.key', message: `Clé non autorisée : ${key}` }]);
  }
  if (PROTECTED_WRITE_KEYS.has(key)) {
    throw new ValidationError([
      { path: 'params.key', message: `Clé protégée — utiliser l'endpoint dédié : ${key}` }
    ]);
  }
  if (!('value' in (req.body ?? {}))) {
    throw new ValidationError([{ path: 'body.value', message: 'Champ `value` requis' }]);
  }

  const value = req.body.value;

  await prisma.$transaction([
    prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedBy: req.user.id, updatedAt: new Date() },
      create: { key, value, updatedBy: req.user.id }
    }),
    prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'systemConfig.update',
        entityType: 'system_config',
        entityId: null,
        // On ne met PAS la valeur en clair dans l'audit (une clé non-protégée
        // peut quand même contenir une URL technique sensible). Audit porte la
        // clé + le groupe de cache invalidé.
        afterData: { key, group: groupForKey(key) || null },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      }
    })
  ]);

  const invalidated = invalidateByKey(key);

  return ok(res, {
    message: 'Clé mise à jour',
    data: { key, value, cacheInvalidated: invalidated }
  });
});

/**
 * DELETE /admin/system-config/:key
 *
 * Supprime une clé (utile pour « revenir aux defaults » : les readers tombent
 * alors sur le fallback compile-time). Retourne 404 si la clé n'existait pas.
 */
export const deleteSystemConfigKey = handle('systemConfig.delete', async (req, res) => {
  const key = req.params.key;
  if (!isAllowedKey(key)) {
    throw new ValidationError([{ path: 'params.key', message: `Clé non autorisée : ${key}` }]);
  }
  if (PROTECTED_WRITE_KEYS.has(key)) {
    throw new ValidationError([
      { path: 'params.key', message: `Clé protégée — suppression interdite : ${key}` }
    ]);
  }

  try {
    await prisma.systemConfig.delete({ where: { key } });
  } catch (error) {
    if (error?.code === 'P2025') {
      throw new NotFoundError('Clé inconnue');
    }
    throw error;
  }

  // Audit best-effort (hors transaction pour simplifier le flux).
  await prisma.auditLog
    .create({
      data: {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'systemConfig.delete',
        entityType: 'system_config',
        afterData: { key },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      }
    })
    .catch(() => {});

  const invalidated = invalidateByKey(key);

  return ok(res, {
    message: 'Clé supprimée',
    data: { key, cacheInvalidated: invalidated }
  });
});

/**
 * PUT /admin/system-config/batch
 *
 * Accepte `{ updates: [{ key, value }, ...] }`. Upsert transactionnel +
 * invalidation dédupliquée. Idéal pour qu'un formulaire admin ne génère
 * qu'une seule requête par section (10-20 clés) plutôt que 10-20 requêtes.
 *
 * Rejette toute la liste si une clé est invalide (pas d'upsert partiel).
 */
export const batchUpdateSystemConfig = handle('systemConfig.batchUpdate', async (req, res) => {
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : null;
  if (!updates || updates.length === 0) {
    throw new ValidationError([{ path: 'body.updates', message: 'Liste `updates` non vide requise' }]);
  }
  if (updates.length > 200) {
    // Garde-fou : une mutation de 200+ clés ne rentre dans aucun scénario
    // légitime, c'est probablement une erreur client (loop, injection).
    throw new ValidationError([{ path: 'body.updates', message: 'Trop de clés (max 200)' }]);
  }

  const errors = [];
  for (let i = 0; i < updates.length; i += 1) {
    const entry = updates[i];
    if (!entry || typeof entry !== 'object') {
      errors.push({ path: `body.updates[${i}]`, message: 'Objet attendu' });
      continue;
    }
    if (!isAllowedKey(entry.key)) {
      errors.push({ path: `body.updates[${i}].key`, message: `Clé non autorisée : ${entry.key}` });
    }
    if (PROTECTED_WRITE_KEYS.has(entry.key)) {
      errors.push({
        path: `body.updates[${i}].key`,
        message: `Clé protégée — utiliser l'endpoint dédié : ${entry.key}`
      });
    }
    if (!('value' in entry)) {
      errors.push({ path: `body.updates[${i}].value`, message: '`value` requis' });
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  const now = new Date();
  const keys = updates.map((u) => u.key);

  await prisma.$transaction([
    ...updates.map((u) =>
      prisma.systemConfig.upsert({
        where: { key: u.key },
        update: { value: u.value, updatedBy: req.user.id, updatedAt: now },
        create: { key: u.key, value: u.value, updatedBy: req.user.id }
      })
    ),
    prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'systemConfig.batchUpdate',
        entityType: 'system_config',
        afterData: { keys, count: keys.length },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      }
    })
  ]);

  const invalidatedGroups = invalidateByKeys(keys);

  return ok(res, {
    message: `${keys.length} clé(s) mise(s) à jour`,
    data: { keys, count: keys.length, cacheInvalidatedGroups: invalidatedGroups }
  });
});
