"""CPU üzerinde debug tanısının gerçek oturum sağlayıcılarını ve işçi kimliğini doğrula."""
import contextlib
import io
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import server


class DiagnosticsTest(unittest.TestCase):
    def test_worker_identity_and_actual_providers(self):
        class FakeSession:
            def __init__(self, providers): self.providers = providers
            def get_providers(self): return self.providers

        with tempfile.TemporaryDirectory() as folder:
            for filename in server.MODEL_FILES.values():
                (Path(folder) / filename).touch()
            def fake_session(path, providers, fixed=None):
                return FakeSession(['CPUExecutionProvider'])
            with patch.object(server, 'session', side_effect=fake_session), \
                 patch.object(server.Models, 'run_small'), \
                 patch.object(server.Models, 'run_da3'), \
                 patch.object(server.Models, 'run_mask'), \
                 contextlib.redirect_stdout(io.StringIO()), \
                 server.ThreadPoolExecutor(max_workers=1) as worker:
                models = worker.submit(server.Models, Path(folder), ['DmlExecutionProvider'], False).result()
                native = worker.submit(threading.get_native_id).result()
                info = models.debug_info()
            self.assertEqual(info['workerNativeThread'], native)
            self.assertNotEqual(native, threading.get_native_id())
            self.assertEqual(info['ortVersion'], server.ort.__version__)
            self.assertEqual(info['actualProviders']['da3'], ['CPUExecutionProvider'])
            self.assertEqual(set(info['actualProviders']), {'small', 'da3', 'mask'})


if __name__ == '__main__':
    unittest.main()
