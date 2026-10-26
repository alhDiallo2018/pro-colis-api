#!/usr/bin/python3 -I
"""Livraison figée : recherche mondiale Google et choix d'un point précis."""
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.parse
import urllib.request

HELPER = Path('/usr/local/sbin/procolis-deploy')
HELPER_SHA256 = '8178a618fe9dea7b8f9d12913f45550e3ea93f8f71c16c31a04a29a8f71c2aec'
API_REVISION = '4fe4b36ba235365f3c153a83066ce375bbcf26b8'
WEB_REVISION = 'c350eb7fc17b5c71edb7697129f80ac2ba827870'
GOOGLE_CLIENT = '856894814285-blm20bnfamss8spptpjvp2c5984rgsni.apps.googleusercontent.com'
CREDENTIALS = Path('/root/procolis-maps-20261026.json')
ORIGIN = 'https://sendprocolis.com'


def load_credentials():
    info = CREDENTIALS.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('Configuration Maps non protegee')
    values = json.loads(CREDENTIALS.read_text())
    expected = {'GOOGLE_MAPS_API_KEY', 'VITE_GOOGLE_MAPS_API_KEY'}
    if set(values) != expected or any(not isinstance(v, str) or not re.fullmatch(r'AIza[A-Za-z0-9_-]{30,60}', v) for v in values.values()):
        raise RuntimeError('Configuration Maps invalide')
    return values


def load_helper():
    info = HELPER.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022
            or hashlib.sha256(HELPER.read_bytes()).hexdigest() != HELPER_SHA256):
        raise RuntimeError('Moteur de deploiement different de la version revue')
    loader = importlib.machinery.SourceFileLoader('trusted_deploy', str(HELPER))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    deploy = importlib.util.module_from_spec(spec)
    loader.exec_module(deploy)
    return deploy


def verify_maps(deploy, credentials):
    # Ces lectures utilisent des lieux publics, jamais un compte client ni une
    # position personnelle. Toute erreur reste generique pour proteger la cle.
    result = deploy.probe(ORIGIN + '/api/v1/public/places/autocomplete?input=Tokyo')
    if not result.get('data'):
        raise RuntimeError('Recherche mondiale sans resultat')
    place_id = result['data'][0]['place_id']
    details = deploy.probe(ORIGIN + '/api/v1/public/places/details?' + urllib.parse.urlencode({'placeId': place_id}))
    location = details.get('data', {}).get('geometry', {}).get('location', {})
    if not isinstance(location.get('lat'), (int, float)) or not isinstance(location.get('lng'), (int, float)):
        raise RuntimeError('Coordonnees du lieu absentes')
    reverse = deploy.probe(ORIGIN + '/api/v1/public/places/reverse?latitude=35.68434&longitude=139.65870')
    if reverse.get('data', {}).get('geometry', {}).get('location') != {'lat': 35.68434, 'lng': 139.65870}:
        raise RuntimeError('Le point exact a ete modifie')
    with urllib.request.urlopen(ORIGIN + '/', timeout=20) as response:
        html = response.read(1000000).decode()
    assets = re.findall(r'src="(/assets/[^"?]+\.js)"', html)
    verified = False
    for asset in assets:
        with urllib.request.urlopen(ORIGIN + asset, timeout=30) as response:
            bundle = response.read(10000000).decode()
        if '/public/places/autocomplete' in bundle and credentials['VITE_GOOGLE_MAPS_API_KEY'] in bundle:
            verified = True
    if not verified:
        raise RuntimeError('Bundle web ou configuration Maps non verifies')
    print('Recherche mondiale, details, point exact et bundle web verifies.', flush=True)


def configure_release(deploy, credentials):
    # Reutilisation du moteur audite : sauvegarde BD/images/configuration,
    # verrou exclusif, fast-forward Git et remplacement API avant le web.
    deploy.REVISIONS = {deploy.API: API_REVISION, deploy.WEB: WEB_REVISION}
    deploy.CLIENT = GOOGLE_CLIENT
    deploy.ENV = {**deploy.ENV, 'APP_RELEASE': WEB_REVISION}
    original_overlay = deploy.runtime_overlay
    original_deploy = deploy.deploy

    def runtime_overlay(values):
        overlay = original_overlay({**values, 'GOOGLE_MAPS_API_KEY': credentials['GOOGLE_MAPS_API_KEY']})
        # La cle serveur seule ne suffit pas : Vite doit recevoir la cle du SDK
        # navigateur au build. Le complement runtime persiste les deux usages.
        overlay['services']['caddy'] = {'build': {'args': {
            'VITE_GOOGLE_MAPS_API_KEY': credentials['VITE_GOOGLE_MAPS_API_KEY']
        }}}
        return overlay

    def run_release(backup):
        original_deploy(backup)
        deploy.stage('verification de la recherche mondiale et du web')
        verify_maps(deploy, credentials)

    deploy.runtime_overlay = runtime_overlay
    deploy.deploy = run_release


def main(args):
    if args or os.geteuid() != 0:
        print('Executer en administrateur, sans argument.', file=sys.stderr)
        return 2
    try:
        credentials = load_credentials()
        deploy = load_helper()
        configure_release(deploy, credentials)
        return deploy.main([])
    except Exception as error:
        print('ARRET : ' + type(error).__name__ + '. Aucun secret affiche.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
