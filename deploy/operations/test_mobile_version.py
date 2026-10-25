import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('mobile_version', Path(__file__).with_name('apply-mobile-version-1.0.1.py'))
mobile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mobile)


class MobileVersionTests(unittest.TestCase):
    def test_only_three_keys_change_and_input_is_preserved(self):
        original = {'services': {'api': {'environment': {'JWT_ACCESS_SECRET': 'a$$b',
            'MOBILE_ANDROID_UPDATE_ENABLED': 'false', 'MOBILE_ANDROID_RELEASE_NOTES_FR': 'Notes existantes'}},
            'caddy': {'image': 'existing'}}}
        result = mobile.updated_runtime(original)
        self.assertNotIn('MOBILE_ANDROID_LATEST_VERSION', original['services']['api']['environment'])
        self.assertEqual(result['services']['api']['environment'], {**original['services']['api']['environment'], **mobile.VALUES})
        self.assertEqual(result['services']['caddy'], original['services']['caddy'])

    def test_no_arguments_or_non_root_can_apply(self):
        with patch.object(mobile, 'load_helper') as load, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(mobile.main(['anything']), 2)
            with patch.object(mobile.os, 'geteuid', return_value=1001):
                self.assertEqual(mobile.main([]), 2)
            load.assert_not_called()

    def exercise(self, fail=False, secret_changed=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / 'runtime.json'
            original = b'{"services":{"api":{"environment":{"JWT_ACCESS_SECRET":"keep$$secret"}}}}'
            runtime.write_bytes(original)
            runtime.chmod(0o600)
            before = {'MOBILE_ANDROID_UPDATE_ENABLED': False, 'JWT_ACCESS_SECRET': 'keep$secret',
                'MOBILE_ANDROID_LATEST_VERSION': '1.0.0', 'MOBILE_ANDROID_LATEST_VERSION_CODE': 6, 'MOBILE_ANDROID_MIN_VERSION_CODE': 0}
            after = {**before, **mobile.PARSED}
            if secret_changed:
                after['JWT_ACCESS_SECRET'] = 'unexpected'
            row = {'Id': 'container-id', 'Image': 'image-id', 'State': {'Running': True}, 'Config': {'Labels': {
                'com.docker.compose.project': 'sendprocolis-web', 'com.docker.compose.project.working_dir': '/web'}}}
            deploy = Mock(RUNTIME=runtime, WEB=Path('/web'), SNAPSHOT='snapshot')
            deploy.docker.side_effect = [json.dumps([row]), json.dumps(before), json.dumps([{'Id': 'image-id'}]), json.dumps([row]), json.dumps([{'Id': 'image-id'}])]
            deploy.compose.side_effect = [json.dumps({'services': {'api': {'image': 'api:latest'}}}), json.dumps(after), b'', b'']
            policy = {'enabled': False, 'latestVersion': '1.0.0', 'latestVersionCode': 6, 'minVersionCode': 0, 'releaseNotes': {'fr': '', 'en': ''}}
            waits = [RuntimeError('failed probe'), None] if fail else [None]
            with patch.object(mobile, 'protected_file'), patch.object(mobile, 'public_policy', return_value=policy), patch.object(mobile, 'wait_policy', side_effect=waits), contextlib.redirect_stdout(io.StringIO()):
                if fail or secret_changed:
                    with self.assertRaises(RuntimeError):
                        mobile.apply(deploy, root)
                    self.assertEqual(runtime.read_bytes(), original)
                else:
                    mobile.apply(deploy, root)
                    self.assertEqual(json.loads(runtime.read_bytes()), mobile.updated_runtime(json.loads(original)))
            updates = [call for call in deploy.compose.call_args_list if call.args[0] == 'up']
            self.assertEqual(len(updates), 0 if secret_changed else 2 if fail else 1)
            for call in updates:
                self.assertEqual(call.args, ('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'api'))
            self.assertEqual(deploy.RUNTIME, runtime)
            self.assertEqual((root / 'runtime-before.json').read_bytes(), original)

    def test_apply_preserves_secrets_and_recreates_api_only(self):
        self.exercise()

    def test_failed_public_check_restores_configuration_and_api(self):
        self.exercise(fail=True)

    def test_changed_secret_stops_before_recreation(self):
        self.exercise(secret_changed=True)
