"""MoGe ham çıktı protokolü: gerçek model indirmeden server metodunu sınar."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
import server
from server import Models


class Session:
    def get_outputs(self):
        return [SimpleNamespace(name=name) for name in ['points', 'mask', 'metric_scale']]

    def get_inputs(self):
        return [SimpleNamespace(name=name) for name in ['image', 'num_tokens']]

    def run(self, names, feeds):
        assert names == ['points', 'mask', 'metric_scale']
        assert feeds['image'].shape == (1, 3, 518, 518)
        assert feeds['num_tokens'].shape == ()
        assert int(feeds['num_tokens']) == 1800
        assert feeds['image'].max() == .75  # MoGe normalizasyonu grafın içinde.
        points = np.zeros((1, 518, 518, 3), np.float32)
        points[..., 0], points[..., 1], points[..., 2] = 1, 2, 3
        return [points, np.full((1, 518, 518), .8, np.float32), np.array([2.5], np.float32)]


class MogeProtocol(unittest.TestCase):
    def test_named_output_planes(self):
        models = Models.__new__(Models)
        models.moge = Session()
        result = models.run_moge(np.full((1, 3, 518, 518), .75, np.float32))
        self.assertEqual(result.shape, (1, 5, 518, 518))
        np.testing.assert_allclose(result[0, :, 0, 0], [1, 2, 3, .8, 2.5])

    def test_wrong_input_shape_rejected(self):
        models = Models.__new__(Models)
        models.moge = Session()
        with self.assertRaises(ValueError):
            models.run_moge(np.zeros((1, 3, 32, 32), np.float32))

    def test_wrong_rgb_range_rejected(self):
        models = Models.__new__(Models)
        models.moge = Session()
        for value in (-1, 255, float('nan')):
            with self.assertRaises(ValueError):
                models.run_moge(np.full((1, 3, 518, 518), value, np.float32))


class MogeDegrades(unittest.TestCase):
    def test_session_failure_disables_moge_without_crash(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / server.MOGE_FILE).write_bytes(b'not onnx')
            models = Models.__new__(Models)
            models.model_dir, models.providers, models.moge, models.moge_hata = Path(d), ['CPUExecutionProvider'], None, None
            self.assertIn('moge', models.available())
            with mock.patch.object(server, 'session', side_effect=RuntimeError('bad allocation')) as made:
                for _ in range(2):
                    with self.assertRaises(RuntimeError):
                        models.run_moge(np.full((1, 3, 518, 518), .5, np.float32))
            self.assertEqual(made.call_count, 1, 'failed session is not retried per request')
            self.assertNotIn('moge', models.available())

    def test_missing_file_not_advertised(self):
        with tempfile.TemporaryDirectory() as d:
            models = Models.__new__(Models)
            models.model_dir, models.moge_hata = Path(d), None
            self.assertEqual(models.available(), list(server.MODEL_FILES))


if __name__ == '__main__':
    unittest.main()
