import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';

/**
 * Sauvegarde et restauration PostgreSQL par `pg_dump` / `pg_restore`.
 *
 * Le format « custom » (-Fc) est retenu plutot que le SQL brut : il est
 * compresse, restaurable selectivement, et `pg_restore --clean` sait recreer
 * les objets sans script d'accompagnement.
 *
 * Les operations sont longues : les controleurs les lancent en arriere-plan et
 * repondent immediatement, l'etat vivant dans la table `backups`.
 */

/** Un dump encore « running » au-dela de ce delai est considere comme perdu. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** Fin de stderr conservee en cas d'echec, assez pour diagnostiquer sans tout stocker. */
const ERROR_TAIL_LENGTH = 2000;

/**
 * Eclate l'URL Prisma en parametres de connexion.
 *
 * Le mot de passe part par `PGPASSWORD` et non dans l'URL passee en argument :
 * la ligne de commande d'un processus est lisible par tout utilisateur de la
 * machine (`ps`). Le `?schema=public` de Prisma, que les clients PostgreSQL ne
 * comprennent pas, disparait au passage.
 */
export function connectionFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL sans nom de base');

  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database
  };
}

/** Nom de fichier trie chronologiquement par ordre alphabetique. */
export function backupFileName(backupId, now) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `procolis-${stamp}-${backupId}.dump`;
}

/**
 * Resout un nom de fichier dans le repertoire de sauvegarde en refusant toute
 * sortie de ce repertoire (`..`, chemin absolu) : `fileUrl` vient de la base,
 * pas d'une constante.
 */
export function resolveBackupPath(fileName) {
  const directory = path.resolve(env.BACKUP_DIR);
  const resolved = path.resolve(directory, path.basename(String(fileName || '')));
  if (resolved !== path.join(directory, path.basename(resolved))) return null;
  return resolved;
}

function runProcess(bin, args, extraEnv) {
  return new Promise((resolve) => {
    let stderr = '';
    let child;

    try {
      child = spawn(bin, args, { env: { ...process.env, ...extraEnv } });
    } catch (error) {
      resolve({ code: -1, stderr: error.message });
      return;
    }

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > ERROR_TAIL_LENGTH * 4) stderr = stderr.slice(-ERROR_TAIL_LENGTH * 2);
    });
    // Binaire absent du PATH : `spawn` remonte l'erreur ici, pas en exception.
    child.on('error', (error) => resolve({ code: -1, stderr: error.message }));
    child.on('close', (code) => resolve({ code, stderr: stderr.slice(-ERROR_TAIL_LENGTH) }));
  });
}

/**
 * Selectionne les sauvegardes a purger : on garde les `retention` plus
 * recentes qui portent encore un fichier, les autres sont rendues.
 */
export function selectPurgeable(backups, retention) {
  const withFile = backups.filter((backup) => backup.status === 'completed' && backup.fileUrl);
  const sorted = [...withFile].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return sorted.slice(retention);
}

async function purgeOldBackups() {
  const backups = await prisma.backup.findMany({ orderBy: { createdAt: 'desc' } });
  const purgeable = selectPurgeable(backups, env.BACKUP_RETENTION);
  if (purgeable.length === 0) return 0;

  for (const backup of purgeable) {
    const filePath = resolveBackupPath(backup.fileUrl);
    // Un fichier deja disparu ne doit pas bloquer la purge de la ligne.
    if (filePath) await fs.rm(filePath, { force: true });
  }

  await prisma.backup.deleteMany({ where: { id: { in: purgeable.map((backup) => backup.id) } } });
  return purgeable.length;
}

/** Marque « failed » les sauvegardes restees `running` apres un crash du process. */
async function failStaleBackups() {
  const threshold = new Date(Date.now() - STALE_AFTER_MS);
  await prisma.backup.updateMany({
    where: { status: 'running', createdAt: { lt: threshold } },
    data: { status: 'failed', errorMessage: 'Sauvegarde interrompue (processus arrete)' }
  });
}

/** Une seule sauvegarde a la fois : deux dumps concurrents saturent le disque et la base. */
export async function hasRunningBackup() {
  await failStaleBackups();
  const running = await prisma.backup.findFirst({ where: { status: 'running' } });
  return Boolean(running);
}

/**
 * Cree la ligne de suivi puis lance le dump en arriere-plan. Renvoie la ligne
 * `running` : l'appelant repond immediatement, le client suit l'avancement en
 * relisant la liste.
 */
export async function startBackup({ requestedBy }) {
  const backup = await prisma.backup.create({
    data: { status: 'running', requestedBy }
  });

  // Volontairement non attendu : le dump peut durer plusieurs minutes, bien
  // au-dela du delai d'une requete HTTP.
  void performBackup(backup.id).catch((error) => {
    logger.error({ error, backupId: backup.id }, 'Backup task crashed');
  });

  return backup;
}

async function performBackup(backupId) {
  const startedAt = Date.now();
  const directory = path.resolve(env.BACKUP_DIR);
  const fileName = backupFileName(backupId, new Date());
  const filePath = path.join(directory, fileName);

  try {
    await fs.mkdir(directory, { recursive: true });
    const connection = connectionFromUrl(env.DATABASE_URL);

    const { code, stderr } = await runProcess(
      env.PG_DUMP_BIN,
      [
        '--format=custom',
        '--compress=6',
        // Le proprietaire et les droits sont recrees par la migration : les
        // omettre rend le dump restaurable sur une instance au role different.
        '--no-owner',
        '--no-privileges',
        '--host', connection.host,
        '--port', String(connection.port),
        '--username', connection.user,
        '--dbname', connection.database,
        '--file', filePath
      ],
      { PGPASSWORD: connection.password }
    );

    if (code !== 0) {
      await fs.rm(filePath, { force: true });
      throw new Error(stderr || `pg_dump a termine avec le code ${code}`);
    }

    const stats = await fs.stat(filePath);
    if (stats.size === 0) {
      await fs.rm(filePath, { force: true });
      throw new Error('pg_dump a produit un fichier vide');
    }

    await prisma.backup.update({
      where: { id: backupId },
      data: {
        status: 'completed',
        fileUrl: fileName,
        sizeBytes: BigInt(stats.size),
        completedAt: new Date(),
        errorMessage: null
      }
    });

    const purged = await purgeOldBackups();
    logger.info(
      { backupId, sizeBytes: stats.size, durationMs: Date.now() - startedAt, purged },
      'Database backup completed'
    );
  } catch (error) {
    await prisma.backup.update({
      where: { id: backupId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: String(error.message || error).slice(-ERROR_TAIL_LENGTH)
      }
    });
    logger.error({ error, backupId }, 'Database backup failed');
  }
}

/**
 * Restaure un dump par-dessus la base courante.
 *
 * Rien n'est journalise en base : la restauration remplace justement les tables
 * ou l'on ecrirait. La trace part donc dans les journaux applicatifs, qui
 * survivent a l'operation.
 */
export async function performRestore({ backup, actor }) {
  const filePath = resolveBackupPath(backup.fileUrl);
  await fs.access(filePath);

  const connection = connectionFromUrl(env.DATABASE_URL);
  logger.warn(
    { backupId: backup.id, actorId: actor?.id, actorRole: actor?.role },
    'Database restore started — the API state is being replaced'
  );

  const { code, stderr } = await runProcess(
    env.PG_RESTORE_BIN,
    [
      // `--clean --if-exists` remplace les objets existants sans echouer sur
      // ceux qui manquent ; `--single-transaction` evite de laisser la base a
      // moitie restauree si le dump est corrompu.
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      '--host', connection.host,
      '--port', String(connection.port),
      '--username', connection.user,
      '--dbname', connection.database,
      filePath
    ],
    { PGPASSWORD: connection.password }
  );

  if (code !== 0) {
    logger.error({ backupId: backup.id, stderr }, 'Database restore failed');
    return { restored: false, error: stderr || `pg_restore a termine avec le code ${code}` };
  }

  logger.warn({ backupId: backup.id }, 'Database restore completed');
  return { restored: true };
}
