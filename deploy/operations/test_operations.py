import contextlib
import importlib.machinery
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

loader = importlib.machinery.SourceFileLoader('operations', str(Path(__file__).with_name('procolis-ops')))
spec = importlib.util.spec_from_loader(loader.name, loader)
ops = importlib.util.module_from_spec(spec)
loader.exec_module(ops)


class OperationsSecurityTests(unittest.TestCase):
    def test_refuses_arbitrary_or_extra_arguments(self):
        for args in ([], ['restart'], ['status', 'anything'], ['logs;sh'], ['--help']):
            with self.subTest(args=args), patch.object(ops, 'run') as run:
                with contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(ops.main(args), 2)
                run.assert_not_called()

    def test_refuses_non_root_execution(self):
        with patch.object(ops.os, 'geteuid', return_value=1001), patch.object(ops, 'run') as run:
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(ops.main(['status']), 1)
            run.assert_not_called()

    def test_inspect_filters_secrets_and_health_command_output(self):
        row = {'Name': '/sendprocolis-api', 'Image': 'sha256:test',
               'Config': {'Image': 'api:test', 'Env': ['PASSWORD=secret'], 'Labels': {'secret': 'private'}},
               'State': {'Status': 'running', 'Health': {'Status': 'healthy', 'Log': ['secret output']}},
               'NetworkSettings': {'Ports': {}}}
        result = str(ops.summary(row))
        self.assertNotIn('secret', result)
        self.assertNotIn('private', result)
        self.assertIn('healthy', result)

    def test_commands_ignore_callers_environment_and_directory(self):
        with patch.object(ops.subprocess, 'run', return_value=Mock(returncode=0)) as run:
            ops.run(['/usr/bin/docker', 'inspect', 'sendprocolis-api'])
            self.assertEqual(run.call_args.kwargs['cwd'], '/')
            self.assertEqual(run.call_args.kwargs['env'], ops.ENV)
            self.assertNotIn('shell', run.call_args.kwargs)
            self.assertEqual(run.call_args.kwargs['stdin'], ops.subprocess.DEVNULL)

    def test_configuration_comparison_does_not_expose_fingerprints(self):
        values = {name: {'JWT_ACCESS_SECRET': {'present': True, 'fingerprint': 'private-hmac'}}
                  for name in ops.API_NAMES}
        result = ops.compare_configs(values)
        self.assertTrue(result['JWT_ACCESS_SECRET']['equal'])
        self.assertIsNone(result['DATABASE_URL']['equal'])
        self.assertNotIn('private-hmac', str(result))
        values[ops.API_NAMES[1]]['JWT_ACCESS_SECRET']['fingerprint'] = 'different'
        self.assertFalse(ops.compare_configs(values)['JWT_ACCESS_SECRET']['equal'])

    def test_installer_contains_current_helper(self):
        base = Path(__file__).parent
        self.assertIn((base / 'procolis-ops').read_text(), (base / 'install-procolis-ops.sh').read_text())

    def test_sudoers_has_only_exact_actions(self):
        rules = Path(__file__).with_name('procolis-ops.sudoers').read_text()
        self.assertNotIn('*', rules)
        for action in ops.ACTIONS:
            self.assertIn('/usr/local/sbin/procolis-ops ' + action, rules)
        self.assertIn('NOSETENV:', rules)


if __name__ == '__main__':
    unittest.main()
