import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('identity', Path(__file__).with_name('check-database-identity.py'))
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)

class DatabaseIdentityTests(unittest.TestCase):
    def setUp(self):
        self.a = {'database': 'app', 'databaseOid': '123', 'schema': 'public',
                  'searchSchemas': ['public'], 'systemIdentifier': '111', 'serverStartedAtEpoch': '100.123456'}

    def test_same_instance_same_database_confirmed_by_live_sessions(self):
        self.assertTrue(identity.classify([self.a, dict(self.a)], [True, True])['samePhysicalDatabase'])

    def test_same_server_different_databases_are_not_confused(self):
        b = {**self.a, 'database': 'other', 'databaseOid': '456'}
        result = identity.classify([self.a, b], [True, True])
        self.assertTrue(result['samePostgresInstance'])
        self.assertFalse(result['samePhysicalDatabase'])

    def test_separate_clusters_with_same_database_name_are_distinct(self):
        result = identity.classify([self.a, {**self.a, 'systemIdentifier': '222'}], [False, False])
        self.assertFalse(result['samePhysicalDatabase'])

    def test_replicas_or_clones_are_not_the_same_physical_instance(self):
        b = {**self.a, 'serverStartedAtEpoch': '100.123457'}
        self.assertFalse(identity.classify([self.a, b], [False, False])['samePostgresInstance'])

    def test_missing_visibility_or_privilege_does_not_become_a_false_match(self):
        a = {**self.a, 'systemIdentifier': None}
        self.assertIsNone(identity.classify([a, dict(a)], [False, False])['samePhysicalDatabase'])
        self.assertIsNone(identity.classify([self.a, dict(self.a)], [True, False])['samePhysicalDatabase'])

    def test_same_database_can_use_different_application_schemas(self):
        result = identity.classify([self.a, {**self.a, 'schema': 'other'}], [True, True])
        self.assertTrue(result['samePhysicalDatabase'])
        self.assertFalse(result['sameApplicationSchema'])

if __name__ == '__main__':
    unittest.main()
