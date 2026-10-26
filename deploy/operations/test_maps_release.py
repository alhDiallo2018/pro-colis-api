import contextlib
import hashlib
import importlib.machinery
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

BASE = Path(__file__).parent

def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module

release = load('maps_release', BASE / 'deploy-maps-release.py')

class MapsReleaseTests(unittest.TestCase):
    def test_rejects_extra_arguments_and_non_root(self):
        with patch.object(release, 'load_credentials') as reader, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(release.main(['different-revision']), 2)
            with patch.object(release.os, 'geteuid', return_value=1001):
                self.assertEqual(release.main([]), 2)
            reader.assert_not_called()

    def test_preserves_secrets_and_injects_both_maps_configurations(self):
        self.assertEqual(hashlib.sha256((BASE / 'procolis-deploy').read_bytes()).hexdigest(), release.HELPER_SHA256)
        deploy = load('maps_engine', BASE / 'procolis-deploy')
        release.configure_release(deploy, {'GOOGLE_MAPS_API_KEY': 'server-key', 'VITE_GOOGLE_MAPS_API_KEY': 'browser-key'})
        overlay = deploy.runtime_overlay({'JWT_ACCESS_SECRET': 'keep$secret', 'BREVO_API_KEY': 'keep$brevo',
            'MOBILE_ANDROID_UPDATE_ENABLED': False, 'MOBILE_ANDROID_LATEST_VERSION_CODE': 7})
        env = overlay['services']['api']['environment']
        self.assertEqual(env['JWT_ACCESS_SECRET'], 'keep$$secret')
        self.assertEqual(env['BREVO_API_KEY'], 'keep$$brevo')
        self.assertEqual(env['MOBILE_ANDROID_UPDATE_ENABLED'], 'false')
        self.assertEqual(env['MOBILE_ANDROID_LATEST_VERSION_CODE'], '7')
        self.assertEqual(env['GOOGLE_MAPS_API_KEY'], 'server-key')
        self.assertEqual(env['GOOGLE_WEB_CLIENT_ID'], release.GOOGLE_CLIENT)
        self.assertEqual(overlay['services']['caddy']['build']['args']['VITE_GOOGLE_MAPS_API_KEY'], 'browser-key')
        self.assertEqual(deploy.REVISIONS[deploy.API], release.API_REVISION)
        self.assertEqual(deploy.REVISIONS[deploy.WEB], release.WEB_REVISION)

    def test_live_checks_run_before_success_marker(self):
        deploy = load('maps_engine_order', BASE / 'procolis-deploy')
        calls = []
        deploy.deploy = lambda backup: calls.append('deploy')
        deploy.stage = lambda name: None
        with patch.object(release, 'verify_maps', side_effect=lambda *_: calls.append('verify')):
            release.configure_release(deploy, {})
            deploy.deploy(Path('/unused'))
        self.assertEqual(calls, ['deploy', 'verify'])
