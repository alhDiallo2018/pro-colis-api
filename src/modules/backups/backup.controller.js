import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { ok, fail } from '../../utils/api-response.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  normalizeError
} from '../../utils/errors.js';
import * as backupService from './backup.service.js';

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log.error(
        { error, action, userId: req.user?.id, role: req.user?.role, requestId: req.requestId },
        `Backup endpoint failed: ${action}`
      );

      return fail(res, {
        status: normalized?.statusCode || 500,
        message:
          normalized?.publicMessage ||
          (env.NODE_ENV === 'production' ? 'Operation impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || []
      });
    }
  };
}

function serializeBackup(backup) {
  if (!backup) return null;
  return {
    id: backup.id,
    status: backup.status,
    // `fileUrl` porte le nom du fichier sur le volume, pas une URL publique :
    // le telechargement passe par la route dediee, jamais par un lien direct.
    fileName: backup.fileUrl ?? null,
    // BigInt n'est pas serialisable en JSON : on renvoie un nombre, la taille
    // d'un dump restant tres en deca de Number.MAX_SAFE_INTEGER.
    sizeBytes: backup.sizeBytes === null || backup.sizeBytes === undefined ? null : Number(backup.sizeBytes),
    requestedBy: backup.requestedBy,
    requesterName: backup.requester?.fullName ?? null,
    errorMessage: backup.errorMessage ?? null,
    completedAt: backup.completedAt,
    createdAt: backup.createdAt
  };
}

export const listBackups = handle('backups.list', async (_req, res) => {
  const backups = await prisma.backup.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { requester: { select: { fullName: true } } }
  });

  return ok(res, {
    message: 'Backups',
    data: {
      backups: backups.map(serializeBackup),
      // Le front masque l'action de restauration quand le deploiement ne
      // l'autorise pas, plutot que de proposer un bouton qui repondra 403.
      restoreEnabled: env.BACKUP_ALLOW_RESTORE,
      retention: env.BACKUP_RETENTION
    }
  });
});

export const createBackup = handle('backups.create', async (req, res) => {
  if (await backupService.hasRunningBackup()) {
    throw new ConflictError('Une sauvegarde est deja en cours');
  }

  const backup = await backupService.startBackup({ requestedBy: req.user.id });

  // 202 : le dump tourne encore, le client suit son etat via la liste.
  return ok(res, {
    status: 202,
    message: 'Sauvegarde lancee',
    data: { backup: serializeBackup(backup) }
  });
});

export const downloadBackup = handle('backups.download', async (req, res) => {
  const backup = await prisma.backup.findUnique({ where: { id: req.params.backupId } });
  if (!backup) throw new NotFoundError('Sauvegarde introuvable');
  if (backup.status !== 'completed' || !backup.fileUrl) {
    throw new ValidationError([{ path: 'params.backupId', message: 'Sauvegarde non disponible' }]);
  }

  const filePath = backupService.resolveBackupPath(backup.fileUrl);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new NotFoundError('Fichier de sauvegarde introuvable');
  }

  // Un dump contient toute la base : il ne doit etre ni mis en cache par un
  // proxy, ni conserve par le navigateur.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  if (backup.sizeBytes) res.setHeader('Content-Length', String(backup.sizeBytes));

  return createReadStream(filePath).pipe(res);
});

export const restoreBackup = handle('backups.restore', async (req, res) => {
  if (!env.BACKUP_ALLOW_RESTORE) {
    throw new ForbiddenError('La restauration est desactivee sur ce deploiement');
  }
  if (req.body.confirmation !== 'RESTORE') {
    throw new ValidationError([{ path: 'body.confirmation', message: 'Confirmation RESTORE requise' }]);
  }

  const backup = await prisma.backup.findUnique({ where: { id: req.body.backupId } });
  if (!backup) throw new NotFoundError('Sauvegarde introuvable');
  if (backup.status !== 'completed' || !backup.fileUrl) {
    throw new ValidationError([{ path: 'body.backupId', message: 'Sauvegarde non restaurable' }]);
  }
  if (await backupService.hasRunningBackup()) {
    throw new ConflictError('Une sauvegarde est en cours : reessayez ensuite');
  }

  // Lancee en arriere-plan : `pg_restore` depasse largement le delai d'une
  // requete HTTP sur une base de production.
  void backupService
    .performRestore({ backup, actor: req.user })
    .catch((error) => req.log.error({ error, backupId: backup.id }, 'Restore task crashed'));

  return ok(res, {
    status: 202,
    message: 'Restauration lancee',
    data: {
      restore: {
        status: 'running',
        backupId: backup.id,
        // L'operation remplace les tables : rien de fiable ne peut etre relu
        // depuis la base pendant son deroulement.
        warning: "L'API est indisponible pendant la restauration ; verifiez les journaux applicatifs."
      }
    }
  });
});
