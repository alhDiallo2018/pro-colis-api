import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

/**
 * Sauvegardes PostgreSQL.
 *
 * `pg_dump` n'est pas installé sur les machines de développement et la suite ne
 * doit pas dépendre d'un binaire externe : `PG_DUMP_BIN` pointe donc sur un
 * script de test qui écrit un fichier et sort en 0 (ou échoue à la demande).
 * L'orchestration testée — transitions d'état, taille enregistrée, purge,
 * gestion d'erreur — est exactement celle qui tournera en production.
 */

const BACKUP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'procolis-backups-'));
const BIN_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'procolis-bin-'));

const fakeDump = path.join(BIN_DIR, 'fake-pg-dump.sh');
const failingDump = path.join(BIN_DIR, 'failing-pg-dump.sh');

// `--file <chemin>` est le dernier couple d'arguments passé par le service.
await fs.writeFile(
  fakeDump,
  '#!/bin/sh\nwhile [ "$1" != "--file" ]; do shift; done\nprintf "PGDMP-fake-archive" > "$2"\nexit 0\n'
);
await fs.writeFile(failingDump, '#!/bin/sh\necho "pg_dump: erreur de connexion" >&2\nexit 1\n');
await fs.chmod(fakeDump, 0o755);
await fs.chmod(failingDump, 0o755);

process.env.BACKUP_DIR = BACKUP_DIR;
process.env.BACKUP_RETENTION = '2';
process.env.PG_DUMP_BIN = fakeDump;

const { env } = await import('../src/config/env.js');
const { prisma } = await import('../src/config/prisma.js');
const backupService = await import('../src/modules/backups/backup.service.js');

/** Le dump tourne en arrière-plan : on attend que la ligne quitte `running`. */
async function waitForCompletion(backupId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.backup.findUnique({ where: { id: backupId } });
    if (row && row.status !== 'running') return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La sauvegarde est restée en cours au-delà du délai');
}

describe('backup service', () => {
  const createdIds = [];

  afterAll(async () => {
    await prisma.backup.deleteMany({ where: { id: { in: createdIds } } });
    await fs.rm(BACKUP_DIR, { recursive: true, force: true });
    await fs.rm(BIN_DIR, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    env.PG_DUMP_BIN = fakeDump;
    env.BACKUP_RETENTION = 2;
  });

  describe('connectionFromUrl', () => {
    it('extrait les paramètres et écarte le ?schema de Prisma', () => {
      const connection = backupService.connectionFromUrl(
        'postgresql://procolis:s3cr%40t@db.local:15432/procolis_test?schema=public'
      );
      expect(connection).toEqual({
        host: 'db.local',
        port: '15432',
        user: 'procolis',
        // Le mot de passe est décodé : il part par PGPASSWORD, pas dans l'URL.
        password: 's3cr@t',
        database: 'procolis_test'
      });
    });

    it('retombe sur le port par défaut quand il est absent', () => {
      const connection = backupService.connectionFromUrl('postgresql://u:p@db/procolis');
      expect(connection.port).toBe('5432');
    });

    it('refuse une URL sans nom de base', () => {
      expect(() => backupService.connectionFromUrl('postgresql://u:p@db/')).toThrow();
    });
  });

  describe('resolveBackupPath', () => {
    it('résout un nom de fichier dans le répertoire de sauvegarde', () => {
      const resolved = backupService.resolveBackupPath('procolis-2026-01-01.dump');
      expect(resolved).toBe(path.join(path.resolve(BACKUP_DIR), 'procolis-2026-01-01.dump'));
    });

    it('neutralise une tentative de sortie du répertoire', () => {
      // `fileUrl` vient de la base : une valeur trafiquée ne doit pas donner
      // accès à un fichier arbitraire du serveur.
      const resolved = backupService.resolveBackupPath('../../etc/passwd');
      expect(resolved).toBe(path.join(path.resolve(BACKUP_DIR), 'passwd'));
    });
  });

  describe('selectPurgeable', () => {
    const row = (id, createdAt, status = 'completed', fileUrl = `${id}.dump`) => ({
      id,
      createdAt,
      status,
      fileUrl
    });

    it('garde les N plus récentes et rend les suivantes', () => {
      const purgeable = backupService.selectPurgeable(
        [
          row('a', '2026-08-01T00:00:00Z'),
          row('c', '2026-08-03T00:00:00Z'),
          row('b', '2026-08-02T00:00:00Z')
        ],
        2
      );
      expect(purgeable.map((backup) => backup.id)).toEqual(['a']);
    });

    it('ignore les lignes échouées et celles sans fichier', () => {
      const purgeable = backupService.selectPurgeable(
        [
          row('ok', '2026-08-03T00:00:00Z'),
          row('failed', '2026-08-02T00:00:00Z', 'failed'),
          row('nofile', '2026-08-01T00:00:00Z', 'completed', null)
        ],
        1
      );
      expect(purgeable).toEqual([]);
    });
  });

  describe('startBackup', () => {
    it('produit un dump, enregistre sa taille et purge au-delà de la rétention', async () => {
      const runs = [];
      for (let index = 0; index < 3; index += 1) {
        const backup = await backupService.startBackup({ requestedBy: null });
        createdIds.push(backup.id);
        expect(backup.status).toBe('running');
        runs.push(await waitForCompletion(backup.id));
      }

      const last = runs[runs.length - 1];
      expect(last.status).toBe('completed');
      expect(last.fileUrl).toMatch(/^procolis-.*\.dump$/);
      expect(Number(last.sizeBytes)).toBe('PGDMP-fake-archive'.length);
      expect(last.completedAt).not.toBeNull();

      // Le fichier existe bien sur le volume.
      const filePath = backupService.resolveBackupPath(last.fileUrl);
      await expect(fs.access(filePath)).resolves.toBeUndefined();

      // Rétention à 2 : la plus ancienne des trois a disparu, fichier et ligne.
      const oldest = runs[0];
      expect(await prisma.backup.findUnique({ where: { id: oldest.id } })).toBeNull();
      await expect(fs.access(backupService.resolveBackupPath(oldest.fileUrl))).rejects.toThrow();
    }, 30_000);

    it('marque la sauvegarde en échec et conserve le message de pg_dump', async () => {
      env.PG_DUMP_BIN = failingDump;

      const backup = await backupService.startBackup({ requestedBy: null });
      createdIds.push(backup.id);
      const finished = await waitForCompletion(backup.id);

      expect(finished.status).toBe('failed');
      expect(finished.errorMessage).toContain('erreur de connexion');
      expect(finished.fileUrl).toBeNull();
    }, 30_000);

    it('signale un binaire introuvable au lieu de laisser la ligne en cours', async () => {
      env.PG_DUMP_BIN = path.join(BIN_DIR, 'binaire-absent');

      const backup = await backupService.startBackup({ requestedBy: null });
      createdIds.push(backup.id);
      const finished = await waitForCompletion(backup.id);

      expect(finished.status).toBe('failed');
      expect(finished.errorMessage).toBeTruthy();
    }, 30_000);
  });

  describe('hasRunningBackup', () => {
    it('détecte une sauvegarde en cours', async () => {
      const running = await prisma.backup.create({ data: { status: 'running' } });
      createdIds.push(running.id);

      await expect(backupService.hasRunningBackup()).resolves.toBe(true);

      await prisma.backup.delete({ where: { id: running.id } });
    });

    it('libère une sauvegarde restée en cours après un arrêt du processus', async () => {
      const stale = await prisma.backup.create({
        data: {
          status: 'running',
          // Trois heures : au-delà du seuil de deux heures du service.
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000)
        }
      });
      createdIds.push(stale.id);

      await expect(backupService.hasRunningBackup()).resolves.toBe(false);

      const refreshed = await prisma.backup.findUnique({ where: { id: stale.id } });
      expect(refreshed.status).toBe('failed');
      expect(refreshed.errorMessage).toMatch(/interrompue/i);
    });
  });
});

describe('backup restore guardrails', () => {
  it('refuse la restauration quand le déploiement ne l’autorise pas', async () => {
    const { restoreBackup } = await import('../src/modules/backups/backup.controller.js');

    const previous = env.BACKUP_ALLOW_RESTORE;
    env.BACKUP_ALLOW_RESTORE = false;

    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };
    const req = {
      body: { backupId: 'x', confirmation: 'RESTORE' },
      user: { id: 'u', role: 'super_admin' },
      log: { error: jest.fn() }
    };

    await restoreBackup(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    env.BACKUP_ALLOW_RESTORE = previous;
  });

  it('exige la confirmation littérale même quand la restauration est ouverte', async () => {
    const { restoreBackup } = await import('../src/modules/backups/backup.controller.js');

    const previous = env.BACKUP_ALLOW_RESTORE;
    env.BACKUP_ALLOW_RESTORE = true;

    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };
    const req = {
      body: { backupId: 'x', confirmation: 'oui' },
      user: { id: 'u', role: 'super_admin' },
      log: { error: jest.fn() }
    };

    await restoreBackup(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    env.BACKUP_ALLOW_RESTORE = previous;
  });
});
