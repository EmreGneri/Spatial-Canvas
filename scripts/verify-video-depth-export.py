"""No torch import required: reject the wrong weights before model execution."""
import importlib.util
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('vda_export', Path(__file__).with_name('export-video-depth-anything.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / 'wrong.pth'
    path.write_bytes(b'not official weights')
    try:
        module.verify_checkpoint(path)
    except ValueError as error:
        assert 'SHA256' in str(error)
    else:
        raise AssertionError('Unofficial weights must be rejected')
print('verify-video-depth-export: checkpoint boundary passed')
