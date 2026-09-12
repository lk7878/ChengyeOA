"""Loopback-only PaddleOCR worker for product Wiki ingestion."""

from __future__ import annotations

import argparse
import base64
import contextlib
import io
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

MODEL: str
DEVICE: str
TOKEN: str
MAX_IMAGE_BYTES: int
PIPELINE: Any = None
PROTOCOL_STDOUT = sys.stdout


def pipeline() -> Any:
    global PIPELINE
    if PIPELINE is None:
        model_root = Path(os.environ["PADDLE_PDX_CACHE_HOME"]) / "official_models"
        model_dirs = {
            "text_detection_model_dir": "PP-OCRv5_server_det",
            "text_recognition_model_dir": "PP-OCRv5_server_rec",
        }
        missing = [name for name in model_dirs.values() if not (model_root / name).is_dir()]
        if missing:
            raise RuntimeError(f"local PaddleOCR model directories are missing: {', '.join(missing)}")
        with contextlib.redirect_stdout(sys.stderr):
            from paddleocr import PaddleOCR
            PIPELINE = PaddleOCR(
                device=DEVICE,
                text_detection_model_name="PP-OCRv5_server_det",
                text_recognition_model_name="PP-OCRv5_server_rec",
                **{key: str(model_root / value) for key, value in model_dirs.items()},
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                text_det_limit_side_len=1200,
                text_det_limit_type="max",
            )
    return PIPELINE


def plain(value: Any) -> Any:
    if callable(value):
        value = value()
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def result_dict(result: Any) -> dict[str, Any]:
    for name in ("json", "to_dict", "res"):
        if hasattr(result, name):
            value = plain(getattr(result, name))
            if isinstance(value, dict):
                return value.get("res", value)
    if isinstance(result, dict):
        return result.get("res", result)
    raise ValueError("PaddleOCR returned an unsupported result object")


def normalized_blocks(data: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = data.get("parsing_res_list")
    blocks: list[dict[str, Any]] = []
    if isinstance(candidates, list):
        for item in candidates:
            if not isinstance(item, dict):
                continue
            text = item.get("block_content") or item.get("content") or item.get("text")
            if not isinstance(text, str) or not text.strip():
                continue
            box = item.get("block_bbox") or item.get("bbox")
            score = item.get("block_score") or item.get("score")
            blocks.append({
                "text": text.strip(),
                "type": str(item.get("block_label") or item.get("label") or "text"),
                "box": box if isinstance(box, list) else None,
                "confidence": float(score) if isinstance(score, (int, float)) else None,
            })
    if blocks:
        return blocks
    ocr = data.get("overall_ocr_res")
    if not isinstance(ocr, dict):
        ocr = data
    texts = ocr.get("rec_texts", [])
    scores = ocr.get("rec_scores", [])
    boxes = ocr.get("rec_boxes", [])
    if hasattr(texts, "tolist"):
        texts = texts.tolist()
    if hasattr(scores, "tolist"):
        scores = scores.tolist()
    if hasattr(boxes, "tolist"):
        boxes = boxes.tolist()
    if isinstance(texts, list):
        for index, text in enumerate(texts):
            if not isinstance(text, str) or not text.strip():
                continue
            score = scores[index] if isinstance(scores, list) and index < len(scores) else None
            box = boxes[index] if isinstance(boxes, list) and index < len(boxes) else None
            blocks.append({
                "text": text.strip(), "type": "text",
                "box": box if isinstance(box, list) else None,
                "confidence": float(score) if isinstance(score, (int, float)) else None,
            })
    return blocks


def recognize(image_bytes: bytes) -> dict[str, Any]:
    from PIL import Image
    import numpy as np

    started = time.monotonic()
    image = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    with contextlib.redirect_stdout(sys.stderr):
        results = list(pipeline().predict(input=image))
    blocks: list[dict[str, Any]] = []
    for result in results:
        blocks.extend(normalized_blocks(result_dict(result)))
    return {
        "text": "\n\n".join(block["text"] for block in blocks),
        "blocks": blocks,
        "model": MODEL,
        "engine": "PaddleOCR",
        "elapsedMs": round((time.monotonic() - started) * 1000),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "DSHPaddleOCR/1"

    def do_POST(self) -> None:
        if self.path != "/ocr" or self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_IMAGE_BYTES * 2:
                raise ValueError("request exceeds configured limit")
            request = json.loads(self.rfile.read(length))
            image_bytes = base64.b64decode(request["imageBase64"], validate=True)
            if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
                raise ValueError("page image exceeds configured limit")
            response = recognize(image_bytes)
            payload = json.dumps(response, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as error:
            payload = json.dumps({"error": type(error).__name__, "message": str(error)[:400]}).encode("utf-8")
            self.send_response(422)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", required=True)
    parser.add_argument("--model", default="PP-OCRv5-server")
    parser.add_argument("--device", choices=("cpu", "gpu"), default="cpu")
    parser.add_argument("--max-image-bytes", type=int, default=15_000_000)
    args = parser.parse_args()
    global MODEL, DEVICE, TOKEN, MAX_IMAGE_BYTES
    MODEL, DEVICE, TOKEN, MAX_IMAGE_BYTES = args.model, args.device, args.token, args.max_image_bytes
    server = HTTPServer(("127.0.0.1", 0), Handler)
    print(json.dumps({"type": "ready", "port": server.server_port}), file=PROTOCOL_STDOUT, flush=True)
    server.serve_forever(poll_interval=0.25)


if __name__ == "__main__":
    main()
