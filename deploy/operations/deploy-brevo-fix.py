#!/usr/bin/python3 -I
"""Livraison API/web revue : configuration Brevo et recuperation du code PIN."""
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

HELPER = Path('/usr/local/sbin/procolis-deploy')
HELPER_SHA256 = '8178a618fe9dea7b8f9d12913f45550e3ea93f8f71c16c31a04a29a8f71c2aec'
API_REVISION = '0559781865266f7a671bd8eaedc5f72c9fb304c6'
WEB_REVISION = 'c97fb6586c13fe241387a045c77cf2e16e34e856'
GOOGLE_CLIENT = '856894814285-blm20bnfamss8spptpjvp2c5984rgsni.apps.googleusercontent.com'


def configure_release(deploy):
    # Reutiliser le moteur deja audite conserve ses controles de topologie,
    # sauvegardes et verrou. Seules les deux revisions approuvees changent.
    deploy.REVISIONS = {deploy.API: API_REVISION, deploy.WEB: WEB_REVISION}
    deploy.CLIENT = GOOGLE_CLIENT
    deploy.ENV = {**deploy.ENV, 'APP_RELEASE': WEB_REVISION}


def load_helper():
    info = HELPER.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022
            or hashlib.sha256(HELPER.read_bytes()).hexdigest() != HELPER_SHA256):
        raise RuntimeError('Le moteur de deploiement installe ne correspond pas a la version revue')
    loader = importlib.machinery.SourceFileLoader('trusted_deploy', str(HELPER))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    deploy = importlib.util.module_from_spec(spec)
    loader.exec_module(deploy)
    return deploy


def readiness(deploy):
    # Diagnostic strictement en lecture : aucune cle, adresse ou valeur de
    # configuration privee n'est affichee ; aucun email/SMS de test n'est envoye.
    script = '''
import {prisma} from './src/config/prisma.js';
import {describeBrevoConfig} from './src/utils/brevo.js';
try {
 const row = await prisma.systemConfig.findUnique({where:{key:'brevo'}});
 const config = describeBrevoConfig(row?.value || {});
 process.stdout.write(JSON.stringify({configured:config.apiKeyConfigured, source:config.apiKeySource}));
} finally { await prisma.$disconnect(); }
'''
    with (deploy.STATE / 'brevo-readiness.log').open('ab', buffering=0) as log:
        deploy.LOG = log
        result = json.loads(deploy.docker('exec', '-w', '/app', 'sendprocolis-api', 'node', '--input-type=module', '-e', script))
    print('Configuration Brevo : ' + json.dumps(result), flush=True)
    print('Espace administrateur : https://sendprocolis.com/admin/notifications-brevo', flush=True)


def main(args):
    if args or os.geteuid() != 0:
        print('Executer en administrateur, sans argument.', file=sys.stderr)
        return 2
    try:
        deploy = load_helper()
        configure_release(deploy)
        result = deploy.main([])
        if result:
            return result
        try:
            readiness(deploy)
        except Exception:
            print('Livraison reussie ; verifier la configuration Brevo dans l espace administrateur.', file=sys.stderr)
        return 0
    except Exception as error:
        print('ARRET : ' + type(error).__name__ + '. Aucun secret affiche.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
