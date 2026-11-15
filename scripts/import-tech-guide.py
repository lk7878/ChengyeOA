# -*- coding: utf-8 -*-
"""创建鉴定方法库、脱敏案例库并导入切分后的 Markdown。"""
from __future__ import annotations

import json
import mimetypes
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(r"E:\A")
BASE = "http://127.0.0.1:8090"
METHOD_DIR = ROOT / "konwledge-md" / "tech-guide"
CASE_DIR = ROOT / "konwledge-md" / "tech-guide-cases"
METHOD_INDEX = ROOT / "reports" / "tech-guide-method-index.json"
CASE_INDEX = ROOT / "reports" / "tech-guide-case-index.json"
OUT_IDS = ROOT / "reports" / "tech-guide-kb-ids.json"


def token() -> str:
    req = urllib.request.Request(BASE + "/api/v1/auth/auto-setup", data=b"{}", method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read().decode("utf-8"))
    t = j.get("token") or (j.get("data") or {}).get("token")
    if not t:
        raise RuntimeError("no token")
    return t


def api(method: str, path: str, tok: str, body=None, timeout=60):
    data = None
    headers = {"Authorization": "Bearer " + tok}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(BASE + "/api/v1" + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"{method} {path} HTTP {e.code}: {detail}") from e


def find_or_create_kb(tok: str, name: str, desc: str) -> str:
    lst = api("GET", "/knowledge-bases?page=1&page_size=200", tok)
    arr = lst.get("data") or []
    if isinstance(arr, dict):
        arr = arr.get("items") or arr.get("data") or []
    for kb in arr:
        if kb.get("name") == name:
            print(f"kb exists {name} {kb['id']}")
            return kb["id"]
    body = {
        "name": name,
        "description": desc,
        "type": "document",
        "embedding_model_id": "builtin-embedding-bailian",
        "chunking_config": {
            "strategy": "legacy",
            "chunk_size": 512,
            "chunk_overlap": 80,
            "enable_parent_child": False,
        },
        "indexing_strategy": {
            "vector_enabled": True,
            "keyword_enabled": True,
            "wiki_enabled": False,
            "graph_enabled": False,
        },
    }
    created = api("POST", "/knowledge-bases", tok, body)
    kid = created["data"]["id"]
    print(f"kb created {name} {kid}")
    return kid


def tag_map(tok: str, kb: str) -> dict[str, str]:
    tlist = api("GET", f"/knowledge-bases/{kb}/tags", tok)
    data = tlist.get("data") or {}
    arr = data.get("data") if isinstance(data, dict) else data
    if isinstance(arr, dict):
        arr = arr.get("items") or []
    m = {}
    for t in arr or []:
        m[t["name"]] = t["id"]
    return m


def ensure_tags(tok: str, kb: str, names: list[str]) -> dict[str, str]:
    m = tag_map(tok, kb)
    for n in names:
        if m.get(n):
            continue
        try:
            r = api("POST", f"/knowledge-bases/{kb}/tags", tok, {"name": n})
            m[n] = r["data"]["id"]
            print(f"  tag {n}")
        except RuntimeError as e:
            if "1005" in str(e) or "exist" in str(e).lower() or "已存在" in str(e):
                m = tag_map(tok, kb)
            else:
                print(f"  tag fail {n}: {e}")
    return m


def existing_files(tok: str, kb: str) -> set[str]:
    names = set()
    page = 1
    while True:
        lst = api("GET", f"/knowledge-bases/{kb}/knowledge?page={page}&page_size=200", tok)
        data = lst.get("data") or []
        if isinstance(data, dict):
            data = data.get("data") or data.get("items") or []
        if not data:
            break
        for d in data:
            names.add(d.get("file_name") or "")
            names.add(d.get("title") or "")
        if len(data) < 200:
            break
        page += 1
    return names


def multipart_upload(tok: str, kb: str, path: Path, filename: str, title: str, tags: list[str], meta: dict) -> dict:
    boundary = "----WkBoundary7f3a2c"
    parts = []

    def add_field(name: str, value: str):
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode("utf-8")
        )

    raw = path.read_bytes()
    parts.append(
        (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: text/markdown\r\n\r\n"
        ).encode("utf-8")
        + raw
        + b"\r\n"
    )
    add_field("fileName", filename)
    if tags:
        add_field("tag_ids", ",".join(tags))
    add_field("metadata", json.dumps(meta, ensure_ascii=False))
    body = b"".join(parts) + f"--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/api/v1/knowledge-bases/{kb}/knowledge/file",
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer " + tok,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"upload {filename} HTTP {e.code}: {detail}") from e


def wait_parse(tok: str, ids: list[str], seconds=300) -> dict[str, str]:
    states = {}
    deadline = time.time() + seconds
    pending = set(ids)
    while pending and time.time() < deadline:
        done = []
        for kid in list(pending):
            try:
                info = api("GET", f"/knowledge/{kid}", tok)
                st = info["data"].get("parse_status")
                states[kid] = st
                if st in ("completed", "failed"):
                    done.append(kid)
            except Exception:
                pass
        for kid in done:
            pending.discard(kid)
        if pending:
            time.sleep(3)
    return states


def apply_meta(tok: str, kb: str, kid: str, title: str, folder: str, meta: dict):
    try:
        api("PUT", f"/knowledge/{kid}", tok, {"title": title, "metadata": meta})
    except RuntimeError as e:
        print(f"  put {title}: {e}")
    if folder:
        try:
            api("POST", "/knowledge/folder", tok, {"kb_id": kb, "knowledge_ids": [kid], "folder_path": folder})
        except RuntimeError as e:
            print(f"  folder {title}: {e}")


def import_methods(tok: str, kb: str) -> list[str]:
    index = json.loads(METHOD_INDEX.read_text(encoding="utf-8"))
    tag_names = sorted({t for item in index for t in item.get("tags") or []})
    tags = ensure_tags(tok, kb, tag_names)
    have = existing_files(tok, kb)
    ids = []
    for item in index:
        fname = item["file"]
        path = METHOD_DIR / fname
        if not path.exists():
            continue
        title = item["title"] if item.get("kind") == "method" else f"{item['title']}（鉴定技术指引）"
        if fname in have or title in have:
            print(f"  skip {fname}")
            continue
        tag_ids = [tags[t] for t in item.get("tags") or [] if tags.get(t)]
        meta = {
            "来源": "《医疗损害鉴定技术指引》夏文涛等，科学出版社2020",
            "章节": item["title"],
            "文档类型": "技术指引",
            "印刷页起": str(item.get("print_start", "")),
            "印刷页止": str(item.get("print_end", "")),
        }
        r = multipart_upload(tok, kb, path, fname, title, tag_ids, meta)
        kid = r["data"]["id"]
        ids.append(kid)
        print(f"  + {fname} {kid}")
        apply_meta(tok, kb, kid, title, item.get("folder") or "其他", meta)
    return ids


def import_cases(tok: str, kb: str) -> list[str]:
    index = json.loads(CASE_INDEX.read_text(encoding="utf-8"))["cases"]
    tag_names = []
    for item in index:
        if item.get("specialty"):
            tag_names.append("专科:" + item["specialty"])
        if item.get("disease"):
            tag_names.append("疾病:" + item["disease"])
        if item.get("fault"):
            tag_names.append("过错:" + item["fault"])
        if item.get("causation") and item["causation"] != "未标明":
            tag_names.append("原因力:" + item["causation"])
        tag_names.append("文档:书内案例")
    tags = ensure_tags(tok, kb, sorted(set(tag_names)))
    have = existing_files(tok, kb)
    ids = []
    for item in index:
        if item.get("chars", 0) < 300:
            continue
        fname = item["file"]
        path = CASE_DIR / fname
        if not path.exists():
            continue
        title = f"{item['id']} {item['title']}"
        if fname in have or title in have:
            print(f"  skip {fname}")
            continue
        wanted = ["文档:书内案例"]
        if item.get("specialty"):
            wanted.append("专科:" + item["specialty"])
        if item.get("disease"):
            wanted.append("疾病:" + item["disease"])
        if item.get("fault"):
            wanted.append("过错:" + item["fault"])
        if item.get("causation") and item["causation"] != "未标明":
            wanted.append("原因力:" + item["causation"])
        tag_ids = [tags[t] for t in wanted if tags.get(t)]
        meta = {
            "案例编号": item["id"],
            "来源": "《医疗损害鉴定技术指引》夏文涛等，科学出版社2020",
            "疾病": item.get("disease") or "",
            "专科": item.get("specialty") or "",
            "过错类型": item.get("fault") or "",
            "原因力": item.get("causation") or "",
            "印刷页起": str(item.get("print_start", "")),
            "印刷页止": str(item.get("print_end", "")),
            "文档类型": "书内案例（参考，非判例）",
        }
        folder = item.get("specialty") or item.get("fault") or "其他"
        r = multipart_upload(tok, kb, path, fname, title, tag_ids, meta)
        kid = r["data"]["id"]
        ids.append(kid)
        print(f"  + {fname} {kid}")
        apply_meta(tok, kb, kid, title, folder, meta)
    return ids


def main():
    tok = token()
    method_kb = find_or_create_kb(
        tok,
        "鉴定方法库",
        "《医疗损害鉴定技术指引》（2020）方法章：过错认定、21种疾病模板、意见书与因果、尸检。效力低于国家标准。",
    )
    case_kb = find_or_create_kb(
        tok,
        "脱敏案例库",
        "《医疗损害鉴定技术指引》书内教学案例，供类案参考，不是判例，不得直接套用原因力。",
    )
    print("== methods ==")
    mids = import_methods(tok, method_kb)
    print("== cases ==")
    cids = import_cases(tok, case_kb)
    print("== wait parse ==")
    st = wait_parse(tok, mids + cids, 420)
    failed = [k for k, v in st.items() if v == "failed"]
    done = [k for k, v in st.items() if v == "completed"]
    print(f"completed={len(done)} failed={len(failed)} pending={len(mids)+len(cids)-len(st)}")
    payload = {
        "methodKbId": method_kb,
        "caseKbId": case_kb,
        "uploaded_methods": len(mids),
        "uploaded_cases": len(cids),
        "completed": len(done),
        "failed": len(failed),
    }
    OUT_IDS.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
