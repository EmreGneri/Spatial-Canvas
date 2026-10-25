// GPU gerekmeden yerel hata mesajının kodlama hatasının arkasında kaybolmadığını doğrula.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const venv = process.platform === 'win32' ? 'sidecar/.venv/Scripts/python.exe' : 'sidecar/.venv/bin/python';
const candidates = [venv, ...(process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'])];
const python = candidates.find(p => (p !== venv || existsSync(p)) && spawnSync(p, ['-c', 'import sys'], { timeout: 5000 }).status === 0);
if (!python) {
  console.log('verify-sidecar-errors SKIP (optional Python is not installed)');
  process.exit(0);
}
const result = spawnSync(python, ['-c', `
import ast
from pathlib import Path
tree = ast.parse(Path('sidecar/server.py').read_text(encoding='utf-8'))
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'error_message')
scope = {}
exec(compile(ast.Module(body=[fn], type_ignores=[]), '<error_message>', 'exec'), scope)
message = scope['error_message']
raw = b'DirectML device kald\\xfd: E_OUTOFMEMORY'
try:
    raw.decode('utf-8')
except UnicodeDecodeError as exc:
    text = message(exc)
    assert 'E_OUTOFMEMORY' in text and 'DirectML device' in text, text
assert message(RuntimeError('device removed')) == 'RuntimeError: device removed'
class Broken(Exception):
    def __str__(self):
        raise ValueError('cannot format')
assert 'Broken' in message(Broken('original'))
assert 'RuntimeError' in message(RuntimeError())

# GPU ve ağ olmadan HTTP işleyicisinin hatayı yanıtladığını doğrula.
import io, sys, math, threading, traceback, time, json
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
class Array:
    def reshape(self, dims): return self
scope.update(globals())
scope.update(Models=object, error_message=message, MASK_SIZE=1024, DA3_SIZE=518, DAVID_SIZE=512,
             np=SimpleNamespace(prod=math.prod, float32=None, frombuffer=lambda *a, **k: Array()))
handler = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'make_handler')
exec(compile(ast.Module(body=[handler], type_ignores=[]), '<make_handler>', 'exec'), scope)
def fail(x):
    raw.decode('utf-8')
models = SimpleNamespace(available=lambda: ['small'], seq_lock=threading.Lock(), small_seq=0,
                        run_small=fail, run_da3=fail, run_mask=fail, run_moge=fail, run_david_mask=fail)
with ThreadPoolExecutor(max_workers=1) as gpu:
    Handler = scope['make_handler'](models, gpu, set())
    request = Handler.__new__(Handler)
    request.path = '/infer/depth?model=small'
    request.headers = {'X-Dims': '1,3,1,1'}
    replies = []
    request.reply = lambda status, body: replies.append((status, body))
    previous = sys.stdout, sys.stderr
    stream = io.TextIOWrapper(io.BytesIO(), encoding='cp1254')
    try:
        sys.stdout = sys.stderr = stream
        request.isle(bytes(12))
    finally:
        sys.stdout, sys.stderr = previous
    assert replies[0][0] == 500 and b'E_OUTOFMEMORY' in replies[0][1], replies
`], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.error?.message);
console.log('verify-sidecar-errors OK');
