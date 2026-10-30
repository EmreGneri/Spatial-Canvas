"""SIDECAR_MASK_THREADS: unset keeps ORT's default thread pool; set, only the BiRefNet session gets it."""
import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import server


class MaskThreadsTest(unittest.TestCase):
    def options_for(self, **kw):
        with patch.object(server.ort, 'InferenceSession') as made:
            server.session(Path('x.onnx'), ['CPUExecutionProvider'], **kw)
        return made.call_args.args[1]

    def test_session_default_unchanged_and_override_applied(self):
        self.assertEqual(self.options_for().intra_op_num_threads, 0)  # 0 = ORT chooses (old behaviour)
        self.assertEqual(self.options_for(threads=4).intra_op_num_threads, 4)

    def test_env(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('SIDECAR_MASK_THREADS', None)
            self.assertEqual(server.mask_threads(), 0)
            os.environ['SIDECAR_MASK_THREADS'] = '4'
            self.assertEqual(server.mask_threads(), 4)
            os.environ['SIDECAR_MASK_THREADS'] = '-1'
            with self.assertRaises(SystemExit):
                server.mask_threads()

    def test_only_mask_session_gets_threads(self):
        calls = {}
        def fake_session(path, providers, fixed=None, threads=0):
            calls[path.name] = threads
        with tempfile.TemporaryDirectory() as folder:
            for filename in server.MODEL_FILES.values():
                (Path(folder) / filename).touch()
            for env, want in (({}, 0), ({'SIDECAR_MASK_THREADS': '3'}, 3)):
                calls.clear()
                with patch.dict(os.environ, env), patch.object(server, 'session', side_effect=fake_session), \
                     patch.object(server.Models, 'run_small'), patch.object(server.Models, 'run_da3'), \
                     patch.object(server.Models, 'run_mask'), contextlib.redirect_stdout(io.StringIO()):
                    if not env:
                        os.environ.pop('SIDECAR_MASK_THREADS', None)
                    server.Models(Path(folder), ['CPUExecutionProvider'], False)
                self.assertEqual(calls[server.MODEL_FILES['mask']], want)
                self.assertEqual(calls[server.MODEL_FILES['small']], 0)
                self.assertEqual(calls[server.MODEL_FILES['da3']], 0)


if __name__ == '__main__':
    unittest.main()
