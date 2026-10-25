import contextlib
import copy
import importlib.machinery
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

base = Path(__file__).parent
loader = importlib.machinery.SourceFileLoader('deployment', str(base / 'procolis-deploy'))
spec = importlib.util.spec_from_loader(loader.name, loader)
deploy = importlib.util.module_from_spec(spec)
loader.exec_module(deploy)


def config():
    result = {'services': {}, 'volumes': {}}
    for service, path, mounts in [('api', deploy.API, {'api-uploads': '/app/uploads'}),
                                   ('caddy', deploy.WEB, {'caddy-data': '/data', 'caddy-config': '/config'})]:
        result['services'][service] = {'container_name': 'sendprocolis-' + service,
            'build': {'context': str(path), 'dockerfile': 'Dockerfile'},
            'networks': {'default': {}, 'observability': {}},
            'volumes': [{'type': 'volume', 'source': source, 'target': target} for source, target in mounts.items()]}
        for source in mounts:
            result['volumes'][source] = {'name': 'sendprocolis-web_' + source}
    return result


class DeploymentTests(unittest.TestCase):
    def test_no_arguments_can_reach_root_operations(self):
        for args in [['--help'], ['deploy'], ['/tmp/anything'], [';sh']]:
            with patch.object(deploy, 'private_directory') as operation, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(deploy.main(args), 2)
                operation.assert_not_called()

    def test_non_root_cannot_deploy(self):
        with patch.object(deploy.os, 'geteuid', return_value=1001), patch.object(deploy, 'private_directory') as operation, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(deploy.main([]), 1)
            operation.assert_not_called()

    def test_known_topology_allowed(self):
        deploy.validate_config(config())

    def test_host_access_and_build_overrides_rejected(self):
        mutations = [
            lambda c: c['services']['api'].update(privileged=True),
            lambda c: c['services']['api'].update(network_mode='host'),
            lambda c: c['services']['api'].update(cap_add=['SYS_ADMIN']),
            lambda c: c['services']['api'].update(post_start=[{'command': 'sh'}]),
            lambda c: c['services']['api'].update(volumes=[{'type': 'bind', 'source': '/', 'target': '/app/uploads'}]),
            lambda c: c['services']['api']['build'].update(context='/tmp/operator'),
            lambda c: c['services']['api']['build'].update(dockerfile_inline='FROM alpine'),
            lambda c: c['services']['api']['build'].update(ssh=['default']),
            lambda c: c['volumes']['api-uploads'].update(name='unrelated_data'),
            lambda c: c['volumes']['api-uploads'].update(driver_opts={'device': '/', 'o': 'bind'}),
            lambda c: c['services']['caddy'].update(ports=[{'published': '2019', 'target': 2019}]),
            lambda c: c['services']['api'].update(ports=[{'published': '8080', 'target': 8080}]),
        ]
        for mutation in mutations:
            value = config(); mutation(value)
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                deploy.validate_config(value)

    def test_secrets_survive_compose_interpolation(self):
        result = deploy.runtime_overlay({'JWT_ACCESS_SECRET': 'abc$UNSET${HOME}$$xyz',
                                         'REQUIRE_DRIVER_VERIFICATION': False, 'UNSET': None})
        env = result['services']['api']['environment']
        self.assertEqual(env['JWT_ACCESS_SECRET'].replace('$$', '$'), 'abc$UNSET${HOME}$$xyz')
        self.assertEqual(env['REQUIRE_DRIVER_VERIFICATION'], 'false')
        self.assertNotIn('UNSET', env)
        self.assertEqual(env['GOOGLE_WEB_CLIENT_ID'], deploy.CLIENT)

    def test_build_symlinks_and_writable_files_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            target = path / 'source'; target.write_text('trusted'); target.chmod(0o600)
            deploy.trusted_tree(path, os.getuid())
            target.chmod(0o666)
            with self.assertRaises(RuntimeError): deploy.trusted_tree(path, os.getuid())
            target.chmod(0o600)
            (path / 'linked').symlink_to(target)
            with self.assertRaises(RuntimeError): deploy.trusted_tree(path, os.getuid())

    def test_local_application_changes_stop_before_fetch(self):
        with patch.object(deploy, 'git', return_value=b'src/app.js\n') as git:
            with self.assertRaises(RuntimeError): deploy.update_repo(deploy.API, Path('/unused'))
            self.assertEqual(git.call_count, 1)

    def test_process_cannot_inherit_operator_environment_or_stdin(self):
        process = Mock(returncode=0)
        process.communicate.return_value = (b'ok', None)
        manager = Mock(); manager.__enter__ = Mock(return_value=process); manager.__exit__ = Mock(return_value=False)
        with patch.object(deploy.subprocess, 'Popen', return_value=manager) as popen:
            self.assertEqual(deploy.run(['/usr/bin/docker', 'version']), b'ok')
            kwargs = popen.call_args.kwargs
            self.assertEqual(kwargs['env'], deploy.ENV)
            self.assertEqual(kwargs['cwd'], '/')
            self.assertEqual(kwargs['stdin'], deploy.subprocess.DEVNULL)
            self.assertNotIn('shell', kwargs)
            self.assertTrue(kwargs['start_new_session'])

    def test_rule_grants_only_no_argument_entrypoint(self):
        rule = (base / 'procolis-deploy.sudoers').read_text()
        self.assertIn('/usr/local/sbin/procolis-deploy ""', rule)
        self.assertIn('NOSETENV:', rule)
        self.assertNotIn('*', rule)
        self.assertNotIn('/usr/bin/docker', rule)
        self.assertNotIn('NOPASSWD: ALL', rule)

    def test_installer_embeds_exact_reviewed_files(self):
        installer = (base / 'install-procolis-deploy.sh').read_text()
        self.assertIn((base / 'procolis-deploy').read_text(), installer)
        self.assertIn((base / 'procolis-deploy.sudoers').read_text(), installer)


if __name__ == '__main__':
    unittest.main()
