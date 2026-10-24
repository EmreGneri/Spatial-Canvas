"""DAViD ön plan maskesi protokolü: gerçek model indirmeden server metodunu sınar."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
import server
from server import Models

S = server.DAVID_SIZE


class Session:
    def __init__(self, cikti):
        self.cikti, self.cagri = cikti, 0

    def get_inputs(self):
        return [SimpleNamespace(name='input')]

    def run(self, names, feeds):
        assert names is None and list(feeds) == ['input']
        assert feeds['input'].shape == (1, 3, S, S)
        self.cagri += 1
        return [self.cikti]


def modeller(model_dir='.', david=None):
    m = Models.__new__(Models)
    m.model_dir, m.providers, m.moge_hata, m.david = Path(model_dir), ['CPUExecutionProvider'], None, david
    return m


def sahte_maske():
    maske = np.full((1, 1, S, S), .5, np.float32)
    maske[0, 0, 0, 0], maske[0, 0, 0, 1] = 1.2, -.1  # sigmoid dışı taşma kırpılır
    return Session(maske)


class DavidMaskProtocol(unittest.TestCase):
    def test_clipped_mask_plane(self):
        out = modeller(david=sahte_maske()).run_david_mask(np.full((1, 3, S, S), .5, np.float32))
        self.assertEqual(out.shape, (1, 1, S, S))
        self.assertEqual(out.dtype, np.float32)
        np.testing.assert_allclose(out[0, 0, 0, :3], [1, 0, .5])

    def test_invalid_input_rejected(self):
        m = modeller(david=sahte_maske())
        for x in (np.zeros((1, 3, 518, 518), np.float32), np.full((1, 3, S, S), 255, np.float32),
                  np.full((1, 3, S, S), np.nan, np.float32)):
            with self.assertRaises(ValueError):
                m.run_david_mask(x)

    def test_wrong_output_shape_rejected(self):
        m = modeller(david=Session(np.zeros((1, 1, 256, 256), np.float32)))
        with self.assertRaises(ValueError):
            m.run_david_mask(np.full((1, 3, S, S), .5, np.float32))

    def test_listed_only_with_session(self):
        self.assertNotIn('david-mask', modeller().available())
        self.assertIn('david-mask', modeller(david=sahte_maske()).available())


class DavidMaskSetup(unittest.TestCase):
    def test_missing_file_not_built(self):
        with tempfile.TemporaryDirectory() as d:
            m = modeller(d)
            with mock.patch.object(server, 'session') as made:
                m.david_kur()
            made.assert_not_called()
            self.assertNotIn('david-mask', m.available())

    def test_session_failure_disables_without_crash(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / server.DAVID_MASK_FILE).write_bytes(b'not onnx')
            m = modeller(d)
            with mock.patch.object(server, 'session', side_effect=RuntimeError('bad allocation')):
                m.david_kur()
            self.assertIsNone(m.david)
            self.assertNotIn('david-mask', m.available())

    def test_only_mask_model_built_and_warmed(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / server.DAVID_MASK_FILE).write_bytes(b'x')
            oturum = sahte_maske()
            m = modeller(d)
            with mock.patch.object(server, 'session', return_value=oturum) as made:
                m.david_kur()
            self.assertEqual(made.call_count, 1, 'derinlik modeli yüklenmez (VRAM)')
            self.assertTrue(str(made.call_args[0][0]).endswith(server.DAVID_MASK_FILE))
            self.assertEqual(oturum.cagri, 1, 'ilk istek kabuk derlemesini beklemesin')
            self.assertIn('david-mask', m.available())


if __name__ == '__main__':
    unittest.main()
