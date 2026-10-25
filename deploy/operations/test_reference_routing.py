"""Safety checks for the narrowly scoped routing correction."""
import copy
import importlib.util
from pathlib import Path
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


persist = load('persist', 'persist-reference-api.py')
live = load('live', 'pin-reference-api-live.py')


class RoutingTests(unittest.TestCase):
    def test_only_generated_hide_path_is_normalized(self):
        staged = '/tmp/procolis-reference-test.Caddyfile'
        before = {'routes': [
            {'handler': 'file_server', 'hide': [staged, '/srv/.env', '/tmp/other']},
            {'handler': 'static_response', 'body': staged, 'hide': [staged]}]}
        untouched = copy.deepcopy(before)
        after = persist.normalize_validation_path(before, staged)
        self.assertEqual(before, untouched)
        self.assertEqual(after['routes'][0]['hide'], ['/etc/caddy/Caddyfile', '/srv/.env', '/tmp/other'])
        self.assertEqual(after['routes'][1], before['routes'][1])

    def test_real_hide_policy_or_route_changes_remain_different(self):
        staged = '/tmp/procolis-reference-test.Caddyfile'
        live_config = {'handler': 'file_server', 'hide': ['/etc/caddy/Caddyfile', '/srv/.env']}
        changed = {'handler': 'file_server', 'hide': [staged]}
        self.assertNotEqual(persist.normalize_validation_path(changed, staged), live_config)
        changed['root'] = '/other'
        self.assertNotEqual(persist.normalize_validation_path(changed, staged), live_config)

    def test_patch_preserves_unrelated_config_and_comments(self):
        original = (b'# reverse_proxy api:8080\nhandle {\n\treverse_proxy api:8080 # REST\n}\n'
                    b'reverse_proxy alloy:12347\n\treverse_proxy api:8080\n')
        expected = original.replace(b'\treverse_proxy api:8080', b'\treverse_proxy sendprocolis-api:8080')
        self.assertEqual(persist.patch(original), expected)

    def test_unexpected_route_counts_abort(self):
        for data in [b'', b'reverse_proxy api:8080\n', b'reverse_proxy api:8080\n' * 3]:
            with self.assertRaises(RuntimeError):
                persist.patch(data)

    def test_already_fixed_file_is_accepted(self):
        data = b'reverse_proxy sendprocolis-api:8080\n' * 2
        self.assertEqual(persist.patch(data), data)

    def test_exactly_targeted_json_changes(self):
        before = {'routes': [
            {'handler': 'reverse_proxy', 'upstreams': [{'dial': 'api:8080'}]},
            {'handler': 'reverse_proxy', 'upstreams': [{'dial': 'api:8080'}]},
            {'handler': 'reverse_proxy', 'upstreams': [{'dial': 'alloy:12347'}]},
            {'handler': 'static_response', 'body': 'api:8080'}]}
        after = copy.deepcopy(before)
        self.assertEqual(live.replace_upstreams(after), 2)
        self.assertEqual(after['routes'][2:], before['routes'][2:])
        self.assertEqual(persist.patch_live_check(after), 2)
        with self.assertRaises(RuntimeError):
            persist.patch_live_check(before)


if __name__ == '__main__':
    unittest.main()
