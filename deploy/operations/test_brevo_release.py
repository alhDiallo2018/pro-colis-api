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
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module

release = load('brevo_release', BASE / 'deploy-brevo-fix.py')

class BrevoReleaseTests(unittest.TestCase):
    def test_rejects_extra_arguments_and_non_root(self):
        with patch.object(release, 'load_helper') as loader, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(release.main(['other-revision']), 2)
            with patch.object(release.os, 'geteuid', return_value=1001):
                self.assertEqual(release.main([]), 2)
            loader.assert_not_called()

    def test_reviewed_engine_and_preservation_of_runtime_settings(self):
        self.assertEqual(hashlib.sha256((BASE / 'procolis-deploy').read_bytes()).hexdigest(), release.HELPER_SHA256)
        deploy = load('brevo_engine', BASE / 'procolis-deploy')
        release.configure_release(deploy)
        values = {'MOBILE_ANDROID_LATEST_VERSION': '1.0.1', 'MOBILE_ANDROID_LATEST_VERSION_CODE': 7,
            'MOBILE_ANDROID_MIN_VERSION_CODE': 0, 'MOBILE_ANDROID_UPDATE_ENABLED': False,
            'BREVO_API_KEY': 'keep$secret', 'JWT_ACCESS_SECRET': 'another$secret'}
        result = deploy.runtime_overlay(values)['services']['api']['environment']
        self.assertEqual(result['GOOGLE_WEB_CLIENT_ID'], release.GOOGLE_CLIENT)
        self.assertEqual(result['MOBILE_ANDROID_UPDATE_ENABLED'], 'false')
        self.assertEqual(result['MOBILE_ANDROID_LATEST_VERSION_CODE'], '7')
        self.assertEqual(result['MOBILE_ANDROID_MIN_VERSION_CODE'], '0')
        self.assertEqual(result['BREVO_API_KEY'], 'keep$$secret')
        self.assertEqual(result['JWT_ACCESS_SECRET'], 'another$$secret')
        self.assertEqual(deploy.REVISIONS[deploy.API], release.API_REVISION)
        self.assertEqual(deploy.REVISIONS[deploy.WEB], release.WEB_REVISION)
