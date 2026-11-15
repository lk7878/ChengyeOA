#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Markdown → 公文排版 Word。stdout 只输出一行 JSON。"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from mdtoword.core.converter import convert
from mdtoword.core.utils import flatten_markdown_tables


def _sanitize(md_content: str) -> str:
    cleaned = flatten_markdown_tables(
        (md_content or "")
        .replace("\ufeff", "")
        .replace("\u200b", "")
        .replace("\u200c", "")
        .replace("\u200d", "")
        .replace("\u2060", "")
        .replace("\xa0", " ")
    )
    lines = cleaned.splitlines()
    out: list[str] = []
    blank = 0
    for line in lines:
        current = line.rstrip()
        if not current:
            blank += 1
            if blank <= 1:
                out.append("")
            continue
        blank = 0
        out.append(current)
    return "\n".join(out).strip() + "\n"


def _add_title_divider(md_content: str) -> str:
    lines = md_content.splitlines()
    result: list[str] = []
    divider = "---"
    for idx, line in enumerate(lines):
        result.append(line)
        if not re.match(r"^#\s*病历分析报告", line):
            continue
        nxt = lines[idx + 1].strip() if idx + 1 < len(lines) else ""
        if nxt in (divider, "___", "***"):
            continue
        result.append(divider)
    return "\n".join(result)


def _split_h2(md_content: str):
    matches = list(re.finditer(r"(?m)^##\s+(.+?)\s*$", md_content))
    if not matches:
        return "", []
    preamble = md_content[: matches[0].start()].strip()
    sections = []
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(md_content)
        sections.append((match.group(1).strip(), md_content[match.end() : end].strip()))
    return preamble, sections


def _section_body(sections, *keywords: str) -> str:
    for title, body in sections:
        if any(key in title for key in keywords):
            return body
    return ""


def _split_note(body: str):
    match = re.search(r"(?m)^#{0,3}\s*备注\s*[:：]?\s*$", body or "")
    if not match:
        return (body or "").strip(), ""
    return body[: match.start()].strip(), body[match.end() :].strip()


def extract_patient_name(md_content: str) -> str:
    match = re.search(r"(?m)^#\s*(.+?)案\s*$", md_content or "")
    if not match:
        return ""
    name = re.sub(r'[\\/:*?"<>|]', "", match.group(1).strip())
    if not name or name.startswith("病历分析报告"):
        return ""
    return name


def build_standard_markdown(md_content: str, patient: str = "") -> str:
    """从详细版原样摘出概要、损害、因果、备注、附录，并重排为标准版。"""
    preamble, sections = _split_h2(md_content or "")
    overview = _section_body(sections, "患者诊疗过程概要")
    damage = _section_body(sections, "损害后果")
    cause = _section_body(sections, "因果关系")
    appendix = _section_body(sections, "附录")
    if not overview or not damage or not cause:
        return ""
    cause_body, note = _split_note(cause)
    standalone_note = _section_body(sections, "备注")
    if standalone_note and not note:
        note = standalone_note
    heads = []
    for line in preamble.splitlines():
        stripped = line.strip()
        if not stripped.startswith("# "):
            continue
        if re.match(r"^#\s*病历分析报告", stripped):
            heads.append(f"# 病历分析报告（{patient}）" if patient else "# 病历分析报告")
        else:
            heads.append(stripped)
    if not any(re.match(r"^#\s*病历分析报告", line) for line in heads):
        heads.append(f"# 病历分析报告（{patient}）" if patient else "# 病历分析报告")
    parts = [
        "\n".join(heads).strip(),
        "",
        "## 一、患者诊疗过程概要",
        "",
        overview,
        "",
        "## 二、损害后果",
        "",
        damage,
        "",
        "## 三、因果关系及原因力初判",
        "",
        cause_body,
    ]
    if note:
        parts.extend(["", "## 备注", "", note])
    if appendix:
        parts.extend(["", "## 附录", "", appendix])
    return "\n".join(parts).strip() + "\n"


def _convert_markdown(md_content: str, dest: Path, title: str, author: str, subject: str, keywords: str) -> None:
    tmp_md = dest.with_suffix(".export-tmp.md")
    try:
        tmp_md.write_text(_add_title_divider(_sanitize(md_content)), encoding="utf-8")
        dest.parent.mkdir(parents=True, exist_ok=True)
        sink = io.StringIO()
        with redirect_stdout(sink):
            ok = convert(
                str(tmp_md),
                str(dest),
                metadata={
                    "title": title,
                    "author": author,
                    "subject": subject,
                    "keywords": keywords,
                },
            )
        if not ok or not dest.is_file():
            detail = sink.getvalue().strip() or "mdtoword 转换失败"
            raise RuntimeError(detail)
    finally:
        if tmp_md.exists():
            try:
                tmp_md.unlink()
            except OSError:
                pass


def emit(payload: dict, code: int = 0) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return code


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="将 Markdown 转为公文排版 Word")
    parser.add_argument("--input", required=True, help="输入 .md 路径")
    parser.add_argument("--output", required=True, help="输出 .docx 路径")
    parser.add_argument("--title", default="", help="文档标题")
    parser.add_argument("--author", default="百佑智鉴")
    args = parser.parse_args(argv)

    src = Path(args.input).expanduser().resolve()
    dest = Path(args.output).expanduser().resolve()
    if not src.is_file():
        return emit({"ok": False, "error": f"输入文件不存在: {src}"}, 1)
    if src.suffix.lower() not in {".md", ".markdown"}:
        return emit({"ok": False, "error": f"输入必须是 Markdown：{src.name}"}, 1)
    if dest.suffix.lower() != ".docx":
        return emit({"ok": False, "error": f"输出必须是 .docx：{dest.name}"}, 1)

    try:
        raw = src.read_text(encoding="utf-8")
    except Exception as exc:
        return emit({"ok": False, "error": f"读取 Markdown 失败: {exc}"}, 1)

    patient = extract_patient_name(raw)
    full_report = (
        "标准版" not in src.stem
        and "详细版" not in src.stem
        and not src.stem.startswith("病历分析报告（")
        and "患者诊疗过程概要" in raw
        and "损害后果" in raw
    )
    title = (args.title or "").strip() or src.stem
    medical = "患者诊疗过程概要" in raw or "病历分析报告" in raw
    subject = "医疗病历审查报告" if medical else "鉴定文书"
    keywords = "医疗,审查,鉴定" if medical else "鉴定"
    detailed_md = raw
    if full_report and patient:
        title = f"病历分析报告-详细版（{patient}）"
        dest = dest.parent / f"{title}.docx"
        detailed_md = re.sub(
            r"(?m)^#\s*病历分析报告\s*$",
            f"# {title}",
            raw,
            count=1,
        )
    try:
        _convert_markdown(detailed_md, dest, title, args.author, subject, keywords)
    except Exception as exc:
        return emit({"ok": False, "error": str(exc)}, 1)

    payload = {
        "ok": True,
        "output": str(dest),
        "bytes": dest.stat().st_size,
        "title": title,
        "standard_output": "",
        "standard_markdown": "",
        "standard_bytes": 0,
    }
    if full_report:
        standard_title = f"病历分析报告（{patient}）" if patient else f"{dest.stem}-标准版"
        standard_md = build_standard_markdown(raw, patient)
        if standard_md:
            standard_dest = dest.parent / f"{standard_title}.docx"
            standard_md_path = dest.parent / f"{standard_title}.md"
            try:
                standard_md_path.write_text(standard_md, encoding="utf-8")
                _convert_markdown(standard_md, standard_dest, standard_title, args.author, subject, keywords)
            except Exception as exc:
                return emit({"ok": False, "error": f"详细版已写出，标准版失败: {exc}", "output": str(dest)}, 1)
            payload["standard_output"] = str(standard_dest)
            payload["standard_markdown"] = str(standard_md_path)
            payload["standard_bytes"] = standard_dest.stat().st_size
    return emit(payload)


if __name__ == "__main__":
    raise SystemExit(main())
