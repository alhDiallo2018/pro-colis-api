#!/usr/bin/python3 -I
"""Compare deux connexions PostgreSQL depuis leurs conteneurs, sans donnees metier."""
import json
import os
import select
import subprocess
import sys
import time
import uuid

CONTAINERS = ('sendprocolis-api', 'procolis-node-api')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'}
PROGRAM = r"""
import {env} from './src/config/env.js';
import {PrismaClient} from '@prisma/client';
import {createInterface} from 'node:readline';
const marker = process.argv[1];
const input = createInterface({input: process.stdin, crlfDelay: Infinity});
const incoming = input[Symbol.asyncIterator]();
const client = new PrismaClient({datasources: {db: {url: env.DATABASE_URL}}, log: []});
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const deadline = setTimeout(() => process.exit(2), 65000);
try {
  await client.$transaction(async tx => {
    // Transaction dediee, ephemere et en lecture seule. Le marqueur est un
    // parametre de cette session, jamais une ligne ajoutee a une table.
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
    await tx.$queryRaw`SELECT set_config('application_name', ${marker}, true)`;
    const [metadata] = await tx.$queryRawUnsafe(`SELECT
      current_database()::text AS "database",
      (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS "databaseOid",
      current_schema()::text AS "schema",
      current_schemas(false)::text[] AS "searchSchemas",
      inet_server_addr()::text AS "serverAddress",
      inet_server_port() AS "serverPort",
      extract(epoch FROM pg_postmaster_start_time())::text AS "serverStartedAtEpoch",
      pg_is_in_recovery() AS "isReplica",
      current_setting('server_version') AS "version"`);
    // L'identifiant du cluster peut etre reserve a l'administrateur. Un refus
    // ne doit ni invalider toute la transaction ni etre pris pour une difference.
    await tx.$executeRawUnsafe('SAVEPOINT cluster_probe');
    try {
      const [control] = await tx.$queryRawUnsafe(
        'SELECT system_identifier::text AS id FROM pg_catalog.pg_control_system()');
      metadata.systemIdentifier = control.id;
    } catch {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT cluster_probe');
      metadata.systemIdentifier = null;
    }
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT cluster_probe');
    emit({event: 'ready', metadata});
    while (true) {
      const line = await incoming.next();
      if (line.done) break;
      const message = JSON.parse(line.value);
      if (message.action === 'close') break;
      if (message.action !== 'probe' || !/^pcdiag-[a-f0-9]{32}-[01]$/.test(message.peer)) {
        throw new Error('Invalid probe');
      }
      // pg_stat_activity est local a l'instance. Deux sessions qui voient
      // leurs marqueurs aleatoires respectifs partagent le meme serveur actif.
      // Vider seulement le cache de statistiques de CETTE session, pas les compteurs.
      await tx.$queryRawUnsafe('SELECT pg_stat_clear_snapshot()::text AS cleared');
      const [result] = await tx.$queryRaw`SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE application_name = ${message.peer} AND pid <> pg_backend_pid()
      ) AS "seesPeer"`;
      emit({event: 'observation', seesPeer: result.seesPeer});
    }
  }, {timeout: 60000, maxWait: 10000});
} catch {
  // Les erreurs de connexion peuvent contenir une URL : aucun message brut.
  emit({event: 'error', error: 'DATABASE_PROBE_FAILED'});
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  input.close();
  await client.$disconnect();
}
"""


def receive(process, expected, timeout=25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        if not select.select([process.stdout], [], [], remaining)[0]:
            break
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('Processus de diagnostic termine')
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if value.get('event') == 'error':
            raise RuntimeError('Connexion ou requete de diagnostic refusee')
        if value.get('event') == expected:
            return value
    raise RuntimeError('Delai de diagnostic depasse')


def classify(metadata, observations):
    a, b = metadata
    instance = None
    reason = 'Preuve insuffisante : visibilite des sessions ou privileges limites.'
    if all(observations):
        instance = True
        reason = 'Les deux sessions simultanees voient leurs marqueurs respectifs.'
    elif a.get('systemIdentifier') and b.get('systemIdentifier'):
        if a['systemIdentifier'] != b['systemIdentifier']:
            instance = False
            reason = 'Identifiants de clusters PostgreSQL differents.'
        elif a.get('serverStartedAtEpoch') and b.get('serverStartedAtEpoch') and a['serverStartedAtEpoch'] != b['serverStartedAtEpoch']:
            instance = False
            reason = 'Meme lignee de cluster, mais deux processus serveur distincts (replica ou clone possible).'
    database = None
    if instance is True:
        database = a['database'] == b['database'] and a['databaseOid'] == b['databaseOid']
    elif instance is False or a['database'] != b['database']:
        database = False
    return {'samePostgresInstance': instance, 'samePhysicalDatabase': database,
            'sameApplicationSchema': a.get('schema') == b.get('schema')
            if database is True else None,
            'sameSearchSchemas': a.get('searchSchemas') == b.get('searchSchemas')
            if database is True else None,
            'evidence': reason}


def diagnose(commands=None):
    processes = []
    markers = ['pcdiag-' + uuid.uuid4().hex + '-' + str(i) for i in range(2)]
    try:
        # Les deux connexions restent ouvertes simultanement. Les URL sont lues
        # uniquement dans leur conteneur d'origine : leurs DNS/reseaux sont preserves.
        for index, name in enumerate(CONTAINERS):
            args = commands[index](markers[index]) if commands else [
                '/usr/bin/docker', 'exec', '-i', '--workdir', '/app', name,
                'node', '--input-type=module', '-e', PROGRAM, markers[index]]
            processes.append(subprocess.Popen(args, cwd='/', env=ENV, stdin=subprocess.PIPE,
                                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                               text=True, bufsize=1))
        metadata = [receive(process, 'ready')['metadata'] for process in processes]
        for index, process in enumerate(processes):
            process.stdin.write(json.dumps({'action': 'probe', 'peer': markers[1-index]}) + '\n')
            process.stdin.flush()
        observations = [receive(process, 'observation', 10)['seesPeer'] for process in processes]
        return {'connections': dict(zip(CONTAINERS, metadata)),
                'peerVisible': dict(zip(CONTAINERS, observations)),
                'conclusion': classify(metadata, observations)}
    finally:
        # La fermeture concerne uniquement les processus temporaires lances par
        # ce diagnostic ; les API et leurs connexions de production restent intactes.
        for process in processes:
            try:
                process.stdin.write('{"action":"close"}\n')
                process.stdin.flush()
                process.stdin.close()
            except (BrokenPipeError, OSError):
                pass
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def main():
    if len(sys.argv) != 1 or os.geteuid() != 0:
        print('Executer ce diagnostic sans argument, via sudo.', file=sys.stderr)
        return 2
    try:
        print(json.dumps(diagnose(), ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        # Ne pas imprimer de stderr Docker/Prisma ou d'URL de connexion.
        print(json.dumps({'error': 'DATABASE_IDENTITY_UNAVAILABLE',
                          'kind': type(error).__name__,
                          'conclusion': 'Impossible de conclure avec ce diagnostic.'}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
