# -*- coding: utf-8 -*-
"""从《医疗损害鉴定技术指引》切出方法稿与案例卡（内部工作副本）。"""
from __future__ import annotations

import json
import re
from pathlib import Path

import fitz

ROOT = Path(r"E:\A")
PDF = ROOT / "temp" / "医疗损害鉴定技术指引 -- 夏文涛,徐洪新,蒋士浩主编.pdf"
OUT_METHOD = ROOT / "konwledge-md" / "tech-guide"
OUT_CASE = ROOT / "konwledge-md" / "tech-guide-cases"
REPORT = ROOT / "reports"

# 目录印刷页（正文页码）。PDF 封面/CIP/目录在正文之前。
SECTIONS = [
    {"id": "ch1-s1", "chapter": 1, "title": "第一章 概述", "print_start": 1, "kind": "method", "folder": "实证", "tags": ["层级:实证", "章:1"]},
    {"id": "ch1-s2", "chapter": 1, "title": "第一章 医疗损害责任纠纷案件鉴定与裁判结果分析", "print_start": 6, "kind": "method", "folder": "实证", "tags": ["层级:实证", "章:1"]},
    {"id": "ch1-s3", "chapter": 1, "title": "第一章 医疗损害鉴定分析", "print_start": 19, "kind": "method", "folder": "实证", "tags": ["层级:实证", "章:1"]},
    {"id": "ch2-s1", "chapter": 2, "title": "第二章 常见医疗损害鉴定过错类型 概述", "print_start": 37, "kind": "method", "folder": "过错", "tags": ["层级:过错", "章:2"]},
    {"id": "ch2-s2", "chapter": 2, "title": "第二章 诊断有关的过错", "print_start": 39, "kind": "mixed", "folder": "过错", "disease": "", "fault": "诊断过错", "tags": ["层级:过错", "过错:诊断", "章:2"]},
    {"id": "ch2-s3", "chapter": 2, "title": "第二章 用药有关的过错", "print_start": 45, "kind": "mixed", "folder": "过错", "disease": "", "fault": "用药过错", "tags": ["层级:过错", "过错:用药", "章:2"]},
    {"id": "ch2-s4", "chapter": 2, "title": "第二章 与手术有关的过错", "print_start": 56, "kind": "mixed", "folder": "过错", "disease": "", "fault": "手术过错", "tags": ["层级:过错", "过错:手术", "章:2"]},
    {"id": "ch2-s5", "chapter": 2, "title": "第二章 过度医疗的过错", "print_start": 76, "kind": "mixed", "folder": "过错", "disease": "", "fault": "过度医疗", "tags": ["层级:过错", "过错:过度医疗", "章:2"]},
    {"id": "ch2-s6", "chapter": 2, "title": "第二章 知情告知的过错", "print_start": 77, "kind": "mixed", "folder": "过错", "disease": "", "fault": "知情告知", "tags": ["层级:过错", "过错:知情告知", "章:2"]},
    {"id": "ch2-s7", "chapter": 2, "title": "第二章 机会丧失的过错", "print_start": 86, "kind": "mixed", "folder": "过错", "disease": "", "fault": "机会丧失", "tags": ["层级:过错", "过错:机会丧失", "章:2"]},
    {"id": "ch2-s8", "chapter": 2, "title": "第二章 病历书写的过错", "print_start": 93, "kind": "mixed", "folder": "过错", "disease": "", "fault": "病历书写", "tags": ["层级:过错", "过错:病历书写", "章:2"]},
    {"id": "ch2-s9", "chapter": 2, "title": "第二章 其他过错", "print_start": 101, "kind": "mixed", "folder": "过错", "disease": "", "fault": "其他过错", "tags": ["层级:过错", "过错:其他", "章:2"]},
    {"id": "ch3-s01", "chapter": 3, "title": "甲状腺手术并发症", "print_start": 108, "kind": "mixed", "folder": "疾病/手术", "disease": "甲状腺手术", "specialty": "手术", "tags": ["层级:疾病", "专科:手术", "疾病:甲状腺手术"]},
    {"id": "ch3-s02", "chapter": 3, "title": "主动脉瘤及主动脉夹层", "print_start": 118, "kind": "mixed", "folder": "疾病/急危", "disease": "主动脉瘤及夹层", "specialty": "急危重症", "tags": ["层级:疾病", "专科:急危重症", "疾病:主动脉夹层"]},
    {"id": "ch3-s03", "chapter": 3, "title": "冠状动脉支架植入术并发症", "print_start": 126, "kind": "mixed", "folder": "疾病/手术", "disease": "PCI", "specialty": "手术", "tags": ["层级:疾病", "专科:手术", "疾病:PCI"]},
    {"id": "ch3-s04", "chapter": 3, "title": "急腹症", "print_start": 134, "kind": "mixed", "folder": "疾病/急危", "disease": "急腹症", "specialty": "急危重症", "tags": ["层级:疾病", "专科:急危重症", "疾病:急腹症"]},
    {"id": "ch3-s05", "chapter": 3, "title": "腹腔镜手术所致损伤", "print_start": 145, "kind": "mixed", "folder": "疾病/手术", "disease": "腹腔镜手术", "specialty": "手术", "tags": ["层级:疾病", "专科:手术", "疾病:腹腔镜"]},
    {"id": "ch3-s06", "chapter": 3, "title": "子宫切除术后并发症", "print_start": 156, "kind": "mixed", "folder": "疾病/手术", "disease": "子宫切除术", "specialty": "手术", "tags": ["层级:疾病", "专科:手术", "疾病:子宫切除"]},
    {"id": "ch3-s07", "chapter": 3, "title": "脊柱术后致瘫痪", "print_start": 173, "kind": "mixed", "folder": "疾病/手术", "disease": "脊柱手术", "specialty": "手术", "tags": ["层级:疾病", "专科:手术", "疾病:脊柱手术"]},
    {"id": "ch3-s08", "chapter": 3, "title": "骨折后神经损伤", "print_start": 180, "kind": "mixed", "folder": "疾病/骨科", "disease": "骨折后神经损伤", "specialty": "骨科", "tags": ["层级:疾病", "专科:骨科", "疾病:骨折神经损伤"]},
    {"id": "ch3-s09", "chapter": 3, "title": "股骨头坏死", "print_start": 186, "kind": "mixed", "folder": "疾病/骨科", "disease": "股骨头坏死", "specialty": "骨科", "tags": ["层级:疾病", "专科:骨科", "疾病:股骨头坏死"]},
    {"id": "ch3-s10", "chapter": 3, "title": "骨折致关节功能障碍", "print_start": 196, "kind": "mixed", "folder": "疾病/骨科", "disease": "骨折致关节功能障碍", "specialty": "骨科", "tags": ["层级:疾病", "专科:骨科", "疾病:关节功能障碍"]},
    {"id": "ch3-s11", "chapter": 3, "title": "骨折后并发钢板断裂", "print_start": 202, "kind": "mixed", "folder": "疾病/骨科", "disease": "钢板断裂", "specialty": "骨科", "tags": ["层级:疾病", "专科:骨科", "疾病:钢板断裂"]},
    {"id": "ch3-s12", "chapter": 3, "title": "麻醉术后评估及转运", "print_start": 210, "kind": "mixed", "folder": "疾病/手术", "disease": "麻醉术后评估转运", "specialty": "手术", "tags": ["层级:疾病", "专科:手术", "疾病:麻醉术后"]},
    {"id": "ch3-s13", "chapter": 3, "title": "椎管内麻醉", "print_start": 215, "kind": "mixed", "folder": "疾病/手术", "disease": "椎管内麻醉", "specialty": "手术", "tags": ["层级:疾病", "专科:手术", "疾病:椎管内麻醉"]},
    {"id": "ch3-s14", "chapter": 3, "title": "急性缺血性脑卒中静脉溶栓", "print_start": 222, "kind": "mixed", "folder": "疾病/急危", "disease": "脑卒中溶栓", "specialty": "急危重症", "tags": ["层级:疾病", "专科:急危重症", "疾病:脑卒中溶栓"]},
    {"id": "ch3-s15", "chapter": 3, "title": "心肌炎死亡", "print_start": 230, "kind": "mixed", "folder": "疾病/急危", "disease": "心肌炎", "specialty": "急危重症", "tags": ["层级:疾病", "专科:急危重症", "疾病:心肌炎"]},
    {"id": "ch3-s16", "chapter": 3, "title": "死胎", "print_start": 238, "kind": "mixed", "folder": "疾病/产科", "disease": "死胎", "specialty": "产科", "tags": ["层级:疾病", "专科:产科", "疾病:死胎"]},
    {"id": "ch3-s17", "chapter": 3, "title": "脑瘫", "print_start": 248, "kind": "mixed", "folder": "疾病/产科", "disease": "脑瘫", "specialty": "产科", "tags": ["层级:疾病", "专科:产科", "疾病:脑瘫"]},
    {"id": "ch3-s18", "chapter": 3, "title": "新生儿窒息死亡", "print_start": 257, "kind": "mixed", "folder": "疾病/产科", "disease": "新生儿窒息", "specialty": "产科", "tags": ["层级:疾病", "专科:产科", "疾病:新生儿窒息"]},
    {"id": "ch3-s19", "chapter": 3, "title": "新生儿臂丛神经损伤", "print_start": 264, "kind": "mixed", "folder": "疾病/产科", "disease": "臂丛神经损伤", "specialty": "产科", "tags": ["层级:疾病", "专科:产科", "疾病:臂丛神经"]},
    {"id": "ch3-s20", "chapter": 3, "title": "错误出生", "print_start": 274, "kind": "mixed", "folder": "疾病/产科", "disease": "错误出生", "specialty": "产科", "tags": ["层级:疾病", "专科:产科", "疾病:错误出生"]},
    {"id": "ch3-s21", "chapter": 3, "title": "临床病理诊断相关", "print_start": 282, "kind": "mixed", "folder": "疾病/急危", "disease": "临床病理诊断", "specialty": "急危重症", "tags": ["层级:疾病", "专科:急危重症", "疾病:病理诊断"]},
    {"id": "ch4-s1", "chapter": 4, "title": "鉴定意见书的基本要求", "print_start": 291, "kind": "method", "folder": "文书", "tags": ["层级:文书", "章:4"]},
    {"id": "ch4-s2", "chapter": 4, "title": "鉴定意见书中因果关系的论证", "print_start": 298, "kind": "method", "folder": "文书", "tags": ["层级:文书", "章:4", "主题:因果关系"]},
    {"id": "ch4-s3", "chapter": 4, "title": "医疗损害鉴定意见书评析", "print_start": 311, "kind": "method", "folder": "文书", "tags": ["层级:文书", "章:4", "主题:意见书评析"]},
    {"id": "ch5", "chapter": 5, "title": "医疗纠纷尸检概述", "print_start": 328, "kind": "method", "folder": "尸检", "tags": ["层级:尸检", "章:5"]},
]

FW = str.maketrans("０１２３４５６７８９", "0123456789")
CASE_MARK = re.compile(r"【\s*案例\s*([0-9０-９一二三四五六七八九十]+)\s*([^】]*)】")
CAUSE_PAT = re.compile(r"(完全原因|主要原因|同等原因|次要原因|轻微原因|无因果关系|无原因力)")
HEADER_NOISE = re.compile(
    r"^(?:[?？]?\s*医疗损害鉴定技术指引|"
    r"第[一二三四五]章.*|"
    r"[0-9０-９]{1,3}\s*$)"
)


def fw_int(s: str) -> int | None:
    s = s.translate(FW).strip()
    if re.fullmatch(r"\d{1,3}", s):
        n = int(s)
        if 1 <= n <= 340:
            return n
    return None


def clean_page_text(raw: str) -> str:
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    raw = raw.replace("\u3000", " ")
    lines = [ln.rstrip() for ln in raw.split("\n")]
    return "\n".join(lines).strip()


def detect_print_page(text: str) -> int | None:
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    if not lines:
        return None
    # 页码常单独成行，出现在页眉或页脚
    for ln in (lines[0], lines[-1], lines[1] if len(lines) > 1 else ""):
        n = fw_int(ln)
        if n:
            return n
    # 页脚「数字 + 章名」或章名旁的数字
    tail = "\n".join(lines[-4:])
    found = re.findall(r"(?<!\d)([0-9０-９]{1,3})(?!\d)", tail)
    cands = [fw_int(x) for x in found]
    cands = [c for c in cands if c]
    if len(cands) == 1:
        return cands[0]
    return None


def strip_noise(text: str) -> str:
    kept = []
    for ln in text.split("\n"):
        s = ln.strip()
        if not s:
            kept.append("")
            continue
        if HEADER_NOISE.match(s):
            continue
        if fw_int(s):
            continue
        kept.append(ln)
    # 压缩多余空行
    out, blank = [], 0
    for ln in kept:
        if ln.strip() == "":
            blank += 1
            if blank <= 1:
                out.append("")
        else:
            blank = 0
            out.append(ln)
    return "\n".join(out).strip()


def split_method_cases(text: str) -> tuple[str, list[tuple[str, str]]]:
    """按【案例N】切开。返回 (方法正文, [(标题, 正文)])."""
    marks = list(CASE_MARK.finditer(text))
    if not marks:
        return text.strip(), []
    method = text[: marks[0].start()].strip()
    method = re.sub(r"[一二三四五六七八九十]、\s*案例\s*$", "", method).strip()
    cases = []
    for j, m in enumerate(marks):
        end = marks[j + 1].start() if j + 1 < len(marks) else len(text)
        body = text[m.start() : end].strip()
        inner = (m.group(2) or "").strip(" （）()")
        num = m.group(1).translate(FW)
        title = f"案例{num}" + (f" {inner}" if inner else "")
        cases.append((title, body))
    return method, cases


def guess_causation(text: str) -> str:
    hits = CAUSE_PAT.findall(text)
    if not hits:
        return "未标明"
    # 取最后一次出现，通常是结论
    last = hits[-1]
    return last.replace("无原因力", "无")


def write_md(path: Path, title: str, meta: dict, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"# {title}", ""]
    for k, v in meta.items():
        if v is None or v == "":
            continue
        lines.append(f"- {k}：{v}")
    lines.append("")
    lines.append(body.strip())
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    if not PDF.exists():
        raise SystemExit(f"missing pdf: {PDF}")
    OUT_METHOD.mkdir(parents=True, exist_ok=True)
    OUT_CASE.mkdir(parents=True, exist_ok=True)
    REPORT.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(PDF)
    pages = []
    for i in range(doc.page_count):
        raw = doc[i].get_text("text") or ""
        text = clean_page_text(raw)
        detected = detect_print_page(text)
        pages.append({
            "pdf_page": i + 1,
            "print_page": detected,
            "chars": len(text),
            "text": text,
        })

    # 校正印刷页：正文从检测到的连续页码建立映射
    # 先找「印刷页=1」的 PDF 页
    offset = None
    for p in pages:
        if p["print_page"] == 1 and p["pdf_page"] >= 8:
            offset = p["pdf_page"] - 1
            break
    if offset is None:
        offset = 9  # 实测：PDF 第10页 = 印刷第1页

    for p in pages:
        inferred = p["pdf_page"] - offset
        if inferred < 1 or inferred > 340:
            p["print_page_final"] = p["print_page"]
        elif p["print_page"] is None:
            p["print_page_final"] = inferred
        elif abs(p["print_page"] - inferred) <= 1:
            p["print_page_final"] = p["print_page"]
        else:
            # 检测值常把页眉章节号误判，以推算为准
            p["print_page_final"] = inferred

    page_map = [
        {"pdf_page": p["pdf_page"], "print_page": p["print_page_final"], "detected": p["print_page"], "chars": p["chars"]}
        for p in pages
    ]
    (REPORT / "tech-guide-page-map.json").write_text(
        json.dumps({"offset": offset, "pages": page_map}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    by_print: dict[int, list[str]] = {}
    for p in pages:
        pp = p["print_page_final"]
        if not pp:
            continue
        by_print.setdefault(pp, []).append(p["text"])

    ends = [s["print_start"] for s in SECTIONS[1:]] + [335]
    for i, sec in enumerate(SECTIONS):
        sec["print_end"] = ends[i] - 1

    method_docs = []
    case_docs = []
    case_seq = {"2": 0, "3": 0}

    for sec in SECTIONS:
        chunks = []
        for pn in range(sec["print_start"], sec["print_end"] + 1):
            if pn in by_print:
                chunks.append("\n\n".join(by_print[pn]))
        body = strip_noise("\n\n".join(chunks).strip())
        source = f"《医疗损害鉴定技术指引》夏文涛等主编，科学出版社2020，印刷第{sec['print_start']}-{sec['print_end']}页"

        if sec["kind"] == "method":
            fname = f"{sec['id']}.md"
            meta = {
                "来源": source,
                "章节": sec["title"],
                "文档类型": "技术指引",
            }
            write_md(OUT_METHOD / fname, sec["title"], meta, body)
            method_docs.append({**sec, "file": fname, "chars": len(body)})
            continue

        method_body, cases = split_method_cases(body)
        fname = f"{sec['id']}.md"
        meta = {
            "来源": source,
            "章节": sec["title"],
            "文档类型": "技术指引",
            "疾病": sec.get("disease") or "",
            "过错类型": sec.get("fault") or "",
        }
        # 方法稿去掉过短残片
        if len(method_body) < 80 and cases:
            method_body = body
            cases = []
        write_md(OUT_METHOD / fname, f"{sec['title']}（鉴定技术指引）", meta, method_body or body)
        method_docs.append({**sec, "file": fname, "chars": len(method_body or body), "cases_split": len(cases)})

        ch = str(sec["chapter"])
        for title, cbody in cases:
            case_seq[ch] += 1
            cid = f"C{ch}-{case_seq[ch]:02d}"
            cfile = f"{cid}.md"
            causation = guess_causation(cbody)
            cmeta = {
                "案例编号": cid,
                "来源": source,
                "所属章节": sec["title"],
                "疾病": sec.get("disease") or "",
                "专科": sec.get("specialty") or "",
                "过错类型": sec.get("fault") or "",
                "原因力": causation,
                "文档类型": "书内案例（参考，非判例）",
            }
            write_md(OUT_CASE / cfile, f"{cid} {title}", cmeta, cbody)
            case_docs.append({
                "id": cid,
                "title": title,
                "file": cfile,
                "section_id": sec["id"],
                "chapter": sec["chapter"],
                "disease": sec.get("disease") or "",
                "specialty": sec.get("specialty") or "",
                "fault": sec.get("fault") or "",
                "causation": causation,
                "print_start": sec["print_start"],
                "print_end": sec["print_end"],
                "chars": len(cbody),
            })

    (REPORT / "tech-guide-method-index.json").write_text(
        json.dumps(method_docs, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (REPORT / "tech-guide-case-index.json").write_text(
        json.dumps({"count": len(case_docs), "cases": case_docs}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"methods={len(method_docs)} cases={len(case_docs)} offset={offset}")
    print(f"method_dir={OUT_METHOD}")
    print(f"case_dir={OUT_CASE}")


if __name__ == "__main__":
    main()
