"""One bounded OCR request over stdio; reuse upstream extraction without HTTP."""
import base64
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[3]
worker_path = root / 'third_party/deepseek-harness/packages/product/product-knowledge/worker/paddleocr_worker.py'
spec = importlib.util.spec_from_file_location('chengye_paddle', worker_path)
worker = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(sys.stderr):
    spec.loader.exec_module(worker)
worker.MODEL = 'PP-OCRv5-server'
worker.DEVICE = os.environ.get('CHENGYE_OCR_DEVICE', 'cpu')
try:
    raw = sys.stdin.buffer.read(20_000_001)
    if len(raw) > 20_000_000:
        raise ValueError('OCR input too large')
    request = json.loads(raw)
    image = base64.b64decode(request['imageBase64'], validate=True)
    if not 0 < len(image) <= 15_000_000:
        raise ValueError('OCR image size invalid')
    with contextlib.redirect_stdout(sys.stderr):
        result = worker.recognize(image)
    print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False))
except Exception as error:
    # Do not expose source images, model paths, or library diagnostics in HTTP.
    print(json.dumps({'ok': False, 'code': type(error).__name__}))
    sys.exit(1)
