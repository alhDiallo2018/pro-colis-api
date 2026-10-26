import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('google_web_client', Path(__file__).with_name('apply-google-web-client.py'))
oauth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oauth)


class GoogleWebClientTests(unittest.TestCase):
    def test_only_client_changes_and_mobile_policy_is_preserved(self):
        original = {'services': {'api': {'environment': {'JWT_ACCESS_SECRET': 'a$$b',
            'MOBILE_ANDROID_UPDATE_ENABLED': 'false', 'MOBILE_ANDROID_RELEASE_NOTES_FR': 'Notes existantes'}},
            'caddy': {'image': 'existing'}}}
        result = oauth.updated_runtime(original)
        self.assertNotIn('GOOGLE_WEB_CLIENT_ID', original['services']['api']['environment'])
        self.assertEqual(result['services']['api']['environment'], {**original['services']['api']['environment'], **oauth.VALUES})
        self.assertEqual(result['services']['caddy'], original['services']['caddy'])

    def test_no_arguments_or_non_root_can_apply(self):
        with patch.object(oauth, 'load_helper') as load, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(oauth.main(['anything']), 2)
            with patch.object(oauth.os, 'geteuid', return_value=1001):
                self.assertEqual(oauth.main([]), 2)
            load.assert_not_called()

    def exercise(self, fail=False, secret_changed=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / 'runtime.json'
            original = b'{"services":{"api":{"environment":{"JWT_ACCESS_SECRET":"keep$$secret"}}}}'
            runtime.write_bytes(original)
            runtime.chmod(0o600)
            dotenv = root / '.env'
            old_dotenv = b'JWT_ACCESS_SECRET=keep$secret\nGOOGLE_WEB_CLIENT_ID=old-client\n'
            dotenv.write_bytes(old_dotenv)
            dotenv.chmod(0o600)
            before = {'GOOGLE_WEB_CLIENT_ID': 'old-client', 'MOBILE_ANDROID_UPDATE_ENABLED': False, 'JWT_ACCESS_SECRET': 'keep$secret',
                'MOBILE_ANDROID_LATEST_VERSION': '1.0.0', 'MOBILE_ANDROID_LATEST_VERSION_CODE': 6, 'MOBILE_ANDROID_MIN_VERSION_CODE': 0}
            after = {**before, **oauth.VALUES}
            if secret_changed:
                after['JWT_ACCESS_SECRET'] = 'unexpected'
            row = {'Id': 'container-id', 'Image': 'image-id', 'State': {'Running': True}, 'Config': {'Labels': {
                'com.docker.compose.project': 'sendprocolis-web', 'com.docker.compose.project.working_dir': str(root)}}}
            deploy = Mock(RUNTIME=runtime, WEB=root, SNAPSHOT='snapshot')
            deploy.docker.side_effect = [json.dumps([row]), json.dumps(before), json.dumps([{'Id': 'image-id'}]), json.dumps([row]), json.dumps([{'Id': 'image-id'}])]
            deploy.compose.side_effect = [json.dumps({'services': {'api': {'image': 'api:latest'}}}), json.dumps(after), b'', b'']
            policy = {'enabled': True, 'serverClientId': 'old-client'}
            waits = [RuntimeError('failed probe'), None] if fail else [None]
            with patch.object(oauth.pwd, 'getpwnam', return_value=Mock(pw_uid=os.getuid())), patch.object(oauth, 'protected_file'), patch.object(oauth, 'public_policy', return_value=policy), patch.object(oauth, 'wait_policy', side_effect=waits), contextlib.redirect_stdout(io.StringIO()):
                if fail or secret_changed:
                    with self.assertRaises(RuntimeError):
                        oauth.apply(deploy, root)
                    self.assertEqual(runtime.read_bytes(), original)
                    self.assertEqual(dotenv.read_bytes(), old_dotenv)
                else:
                    oauth.apply(deploy, root)
                    self.assertEqual(json.loads(runtime.read_bytes()), oauth.updated_runtime(json.loads(original)))
                    self.assertEqual(dotenv.read_text(), oauth.updated_dotenv(old_dotenv.decode()))
                    self.assertEqual(dotenv.stat().st_uid, os.getuid())
                    self.assertEqual(dotenv.stat().st_mode & 0o777, 0o600)
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

    def test_dotenv_removes_duplicate_assignments_and_preserves_other_values(self):
        content = '# commentaire\nGOOGLE_WEB_CLIENT_ID=old\nJWT_ACCESS_SECRET=keep$secret\nexport GOOGLE_WEB_CLIENT_ID="another"\nCOMPOSE_FILE=existing\n'
        result = oauth.updated_dotenv(content)
        self.assertEqual(result.count('GOOGLE_WEB_CLIENT_ID='), 1)
        self.assertIn('JWT_ACCESS_SECRET=keep$secret\n', result)
        self.assertIn('COMPOSE_FILE=existing\n', result)
        self.assertIn('GOOGLE_WEB_CLIENT_ID=' + oauth.CLIENT + '\n', result)
