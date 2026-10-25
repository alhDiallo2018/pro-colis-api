import contextlib
import importlib.machinery
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

base = Path(__file__).parent
loader = importlib.machinery.SourceFileLoader('deployment_report', str(base / 'procolis-deploy-report'))
spec = importlib.util.spec_from_loader(loader.name, loader)
report = importlib.util.module_from_spec(spec)
loader.exec_module(report)


class DeploymentReportTests(unittest.TestCase):
    def test_never_returns_raw_errors_or_secrets(self):
        raw = 'password authentication failed for user secret-user\npostgresql://user:secret@host/db\nError P1000\nInvalid environment configuration BREVO_SENDER_EMAIL secret@example.com'
        result = report.known_errors(raw)
        self.assertEqual(set(result), {'database_authentication', 'P1000', 'invalid_environment', 'brevo_sender_email'})
        self.assertNotIn('secret', str(result))

    def test_report_refuses_paths_and_extra_arguments(self):
        with patch.object(report, 'inspect') as inspect, contextlib.redirect_stderr(io.StringIO()):
            for args in [['/etc/shadow'], ['--logs'], ['status', 'extra']]:
                self.assertEqual(report.main(args), 2)
            inspect.assert_not_called()

    def test_report_requires_root(self):
        with patch.object(report.os, 'geteuid', return_value=1001), patch.object(report, 'inspect') as inspect, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(report.main([]), 1)
            inspect.assert_not_called()

    def test_generated_installers_embed_exact_reviewed_files(self):
        for name in ['install-procolis-deploy.sh', 'update-procolis-deploy.sh']:
            content = (base / name).read_text()
            for source in ['procolis-deploy', 'procolis-deploy-report', 'procolis-deploy.sudoers']:
                self.assertIn((base / source).read_text(), content)
            self.assertIn('flock -n 9', content)
            self.assertIn('/usr/sbin/visudo -c', content)
        self.assertIn('5299980c4c84a821a508c9be8810442c1d9395e107c98e287d8eb973e1fbb105', (base / 'update-procolis-deploy.sh').read_text())
