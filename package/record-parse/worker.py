# 扫描件病历批量解析：CloseAI qwen3.5-flash 识图，复杂页升 gemini-3.1-flash-lite-image。
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import traceback
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
from classify import DOC_CATEGORIES, specific_type, try_confident_category
from concurrency import ConcurrencyCalculator, effective_workers
from qwen_client import QwenClient, resolve_vision_model, cap_api_concurrency

CLASSIFY_BATCH_PAGES = 20
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
PDF_EXTS = {".pdf"}
TEXT_EXTS = {".txt", ".md"}
DATE_RE = re.compile(
    r"(20\d{2}年\d{1,2}月\d{1,2}日|20\d{2}-\d{1,2}-\d{1,2}|20\d{2}/\d{1,2}/\d{1,2})"
)
HOSPITAL_RE = re.compile(r"([\u4e00-\u9fa5]{2,24}(?:大学)?(?:附属)?[\u4e00-\u9fa5]{0,12}(?:医院|卫生院|保健院))")
NAME_RE = re.compile(r"(?:患者姓名|姓\s*名)[:：]\s*([\u4e00-\u9fa5]{2,4})")
GENDER_RE = re.compile(r"(?:性\s*别)[:：]\s*([男女])")
AGE_RE = re.compile(r"(?:年\s*龄)[:：]\s*(\d{1,3})\s*岁?")
TIMELINE_PAGE_CHARS = 2800
TIMELINE_BATCH_CHARS = 10000
TIMELINE_EVENTS = (
    "入院", "出院", "死亡", "手术", "拟行手术", "抢救", "签署知情",
    "检验", "影像", "病程转述检查", "转科", "就诊", "医嘱", "护理", "诊断", "记录",
)


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path, default=None):
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def list_materials(root: Path):
    files = []
    if not root.is_dir():
        return files
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() in PDF_EXTS | IMAGE_EXTS | TEXT_EXTS:
            files.append(p)
    return files


def page_text_path(pages_dir: Path, stem: str, page: int) -> Path:
    raw = str(stem or "").replace("\\", "/")
    raw = Path(raw).stem
    legacy = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", raw).strip(" .")
    legacy_path = pages_dir / f"{legacy}__p{page:04d}.txt"
    if legacy_path.is_file():
        return legacy_path
    safe = re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", raw).strip("_")[:48] or "page"
    return pages_dir / f"{safe}__p{page:04d}.txt"


def write_page_text(pages_dir: Path, rel: str, page: int, text: str) -> Path:
    pages_dir.mkdir(parents=True, exist_ok=True)
    cache = page_text_path(pages_dir, rel, page)
    try:
        cache.write_text(text or "", encoding="utf-8")
        return cache
    except OSError:
        pages_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha1(f"{rel}:{page}".encode("utf-8")).hexdigest()[:16]
        cache = pages_dir / f"{digest}_p{page:04d}.txt"
        cache.write_text(text or "", encoding="utf-8")
        return cache


def vision_prompt(filename_hint: str = "") -> str:
    prompt = """
# Role
你是医疗病历 OCR 专家。请把图片转为结构化纯文本，并尽量精炼输出。
# Rules
1. 第一行必须是 `[TYPE:具体文书名称]`，主要参考页眉处类型，如果页眉处没有类型，再根据内容判断类型。
2. 仅保留诊疗关键信息+时间：主诉、现病史、检查检验、诊断、治疗/手术、医嘱、护理、出院/死亡等。
3. 过滤无关噪音：页眉页脚、重复编号、装饰符、无意义印刷干扰。
4. 保留并优先识别：患者姓名、年龄、性别、医院名称。
5. 不必保留：身份证号、联系电话、家庭住址。
6. 手写签名统一写成 `[手写签名-姓名]`，无法识别则 `[手写签名]`。
7. 表格转为紧凑文本（键值对或列表），不要冗长解释。
8. 只输出结果文本，不要任何额外说明。
9. 知情同意书尽可能总结告知内容，不要缺失任何告知内容。
10. 如果无法识别，则输出 `[TYPE:无法识别]`，不要假设或编造任何内容。
11. 「辅助检查」若同一段连写多次检查（日期+CT/MRI/超声紧挨出现），优先按原文顺序逐句转写，不要为了精炼把后一次检查的结论接到前一次检查名下。切条目时：一条只能是「一个日期 + 一种检查 + 仅属于该次检查的所见」。
12. 不得把 MRI 所见（如骨髓水肿、椎体压缩）写进更早一次 CT 条目；下一日期一出现，必须另起一条。
13. 「骨髓水肿」与「脊髓水肿」不得互换。椎体压缩骨折旁常见「骨髓水肿」；原文写哪一个就录哪一个，看不清则照字形，不要医学推断。
14. 病程/入院对检查的转述必须忠实原文，不要用其他页的影像结论补全本页。
""".strip()
    if filename_hint:
        prompt += (
            f"\n# 参考信息\nPDF 文件名「{filename_hint}」含医院名与诊疗时间，请据此校准 OCR 中的医院名称与日期。"
        )
    return prompt


def render_jpeg(path: Path, page_index: int = 0, zoom: float = 2.0) -> bytes:
    doc = fitz.open(str(path))
    try:
        page = doc.load_page(page_index)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("jpeg")
    finally:
        doc.close()


def ocr_poor(text: str) -> bool:
    raw = (text or "").strip()
    if not raw or "[TYPE:无法识别]" in raw:
        return True
    cjk = len(re.findall(r"[\u4e00-\u9fff]", raw))
    if cjk < 40 and len(raw) < 80:
        return True
    if not extract_type_label(raw) and cjk < 80:
        return True
    return False


def extract_type_label(text: str) -> str:
    m = re.search(r"\[TYPE:\s*([^\]]+?)\]", text or "", re.I)
    if not m:
        return ""
    label = m.group(1).strip()
    if label in ("", "无法识别", "其他"):
        return ""
    return label


def extract_json_payload(raw_text: str) -> str:
    text = (raw_text or "").strip()
    text = re.sub(r"^\s*```json\s*", "", text, flags=re.I)
    text = re.sub(r"^\s*```\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text).strip()
    start_obj = text.find("{")
    start_arr = text.find("[")
    starts = [i for i in (start_obj, start_arr) if i >= 0]
    if not starts:
        return text
    start = min(starts)
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return text[start:]


def classify_uncertain_batch(pages: list, client: QwenClient) -> dict:
    items = [{"page": p["page"], "ocr_type": p.get("ocr_type") or "", "snippet": (p.get("text") or "")[:300]} for p in pages]
    categories = "、".join(DOC_CATEGORIES)
    prompt = f"""你是病案文书分类专家。请根据每页页眉/开头判断文书大类。
必须从以下枚举中选一个作为 major_type：
{categories}
注：处方笺归 `医嘱记录`；CT/MRI/X线/超声/心电图等检查或诊断报告归 `影像报告`；评估报告单归 `护理记录`；
产前超声/NT 归 `影像报告`；NIPT 等化验归 `检验报告`；普通产科门诊归 `门诊记录`。

【输入】
{json.dumps(items, ensure_ascii=False)}

【输出】只输出纯 JSON 数组，无 Markdown：
[{{"page": 1, "major_type": "影像报告"}}]"""
    raw = client.text(prompt)
    payload = extract_json_payload(raw)
    parsed = json.loads(payload) if payload else []
    if isinstance(parsed, dict):
        parsed = parsed.get("pages") or parsed.get("results") or []
    mapping = {}
    for item in parsed or []:
        if not isinstance(item, dict):
            continue
        try:
            page_num = int(item.get("page"))
        except (TypeError, ValueError):
            continue
        major = (item.get("major_type") or "").strip()
        if major in DOC_CATEGORIES:
            mapping[page_num] = major
    return mapping


def classify_pages(pages: list, client: QwenClient, job_update, api_limit: int = 40):
    uncertain = []
    for page in pages:
        if "[TYPE:无法识别]" in (page.get("text") or ""):
            page["category"] = "其他"
            page["classified_by"] = "unreadable"
            continue
        cat = try_confident_category(page.get("text") or "", page.get("ocr_type") or "")
        if cat:
            page["category"] = cat
            page["classified_by"] = "rule"
        else:
            uncertain.append(page)
    if not uncertain:
        return pages
    chunks = [uncertain[i:i + CLASSIFY_BATCH_PAGES] for i in range(0, len(uncertain), CLASSIFY_BATCH_PAGES)]
    conc = max(1, min(len(chunks), cap_api_concurrency(api_limit)))
    job_update(f"规则未定 {len(uncertain)} 页，正在分 {len(chunks)} 批自动归类", stage="分类")
    sem = threading.Semaphore(conc)

    def run_chunk(chunk):
        with sem:
            try:
                return classify_uncertain_batch(chunk, client)
            except Exception:
                return {}

    with ThreadPoolExecutor(max_workers=conc) as pool:
        maps = list(pool.map(run_chunk, chunks))
    mapping = {}
    for part in maps:
        mapping.update(part)
    for page in uncertain:
        major = mapping.get(page["page"], "其他")
        page["category"] = major if major in DOC_CATEGORIES else "其他"
        page["classified_by"] = "llm" if page["page"] in mapping else "fallback"
    return pages


RETELL_CATS = {"病程记录", "入院记录", "出院记录", "门诊记录", "会诊记录", "知情同意"}


def timeline_source(page: dict) -> str:
    label = page.get("specific") or page.get("category") or "文书"
    return f"{label} (第{page.get('page')}页)"


def canonical_event_time(value: str) -> str:
    """只规范化模型给出的 time 字段，不从病历正文抽日期。"""
    raw = (value or "").strip().replace("T", " ")
    m = re.fullmatch(r"(20\d{2})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?", raw)
    if m:
        day = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        return f"{day} {m.group(4)}:{m.group(5)}" if m.group(4) else day
    m = re.search(r"(20\d{2})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2})\D+(\d{1,2}))?", raw)
    if not m:
        return ""
    day = f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    if m.group(4) and m.group(5):
        hh, mm = int(m.group(4)), int(m.group(5))
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            return f"{day} {hh:02d}:{mm:02d}"
    return day


def iter_timeline_batches(pages: list):
    batch = []
    size = 0
    for page in pages:
        text = (page.get("text") or "").strip()
        if not text or "[TYPE:无法识别]" in text:
            continue
        piece = text[:TIMELINE_PAGE_CHARS]
        if batch and size + len(piece) > TIMELINE_BATCH_CHARS:
            yield batch
            batch = []
            size = 0
        batch.append((page, piece))
        size += len(piece)
    if batch:
        yield batch


def parse_timeline_batch(raw: str, chunk: list) -> list:
    payload = extract_json_payload(raw)
    parsed = json.loads(payload) if payload else []
    if isinstance(parsed, dict):
        parsed = parsed.get("events") or parsed.get("timeline") or parsed.get("items") or []
    if not isinstance(parsed, list):
        return []
    by_id = {i: page for i, (page, _text) in enumerate(chunk, 1)}
    events = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        try:
            idx = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        page = by_id.get(idx)
        if page is None:
            continue
        when = canonical_event_time(str(item.get("time") or ""))
        if not when:
            continue
        event = (item.get("event") or "").strip()
        if event not in TIMELINE_EVENTS:
            event = "记录"
        detail = re.sub(r"\s+", " ", str(item.get("detail") or "")).strip()
        if not detail:
            continue
        events.append({
            "time": when,
            "event": event,
            "detail": detail[:180],
            "source": timeline_source(page),
        })
    return events


def extract_timeline_batch(chunk, client: QwenClient) -> list:
    items = []
    for i, (page, text) in enumerate(chunk, 1):
        items.append({
            "id": i,
            "category": page.get("category") or "",
            "specific": page.get("specific") or "",
            "hospital": page.get("hospital") or "",
            "text": text,
        })
    names = "、".join(TIMELINE_EVENTS)
    prompt = f"""你是病案时间轴抽取员。只根据下面各页正文，抽出该页实际记载的诊疗事实。
事件名必须是：{names}

规则：
1. time 写成 YYYY-MM-DD 或 YYYY-MM-DD HH:MM。正文没有到分钟就不要编造时分。没有可靠日期的事实不要输出。
2. 只写本页原文能支撑的事实。不要用医学推断补全，不要把其他页的结论写进来。
3. 拟行、拟在、计划行、拟于的手术，event 必须是「拟行手术」，不得写成「手术」。
4. 影像报告、检验报告页记该次检查本身，event 用「影像」或「检验」。病程、入院、出院、门诊、会诊、知情同意里转述的既有检查，event 用「病程转述检查」，不要当成当天新做的检查。
5. 忽略司法鉴定许可、法律施行日期、证件有效期、页眉页脚印刷信息。
6. 同一页、同一时间、同一事件合并成一条。医嘱页合并同时段的同类治疗，不要逐条罗列常规护理。检验页只保留关键异常或结论，不要逐项抄参考范围。病程里重复粘贴的辅助检查清单，只保留与本页诊疗决策相关的转述。
7. detail 用一句话，不超过 80 字，必须能在该页原文中找到依据。
8. 只输出 JSON 数组，不要 Markdown：
[{{"id": 1, "time": "2025-11-06 09:12", "event": "入院", "detail": "因交通事故伤急诊入院"}}]

【页面】
{json.dumps(items, ensure_ascii=False)}"""
    raw = client.text(prompt, max_tokens=4096)
    try:
        return parse_timeline_batch(raw, chunk)
    except json.JSONDecodeError:
        raw = client.text(
            prompt + "\n\n上次输出不是合法 JSON。请只重新输出 JSON 数组。",
            max_tokens=4096,
        )
        return parse_timeline_batch(raw, chunk)


def build_timeline_llm(pages, client: QwenClient, job_update, api_limit: int = 40):
    batches = list(iter_timeline_batches(pages))
    if not batches:
        return [], []
    conc = max(1, min(len(batches), cap_api_concurrency(api_limit)))
    job_update(f"正在用模型抽取诊疗时间轴，共 {len(batches)} 批", stage="时间轴")
    sem = threading.Semaphore(conc)
    notes = []
    ordered = [None] * len(batches)

    def run(i, chunk):
        with sem:
            try:
                return i, extract_timeline_batch(chunk, client), ""
            except Exception as exc:
                labels = "、".join(timeline_source(page) for page, _text in chunk[:6])
                return i, [], f"时间轴抽取失败（{labels}）：{str(exc)[:160]}"

    with ThreadPoolExecutor(max_workers=conc) as pool:
        futures = [pool.submit(run, i, chunk) for i, chunk in enumerate(batches)]
        done_n = 0
        for fut in as_completed(futures):
            i, evs, note = fut.result()
            ordered[i] = evs
            if note:
                notes.append(note)
            done_n += 1
            if done_n % 5 == 0 or done_n == len(batches):
                job_update(f"时间轴抽取 {done_n}/{len(batches)} 批", stage="时间轴")

    if notes and len(notes) == len(batches):
        raise RuntimeError(notes[0])

    events = []
    seen = set()
    seq = 0
    for evs in ordered:
        for ev in evs or []:
            seq += 1
            key = (ev["time"], ev["event"], ev["source"], ev["detail"])
            if key in seen:
                continue
            seen.add(key)
            ev = dict(ev)
            ev["_seq"] = seq
            events.append(ev)
    events.sort(key=lambda e: (e["time"], e["_seq"]))
    for ev in events:
        ev.pop("_seq", None)
    return events, notes


def normalize_exam_date(value: str) -> str:
    m = re.search(r"(20\d{2})\D+(\d{1,2})\D+(\d{1,2})", value or "")
    if not m:
        return ""
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


def normalize_modality(value: str) -> str:
    raw = value or ""
    up = raw.upper()
    if "MRI" in up or up.startswith("MR") or "磁共振" in raw:
        return "MRI"
    if "CT" in up or "体层" in raw:
        return "CT"
    if "超声" in raw or "彩超" in raw:
        return "超声"
    if "DR" in up or "X线" in raw or "X光" in raw:
        return "X线"
    return up[:8]


AUX_ITEM_RE = re.compile(
    r"(20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}日?)\s*[^\n]{0,48}?(CT|MRI|MR平扫|MR|超声|彩超|X线|DR)",
    re.I,
)
MRI_SIGN_RE = re.compile(r"骨髓水肿|脊髓水肿|STIR|T2抑脂|T1WI")
THORACIC_FX_RE = re.compile(r"椎体压缩性骨折|(?:胸|T)\s*\d.{0,24}压缩")


def iter_aux_items(text: str):
    matches = list(AUX_ITEM_RE.finditer(text or ""))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else min(len(text), m.end() + 180)
        yield {
            "date": normalize_exam_date(m.group(1)),
            "modality": normalize_modality(m.group(2)),
            "body": (text[m.end():end] or ""),
        }


def collect_imaging_truth(pages: list) -> dict:
    truth = {}
    for p in pages:
        if p.get("category") != "影像报告":
            continue
        text = p.get("text") or ""
        for item in iter_aux_items(text):
            if not item["date"] or not item["modality"]:
                continue
            key = (item["date"], item["modality"])
            blob = f"{text[:800]} {item['body']}"
            truth.setdefault(key, "")
            if len(truth[key]) < 1200:
                truth[key] = (truth[key] + " " + blob).strip()
        # 报告单常把检查日期写在页眉，全文再写结论
        dates = {normalize_exam_date(m.group(0)) for m in DATE_RE.finditer(text)}
        dates.discard("")
        modality = "MRI" if re.search(r"MRI|MR平扫|磁共振", text, re.I) else (
            "CT" if re.search(r"\bCT\b|体层成像", text) else ""
        )
        if modality:
            for d in dates:
                truth.setdefault((d, modality), text[:1200])
    return truth


def flag_aux_exam_warnings(pages: list) -> list[str]:
    truth = collect_imaging_truth(pages)
    warnings = []
    seen = set()
    for p in pages:
        if p.get("category") not in RETELL_CATS:
            continue
        text = p.get("text") or ""
        items = list(iter_aux_items(text))
        for i, item in enumerate(items):
            head = re.split(r"[。\n]|请结合临床|建议住院", item["body"].lstrip("：:，, "), 1)[0][:90]
            looks_mri = bool(MRI_SIGN_RE.search(head) or (THORACIC_FX_RE.search(head) and "水肿" in head))
            if item["modality"] != "CT" or not looks_mri:
                continue
            report = truth.get((item["date"], "CT"), "")
            report_has_mri_sign = bool(MRI_SIGN_RE.search(report) or THORACIC_FX_RE.search(report))
            later_mri = any(
                later["modality"] == "MRI" and later["date"] > item["date"]
                for later in items[i + 1:]
                if later.get("date")
            )
            if report and report_has_mri_sign and not later_mri:
                continue
            if report and not report_has_mri_sign:
                reason = "该日影像报告未见上述所见"
            elif later_mri:
                reason = "同页后续 MRI 条目已有同类所见，高度疑似条目化串台"
            elif not report:
                reason = "未见对应日期 CT 报告印证"
            else:
                continue
            loc = f"{p.get('specific') or p.get('category')}第{p.get('page')}页"
            snippet = re.sub(r"\s+", " ", f"{item['date']} CT {head}")[:80]
            key = (loc, item["date"], snippet)
            if key in seen:
                continue
            seen.add(key)
            warnings.append(
                f"{loc}将「{snippet}」挂在 {item['date']} CT 下，{reason}。"
                "认定病程张冠李戴前须对照影像报告原文，不得只信条目化列表。"
            )
    return warnings


def extract_meta_bits(text: str):
    hospitals = HOSPITAL_RE.findall(text or "")
    name = NAME_RE.search(text or "")
    gender = GENDER_RE.search(text or "")
    age = AGE_RE.search(text or "")
    return {
        "name": name.group(1) if name else "",
        "gender": gender.group(1) if gender else "",
        "age": age.group(1) if age else "",
        "hospitals": hospitals[:8],
    }


def merge_ranges(pages):
    rows = []
    for p in pages:
        key = (p["file"], p["category"], p.get("specific") or p["category"])
        if rows and (rows[-1]["file"], rows[-1]["category"], rows[-1]["specific"]) == key and rows[-1]["page_end"] + 1 == p["page"]:
            rows[-1]["page_end"] = p["page"]
            rows[-1]["pages"] += 1
            continue
        rows.append({
            "file": p["file"],
            "category": p["category"],
            "specific": p.get("specific") or p["category"],
            "page_start": p["page"],
            "page_end": p["page"],
            "pages": 1,
            "hospital": p.get("hospital") or "",
        })
    return rows


def write_artifacts(out_dir: Path, pages: list, events: list | None = None, timeline_notes: list | None = None):
    catalog_rows = merge_ranges(pages)
    catalog_lines = [
        "# 病历文书目录",
        "",
        "| 大类 | 具体文书 | 文件 | 页码 | 医院 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for r in catalog_rows:
        pages_s = f"第{r['page_start']}页" if r["page_start"] == r["page_end"] else f"第{r['page_start']}–{r['page_end']}页"
        catalog_lines.append(
            f"| {r['category']} | {r['specific']} | {r['file']} | {pages_s} | {r['hospital'] or ''} |"
        )
    (out_dir / "catalog.md").write_text("\n".join(catalog_lines) + "\n", encoding="utf-8")

    events = list(events or [])
    meta = {"name": "", "gender": "", "age": "", "hospitals": []}
    for p in pages:
        bits = extract_meta_bits(p.get("text") or "")
        if bits["name"] and not meta["name"]:
            meta["name"] = bits["name"]
        if bits["gender"] and not meta["gender"]:
            meta["gender"] = bits["gender"]
        if bits["age"] and not meta["age"]:
            meta["age"] = bits["age"]
        for h in bits["hospitals"]:
            if h not in meta["hospitals"] and len(h) <= 24:
                meta["hospitals"].append(h)

    tl = ["# 诊疗时间轴", "", "| 时间 | 事件 | 详情 | 来源 |", "| --- | --- | --- | --- |"]
    for ev in events:
        detail = ev["detail"].replace("|", "\\|")
        tl.append(f"| {ev['time']} | {ev['event']} | {detail} | {ev['source']} |")
    (out_dir / "timeline.md").write_text("\n".join(tl) + "\n", encoding="utf-8")

    hospitals = "、".join(meta["hospitals"][:12]) or "（待补充）"
    warnings = flag_aux_exam_warnings(pages)
    meta_md = [
        "# 病历元信息",
        "",
        f"- 患者姓名：{meta['name'] or '（待补充）'}",
        f"- 性别：{meta['gender'] or '（待补充）'}",
        f"- 年龄：{meta['age'] or '（待补充）'}",
        f"- 就诊医院：{hospitals}",
        "",
    ]
    if timeline_notes:
        meta_md += ["## 时间轴抽取", ""]
        for note in timeline_notes:
            meta_md.append(f"- {note}")
        meta_md.append("")
    if warnings:
        meta_md += ["## 解析核验警告", ""]
        for i, w in enumerate(warnings, 1):
            meta_md.append(f"{i}. {w}")
        meta_md.append("")
        meta_md.append("上述警告表示解析条目可能把后一次检查结论接到前一次检查名下。审查时必须 parse_records_query 影像报告原文；不得据此直接写成病历书写过错。")
        meta_md.append("")
        warn_md = ["# 解析核验警告", "", "病程/入院将 MRI 典型所见挂到更早 CT 名下时列出。优先怀疑 OCR 串台。", ""]
        for i, w in enumerate(warnings, 1):
            warn_md.append(f"{i}. {w}")
        warn_md.append("")
        (out_dir / "parse-warnings.md").write_text("\n".join(warn_md), encoding="utf-8")
    (out_dir / "meta.md").write_text("\n".join(meta_md), encoding="utf-8")

    by_dir = out_dir / "by-category"
    by_dir.mkdir(parents=True, exist_ok=True)
    grouped = {}
    for p in pages:
        grouped.setdefault(p["category"], []).append(p)
    for cat, items in grouped.items():
        blocks = [f"# {cat}", ""]
        for p in items:
            blocks.append(f"## {p['file']} 第{p['page']}页 · {p.get('specific') or cat}")
            blocks.append("")
            blocks.append((p.get("text") or "（本页无文字）").strip())
            blocks.append("")
        (by_dir / f"{cat}.md").write_text("\n".join(blocks), encoding="utf-8")

    index = {
        "generated_at": now_iso(),
        "page_count": len(pages),
        "categories": {cat: len(items) for cat, items in grouped.items()},
        "pages": [
            {
                "file": p["file"],
                "page": p["page"],
                "category": p["category"],
                "specific": p.get("specific") or p["category"],
                "engine": p.get("engine") or "",
                "chars": len(p.get("text") or ""),
                "text_path": p.get("text_path") or "",
                "hospital": p.get("hospital") or "",
            }
            for p in pages
        ],
    }
    write_json(out_dir / "parse-index.json", index)
    return catalog_rows, events, meta


def process(materials: Path, out_dir: Path, force: bool, max_pages: int | None):
    pages_dir = out_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    job_path = out_dir / "parse-job.json"
    files = list_materials(materials)
    plan = []
    for fp in files:
        ext = fp.suffix.lower()
        rel = str(fp.relative_to(materials)).replace("\\", "/")
        if ext in PDF_EXTS:
            doc = fitz.open(str(fp))
            n = doc.page_count
            doc.close()
            for i in range(n):
                plan.append((fp, rel, i + 1, "pdf"))
        elif ext in IMAGE_EXTS:
            plan.append((fp, rel, 1, "image"))
        else:
            plan.append((fp, rel, 1, "text"))
    if max_pages:
        plan = plan[: max_pages]

    page_count = len(plan)
    api_limit, pool_size = ConcurrencyCalculator.calculate(page_count)
    cap = cap_api_concurrency(os.environ.get("RECORD_PARSE_API_CONCURRENCY") or 40)
    api_limit = max(1, min(api_limit, cap))
    workers = effective_workers(pool_size, api_limit)
    client = QwenClient()
    vision_model = resolve_vision_model()
    job = {
        "status": "running",
        "pid": os.getpid(),
        "started_at": now_iso(),
        "updated_at": now_iso(),
        "materials": str(materials),
        "out_dir": str(out_dir),
        "model": client.model,
        "vision_model": vision_model,
        "stage": "识别",
        "total_pages": page_count,
        "done_pages": 0,
        "ocr_pages": 0,
        "cache_pages": 0,
        "escalate_pages": 0,
        "api_limit": api_limit,
        "pool_size": pool_size,
        "workers": workers,
        "message": f"{client.model} 并发解析：{page_count}页 → API并发 {api_limit}，线程 {workers}"
        + (f"；复杂页升 {vision_model}" if vision_model else ""),
        "error": "",
    }
    write_json(job_path, job)
    print(job["message"], flush=True)

    lock = threading.Lock()
    done = {"n": 0, "ocr": 0, "cache": 0, "escalate": 0}
    pages_map = {}

    def bump(msg=None, stage=None):
        with lock:
            if stage:
                job["stage"] = stage
            job.update({
                "updated_at": now_iso(),
                "done_pages": done["n"],
                "ocr_pages": done["ocr"],
                "cache_pages": done["cache"],
                "escalate_pages": done["escalate"],
                "message": msg or f"识别进度 {done['n']}/{page_count}（识图 {done['ocr']}，升级 {done['escalate']}，缓存 {done['cache']}）",
            })
            write_json(job_path, job)
            if done["n"] % 5 == 0 or done["n"] == page_count or msg:
                print(job["message"], flush=True)

    def parse_one(item):
        fp, rel, page_no, kind = item
        cache = page_text_path(pages_dir, rel, page_no)
        text = ""
        engine_name = "cache"
        ocr_type = ""
        if cache.is_file() and not force:
            text = cache.read_text(encoding="utf-8")
        elif kind == "text":
            text = fp.read_text(encoding="utf-8", errors="ignore")
            engine_name = "text"
            cache = write_page_text(pages_dir, rel, page_no, text)
        else:
            jpeg = render_jpeg(fp, 0 if kind == "image" else page_no - 1)
            prompt = vision_prompt(Path(rel).stem)
            try:
                text = client.vision(prompt, jpeg)
                engine_name = client.model
                if vision_model and vision_model != client.model and ocr_poor(text):
                    upgraded = client.vision(prompt, jpeg, model=vision_model)
                    if (not ocr_poor(upgraded)) or len(upgraded or "") > len(text or ""):
                        text = upgraded
                        engine_name = vision_model
                        with lock:
                            done["escalate"] += 1
            except Exception as exc:
                err = str(exc)
                if any(tok in err for tok in ("请求头无效", "latin-1", "未找到 CLOSEAI", "API 密钥")):
                    raise
                text = f"[TYPE:无法识别]\n{err[:200]}"
                engine_name = "error"
            try:
                cache = write_page_text(pages_dir, rel, page_no, text)
            except OSError:
                cache = page_text_path(pages_dir, rel, page_no)
        ocr_type = extract_type_label(text)
        hospitals = HOSPITAL_RE.findall(text or "")
        rec = {
            "file": rel,
            "page": page_no,
            "ocr_type": ocr_type,
            "category": "其他",
            "specific": ocr_type or "",
            "engine": engine_name,
            "text": text,
            "text_path": str(cache.relative_to(out_dir)).replace("\\", "/"),
            "hospital": hospitals[0] if hospitals else "",
        }
        with lock:
            pages_map[(rel, page_no)] = rec
            done["n"] += 1
            if engine_name not in ("cache", "text"):
                done["ocr"] += 1
            else:
                done["cache"] += 1
        bump()
        return rec

    sem = threading.Semaphore(api_limit)

    def guarded(item):
        with sem:
            return parse_one(item)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(guarded, item) for item in plan]
        for fut in as_completed(futures):
            fut.result()

    pages = [pages_map[(rel, page_no)] for _, rel, page_no, _ in plan]
    failed = [p for p in pages if p.get("engine") == "error"]
    if failed and len(failed) == len(pages):
        raise RuntimeError((failed[0].get("text") or "全部页识图失败")[:240])
    classify_pages(pages, client, lambda msg, stage=None: bump(msg, stage=stage), api_limit)
    for p in pages:
        p["specific"] = p.get("ocr_type") or specific_type(p.get("text") or "", p.get("category") or "其他")
        if not p.get("specific"):
            p["specific"] = p.get("category") or "其他"

    bump("正在用模型构建诊疗时间轴", stage="时间轴")
    events, timeline_notes = build_timeline_llm(
        pages,
        client,
        lambda msg, stage=None: bump(msg, stage=stage),
        api_limit,
    )
    bump("正在写目录与时间轴", stage="写目录")
    catalog_rows, events, meta = write_artifacts(out_dir, pages, events, timeline_notes)
    job.update({
        "status": "done",
        "stage": "已完成",
        "updated_at": now_iso(),
        "done_pages": len(pages),
        "message": f"完成 {len(pages)} 页，目录 {len(catalog_rows)} 段，时间轴 {len(events)} 条",
        "patient_name": meta.get("name") or "",
        "categories": dict(Counter(p["category"] for p in pages)),
    })
    write_json(job_path, job)
    print(job["message"], flush=True)


def main():
    parser = argparse.ArgumentParser(description="扫描件病历批量解析")
    parser.add_argument("--materials", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--max-pages", type=int, default=0)
    args = parser.parse_args()
    materials = Path(args.materials).resolve()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        process(materials, out_dir, args.force, args.max_pages or None)
    except Exception as exc:
        job_path = out_dir / "parse-job.json"
        job = read_json(job_path, {}) or {}
        short = str(exc).splitlines()[-1][:240] if str(exc) else "未知错误"
        job.update({
            "status": "error",
            "updated_at": now_iso(),
            "error": traceback.format_exc()[-1500:],
            "message": f"解析失败：{short}",
        })
        write_json(job_path, job)
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
