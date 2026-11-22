import contextlib
import importlib.machinery
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

loader = importlib.machinery.SourceFileLoader(
    'entry', str(Path(__file__).with_name('procolis-ops-entry'))
)
spec = importlib.util.spec_from_loader(loader.name, loader)
entry = importlib.util.module_from_spec(spec)
loader.exec_module(entry)


class ProcolisOpsEntryTests(unittest.TestCase):
    def test_refuses_empty_command(self):
        with patch.dict(entry.os.environ, {'SSH_ORIGINAL_COMMAND': ''}, clear=False), \
             patch.object(entry.subprocess, 'run') as run:
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(entry.main(), 2)
            run.assert_not_called()

    def test_refuses_unknown_verb(self):
        for value in ('shell', 'status;sh', 'status anything', 'bash', '--help', 'LOGS'):
            with self.subTest(value=value):
                with patch.dict(entry.os.environ, {'SSH_ORIGINAL_COMMAND': value}, clear=False), \
                     patch.object(entry.subprocess, 'run') as run:
                    with contextlib.redirect_stderr(io.StringIO()):
                        self.assertEqual(entry.main(), 2)
                    run.assert_not_called()

    def test_refuses_extra_arguments(self):
        # Les verbes valides ne doivent pas accepter de suffixe. "logs --tail=5"
        # est traite comme un verbe inconnu, pas comme "logs".
        for value in ('status x', 'logs --tail=5', 'deploy --force', 'sysdiag now'):
            with self.subTest(value=value):
                with patch.dict(entry.os.environ, {'SSH_ORIGINAL_COMMAND': value}, clear=False), \
                     patch.object(entry.subprocess, 'run') as run:
                    with contextlib.redirect_stderr(io.StringIO()):
                        self.assertEqual(entry.main(), 2)
                    run.assert_not_called()

    def test_whitelist_contains_expected_verbs(self):
        expected = {'status', 'routing', 'health', 'logs', 'deployment-info',
                    'sysdiag', 'deploy', 'deploy-report'}
        self.assertEqual(set(entry.COMMANDS), expected)

    def test_commands_target_fixed_absolute_paths(self):
        for verb, args in entry.COMMANDS.items():
            with self.subTest(verb=verb):
                self.assertEqual(args[0], '/usr/bin/sudo')
                self.assertEqual(args[1], '-n')
                for part in args[2:]:
                    self.assertTrue(part.startswith('/') or '-' not in part[:1])
                self.assertTrue(args[2].startswith('/usr/local/sbin/procolis-'))

    def test_executes_mapped_verb_with_isolated_environment(self):
        captured = Mock(returncode=0)
        with patch.dict(entry.os.environ, {'SSH_ORIGINAL_COMMAND': 'status'}, clear=False), \
             patch.object(entry.subprocess, 'run', return_value=captured) as run:
            self.assertEqual(entry.main(), 0)
        run.assert_called_once()
        call = run.call_args
        self.assertEqual(call.args[0], entry.COMMANDS['status'])
        self.assertEqual(call.kwargs['cwd'], '/')
        self.assertEqual(call.kwargs['env'], entry.ENV)
        self.assertNotIn('shell', call.kwargs)
        self.assertEqual(call.kwargs['stdin'], entry.subprocess.DEVNULL)

    def test_propagates_subcommand_exit_code(self):
        captured = Mock(returncode=7)
        with patch.dict(entry.os.environ, {'SSH_ORIGINAL_COMMAND': 'deploy-report'}, clear=False), \
             patch.object(entry.subprocess, 'run', return_value=captured):
            self.assertEqual(entry.main(), 7)

    def test_timeout_returns_124(self):
        def slow(*args, **kwargs):
            raise entry.subprocess.TimeoutExpired(cmd=args[0], timeout=1800)
        with patch.dict(entry.os.environ, {'SSH_ORIGINAL_COMMAND': 'logs'}, clear=False), \
             patch.object(entry.subprocess, 'run', side_effect=slow):
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(entry.main(), 124)


if __name__ == '__main__':
    unittest.main()
