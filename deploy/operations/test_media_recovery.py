import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('media_recovery', Path(__file__).with_name('recover-upload-media.py'))
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)
PHOTO = '5f44097d-7222-446f-9c05-b7cd818b3e54.jpg'
VIDEO = 'video/5f44097d-7222-446f-9c05-b7cd818b3e54.mp4'


class MediaRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / 'old'
        self.target = self.root / 'active'
        self.source.mkdir()
        self.target.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def test_only_local_upload_urls_are_eligible(self):
        self.assertEqual(media.relative_media('https://sendprocolis.com/uploads/' + PHOTO), PHOTO)
        self.assertEqual(media.relative_media('/uploads/' + VIDEO), VIDEO)
        for url in ['https://elsewhere.test/uploads/' + PHOTO, '/uploads/../.env',
                    '/uploads/photo/%2e%2e/' + PHOTO, '/uploads/photo%2f..%2f' + PHOTO,
                    '/uploads/anything.jpg', '/uploads/' + PHOTO.replace('.jpg', '.html'),
                    'file:///uploads/' + PHOTO, 'https://key@sendprocolis.com/uploads/' + PHOTO]:
            self.assertIsNone(media.relative_media(url), url)

    def test_restore_keeps_source_intact_and_is_idempotent(self):
        content = b'original media bytes'
        (self.source / PHOTO).write_bytes(content)
        result = media.recover_one(self.source, self.target, PHOTO)
        self.assertEqual(result, {'status': 'recovered', 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        self.assertEqual((self.target / PHOTO).read_bytes(), content)
        self.assertEqual((self.source / PHOTO).read_bytes(), content)
        (self.source / PHOTO).write_bytes(b'an older different copy')
        self.assertEqual(media.recover_one(self.source, self.target, PHOTO)['status'], 'existing')
        self.assertEqual((self.target / PHOTO).read_bytes(), content)
        self.assertFalse(list(self.target.glob('.recover-*')))

    def test_nested_video_and_missing_media(self):
        (self.source / 'video').mkdir()
        (self.source / VIDEO).write_bytes(b'video test')
        self.assertEqual(media.recover_one(self.source, self.target, VIDEO)['status'], 'recovered')
        self.assertEqual(media.recover_one(self.source, self.target, PHOTO)['status'], 'missing')
        self.assertFalse((self.target / PHOTO).exists())

    def test_symlinks_cannot_read_or_write_outside_uploads(self):
        outside = self.root / 'private'
        outside.write_bytes(b'sensitive test content')
        (self.source / PHOTO).symlink_to(outside)
        with self.assertRaises(OSError):
            media.recover_one(self.source, self.target, PHOTO)
        (self.source / PHOTO).unlink()
        (self.source / PHOTO).write_bytes(b'media')
        (self.target / PHOTO).symlink_to(outside)
        self.assertEqual(media.recover_one(self.source, self.target, PHOTO)['status'], 'existing_invalid')
        self.assertEqual(outside.read_bytes(), b'sensitive test content')
        (self.target / 'video').symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(OSError):
            media.recover_one(self.source, self.target, VIDEO)

    def test_empty_file_and_concurrent_upload_are_not_replaced(self):
        (self.source / PHOTO).write_bytes(b'')
        self.assertEqual(media.recover_one(self.source, self.target, PHOTO)['status'], 'source_invalid')
        (self.source / PHOTO).write_bytes(b'original')
        def uploaded_concurrently(*args, **kwargs):
            (self.target / PHOTO).write_bytes(b'new upload')
            raise FileExistsError()
        with patch.object(media.os, 'link', side_effect=uploaded_concurrently):
            self.assertEqual(media.recover_one(self.source, self.target, PHOTO)['status'], 'concurrent_existing')
        self.assertEqual((self.target / PHOTO).read_bytes(), b'new upload')
        self.assertFalse(list(self.target.glob('.recover-*')))

    def test_report_copies_only_referenced_media_without_database_writes(self):
        (self.source / PHOTO).write_bytes(b'photo')
        unreferenced = '9b64e89f-63e0-40b6-b4b8-12d25c77e568.jpg'
        (self.source / unreferenced).write_bytes(b'unreferenced')
        rows = [
            {'State': {'Running': True}, 'Mounts': [{'Destination': '/app/uploads', 'Type': 'volume', 'Name': media.VOLUME, 'Source': str(self.target)}]},
            {'State': {'Running': False}, 'Mounts': [{'Destination': '/app/uploads', 'Type': 'bind', 'Source': str(self.source)}]}
        ]
        deploy = Mock()
        deploy.docker.side_effect = [json.dumps(rows), json.dumps({'urls': [media.PUBLIC + '/uploads/' + PHOTO, media.PUBLIC + '/uploads/' + VIDEO], 'uploadDir':'uploads', 'baseUrl':media.PUBLIC})]
        response = Mock(status=200, headers={'Content-Type':'image/jpeg'})
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch.object(media, 'ACTIVE', self.target), patch.object(media, 'LEGACY', self.source), patch.object(media, 'urlopen', return_value=response), contextlib.redirect_stdout(io.StringIO()):
            media.apply(deploy, self.root)
        report = json.loads((self.root / 'media-report.json').read_text())
        self.assertEqual(report['counts'], {'recovered':1, 'missing':1})
        self.assertFalse((self.target / unreferenced).exists())
        self.assertEqual(deploy.docker.call_count, 2)
        self.assertNotIn('.update(', media.REFERENCES)
        self.assertNotIn('.delete', media.REFERENCES)

    def test_root_gate_and_trusted_helper_hash(self):
        self.assertEqual(hashlib.sha256(Path(__file__).with_name('procolis-deploy').read_bytes()).hexdigest(), media.HELPER_SHA256)
        with patch.object(media, 'load_helper') as loader, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(media.main(['arbitrary-path']), 2)
            with patch.object(media.os, 'geteuid', return_value=1001):
                self.assertEqual(media.main([]), 2)
            loader.assert_not_called()


if __name__ == '__main__':
    unittest.main()
