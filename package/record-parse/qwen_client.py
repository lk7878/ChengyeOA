# OpenAI 兼容识图：默认 CloseAI qwen3.5-flash；无密钥则回退阿里百炼。
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

CLOSE_BASE = "https://api.openai-proxy.org/v1"
ALIYUN_BASE = "https://llm-p1xu3cnt2myixaep.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
# Vision/timeline payloads are large; 90s was too tight under proxy load.
TIMEOUT = int(os.environ.get("RECORD_PARSE_TIMEOUT", "180"))
MAX_RETRIES = int(os.environ.get("RECORD_PARSE_MAX_RETRIES", "4"))


_SECRET_ENV = (
    "CLOSEAI_API_KEY",
    "CLOSEAI_ADMIN_KEY",
    "DASHSCOPE_API_KEY",
    "RECORD_PARSE_API_KEY",
    "OPENAI_API_KEY",
)


def _parse_env_value(value: str) -> str:
    value = (value or "").strip()
    if (len(value) >= 2) and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1].strip()
    return re.split(r"\s+#", value, 1)[0].strip()


def sanitize_api_key(value: str) -> str:
    value = _parse_env_value(value)
    return "".join(ch for ch in value if ch.isascii() and not ch.isspace())


def _sanitize_secret_env():
    for name in _SECRET_ENV:
        cur = os.environ.get(name)
        if cur:
            os.environ[name] = sanitize_api_key(cur)


def _load_dotenv(path: Path):
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = _parse_env_value(value)
        if key and value and not os.environ.get(key):
            os.environ[key] = value


def _load_dsh_credentials():
    cred = Path(os.environ.get("DSH_HOME", "E:/A/.dsh")) / ".credentials.yaml"
    if not cred.is_file():
        return
    text = cred.read_text(encoding="utf-8")
    for name in ("DASHSCOPE_API_KEY", "CLOSEAI_API_KEY"):
        m = re.search(rf"^\s*{name}:\s*(\S+)\s*$", text, re.M)
        if m and not os.environ.get(name):
            os.environ[name] = sanitize_api_key(m.group(1))


def _bootstrap_env():
    _load_dotenv(Path("E:/A/.dsh/.env"))
    _load_dotenv(Path(__file__).resolve().parent / ".env")
    _load_dsh_credentials()
    _sanitize_secret_env()


def closeai_key() -> str:
    _bootstrap_env()
    return sanitize_api_key(os.environ.get("CLOSEAI_API_KEY") or "")


# CloseAI proxy drops/times out under very high parallel vision load; 32 is the hard ceiling.
API_CONCURRENCY_MAX = 32
API_CONCURRENCY_DEFAULT = 16


def apply_provider_defaults():
    """有 CloseAI 密钥则强制走规定路由；否则回退百炼。"""
    _bootstrap_env()
    if closeai_key():
        model = (os.environ.get("RECORD_PARSE_MODEL") or "qwen3.5-flash").strip()
        if not model or model == "qwen3.8-flash":
            model = "qwen3.5-flash"
        os.environ["RECORD_PARSE_MODEL"] = model
        if not (os.environ.get("RECORD_PARSE_VISION_MODEL") or "").strip():
            os.environ["RECORD_PARSE_VISION_MODEL"] = "gemini-3.1-flash-lite-image"
        base = (os.environ.get("RECORD_PARSE_BASE_URL") or CLOSE_BASE).rstrip("/")
        if "aliyuncs.com" in base or "dashscope" in base:
            base = CLOSE_BASE
        os.environ["RECORD_PARSE_BASE_URL"] = base
        os.environ["RECORD_PARSE_API_CONCURRENCY"] = str(
            cap_api_concurrency(os.environ.get("RECORD_PARSE_API_CONCURRENCY") or API_CONCURRENCY_DEFAULT)
        )
    else:
        os.environ.setdefault("RECORD_PARSE_MODEL", "qwen3.8-flash")
        os.environ.setdefault("RECORD_PARSE_BASE_URL", ALIYUN_BASE)
        os.environ["RECORD_PARSE_API_CONCURRENCY"] = str(
            cap_api_concurrency(os.environ.get("RECORD_PARSE_API_CONCURRENCY") or API_CONCURRENCY_DEFAULT)
        )


def cap_api_concurrency(value) -> int:
    try:
        n = int(value or API_CONCURRENCY_DEFAULT)
    except (TypeError, ValueError):
        n = API_CONCURRENCY_DEFAULT
    return max(1, min(n, API_CONCURRENCY_MAX))


def resolve_base_url() -> str:
    apply_provider_defaults()
    url = (os.environ.get("RECORD_PARSE_BASE_URL") or ALIYUN_BASE).rstrip("/")
    if "openai-proxy.org" in url and not closeai_key():
        return ALIYUN_BASE
    return url


def resolve_model() -> str:
    apply_provider_defaults()
    if "openai-proxy.org" in resolve_base_url() and closeai_key():
        return os.environ.get("RECORD_PARSE_MODEL") or "qwen3.5-flash"
    return os.environ.get("RECORD_PARSE_MODEL") or "qwen3.8-flash"


def resolve_vision_model() -> str:
    apply_provider_defaults()
    if "openai-proxy.org" not in resolve_base_url() or not closeai_key():
        return ""
    return (os.environ.get("RECORD_PARSE_VISION_MODEL") or "gemini-3.1-flash-lite-image").strip()


def resolve_api_key(base_url: str | None = None) -> str:
    apply_provider_defaults()
    url = (base_url or resolve_base_url()).lower()
    if "openai-proxy.org" in url:
        order = ("RECORD_PARSE_API_KEY", "CLOSEAI_API_KEY", "OPENAI_API_KEY")
    else:
        order = ("RECORD_PARSE_API_KEY", "DASHSCOPE_API_KEY", "CLOSEAI_API_KEY", "OPENAI_API_KEY")
    for name in order:
        val = sanitize_api_key(os.environ.get(name) or "")
        if val:
            return val
    return ""


DEFAULT_MODEL = "qwen3.5-flash"
DEFAULT_BASE_URL = CLOSE_BASE


class QwenClient:
    def __init__(self, *, model: str | None = None, base_url: str | None = None, api_key: str | None = None):
        self.model = model or resolve_model()
        self.base_url = (base_url or resolve_base_url()).rstrip("/")
        self.api_key = sanitize_api_key(api_key or resolve_api_key(self.base_url))
        if not self.api_key:
            raise ValueError("未找到 CLOSEAI_API_KEY / DASHSCOPE_API_KEY，无法做病历识图")
        try:
            self.api_key.encode("latin-1")
        except UnicodeEncodeError as exc:
            raise ValueError("API 密钥含非 ASCII 字符，请检查 .env 是否把行内注释写进了密钥") from exc

    def _aliyun(self) -> bool:
        return "aliyuncs.com" in self.base_url or "dashscope" in self.base_url

    def chat(self, messages: list, *, max_tokens: int = 1800, model: str | None = None) -> str:
        url = f"{self.base_url}/chat/completions"
        payload = {
            "model": model or self.model,
            "messages": messages,
            "temperature": 0,
            "stream": False,
            "max_tokens": max_tokens,
        }
        if self._aliyun():
            payload["enable_thinking"] = False
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        last = ""
        for attempt in range(MAX_RETRIES):
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                choice = (body.get("choices") or [{}])[0]
                message = choice.get("message") or {}
                return (message.get("content") or "").strip()
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="ignore")[:400]
                last = f"HTTP {exc.code} {detail}"
                if exc.code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES - 1:
                    time.sleep(min(20, 2 ** attempt))
                    continue
                raise RuntimeError(last) from exc
            except (UnicodeEncodeError, ValueError) as exc:
                raise RuntimeError(f"API 请求头无效（密钥含非法字符）：{exc}") from exc
            except Exception as exc:
                last = str(exc)
                if attempt < MAX_RETRIES - 1:
                    time.sleep(min(15, 3 * (attempt + 1)))
                    continue
                raise RuntimeError(f"连接 API 失败：{last}") from exc
        raise RuntimeError(last or "vision request failed")

    def vision(self, prompt: str, image_jpeg: bytes, *, model: str | None = None) -> str:
        import base64

        data_url = "data:image/jpeg;base64," + base64.b64encode(image_jpeg).decode("ascii")
        return self.chat(
            [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            max_tokens=2200,
            model=model,
        )

    def text(self, prompt: str, *, max_tokens: int = 1600) -> str:
        return self.chat([{"role": "user", "content": prompt}], max_tokens=max_tokens)
