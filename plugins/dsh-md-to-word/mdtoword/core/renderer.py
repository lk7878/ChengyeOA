"""
Word渲染模块
负责将解析后的Markdown结构渲染为Word文档
"""

import os
from typing import Dict, List, Any, Optional

from urllib.parse import unquote

from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm, Emu
from docx.enum.text import WD_LINE_SPACING, WD_PARAGRAPH_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from .typography import (
    FONT_HEITI,
    FONT_SONG,
    FONT_LATIN,
    SIZE_BODY,
    FIRST_LINE_INDENT,
    LINE_SPACING,
    LINE_SPACING_RULE,
    apply_body_paragraph_format,
    apply_heading_paragraph_format,
    heading_font_for_level,
    set_run_font,
    style_runs_in_paragraph,
)


class DocxRenderer:
    """将解析后的Markdown结构渲染为Word文档（医疗报告公文排版）"""

    def __init__(self, template_path: Optional[str] = None, asset_dirs: Optional[List[str]] = None):
        if template_path and os.path.exists(template_path):
            self.document = Document(template_path)
        else:
            self.document = Document()
        self.asset_dirs = [os.path.abspath(d) for d in (asset_dirs or []) if d]
        self._setup_page_margins()
        self._setup_default_tab_stop()

    def _setup_page_margins(self) -> None:
        """页边距：上 2 cm、下 2 cm、左 3 cm、右 3 cm。"""
        for section in self.document.sections:
            section.top_margin = Cm(2)
            section.bottom_margin = Cm(2)
            section.left_margin = Cm(3)
            section.right_margin = Cm(3)

    def _setup_default_tab_stop(self) -> None:
        """默认制表位：2 字符（小四字号下 24 磅）。"""
        settings = self.document.settings.element
        default_tab = settings.find(qn("w:defaultTabStop"))
        if default_tab is None:
            default_tab = OxmlElement("w:defaultTabStop")
            settings.append(default_tab)
        default_tab.set(qn("w:val"), str(int(FIRST_LINE_INDENT.twips)))

    def render(self, ast: List[Dict[str, Any]]) -> Document:
        for token in ast:
            self._render_token(token)
        return self.document

    def _render_token(self, token: Dict[str, Any]) -> None:
        token_type = token.get("type", "")
        if token_type == "heading":
            self._render_heading(token)
        elif token_type == "paragraph":
            self._render_paragraph(token)
        elif token_type == "list":
            self._render_list(token)
        elif token_type == "block_code":
            self._render_code_block(token)
        elif token_type == "block_quote":
            self._render_block_quote(token)
        elif token_type in ("thematic_break", "hr"):
            self._render_horizontal_rule()
        elif token_type == "table":
            self._render_table(token)
        elif token_type == "block_html":
            para = self.document.add_paragraph()
            run = para.add_run(token.get("text", ""))
            set_run_font(run, FONT_SONG, SIZE_BODY)

    def _render_heading(self, token: Dict[str, Any]) -> None:
        """标题：# 二号黑体居中；## 四号宋体顶格 RGB(79,128,189)；###+ 小四宋体顶格。"""
        level = token.get("level", 1)
        para = self.document.add_paragraph()
        apply_heading_paragraph_format(para, level)

        if "children" in token:
            for child in token["children"]:
                self._render_inline(child, para)

        cn_font, size = heading_font_for_level(level)
        style_runs_in_paragraph(para, cn_font, size, bold=True)

        if level == 2:
            heading_color = RGBColor(79, 128, 189)
            for run in para.runs:
                run.font.color.rgb = heading_color

    def _render_paragraph(self, token: Dict[str, Any]) -> None:
        """正文：小四宋体，首行缩进 2 字符，固定行距 28 磅。图片另起一段。"""
        children = token.get("children") or []
        if not children:
            para = self.document.add_paragraph()
            apply_body_paragraph_format(para)
            return
        buf: List[Dict[str, Any]] = []

        def flush() -> None:
            if not buf:
                return
            para = self.document.add_paragraph()
            apply_body_paragraph_format(para)
            for child in buf:
                self._render_inline(child, para)
            style_runs_in_paragraph(para, FONT_SONG, SIZE_BODY)
            buf.clear()

        for child in children:
            if child.get("type") == "image":
                flush()
                self._render_image_block(child)
            else:
                buf.append(child)
        flush()

    def _render_list(self, token: Dict[str, Any]) -> None:
        is_ordered = token.get("ordered", False)
        start = token.get("start", 1)

        for idx, item in enumerate(token.get("children", []), start=0):
            text_parts: List[str] = []
            images: List[Dict[str, Any]] = []
            nested: List[Dict[str, Any]] = []
            for child in item.get("children", []):
                if child.get("type") == "list":
                    nested.append(child)
                    continue
                nodes = child.get("children", []) if child.get("type") in ("block_text", "paragraph") else [child]
                for node in nodes:
                    if node.get("type") == "image":
                        images.append(node)
                    elif node.get("type") == "list":
                        nested.append(node)
                    else:
                        text_parts.append(self._extract_inline_text(node))

            text = "".join(text_parts).strip()
            if text:
                para = self.document.add_paragraph()
                para.paragraph_format.left_indent = Inches(0.3)
                para.paragraph_format.first_line_indent = Inches(-0.18)
                para.paragraph_format.line_spacing_rule = LINE_SPACING_RULE
                para.paragraph_format.line_spacing = LINE_SPACING
                para.paragraph_format.space_after = Pt(6)
                prefix = f"{start + idx}. " if is_ordered else "• "
                run = para.add_run(prefix + text)
                set_run_font(run, FONT_SONG, SIZE_BODY)
            for image in images:
                self._render_image_block(image)
            for child in nested:
                self._render_list(child)

    def _render_code_block(self, token: Dict[str, Any]) -> None:
        code = token.get("text", "")
        language = token.get("info", "")

        if language:
            lang_para = self.document.add_paragraph()
            lang_run = lang_para.add_run(f"语言: {language}")
            lang_run.italic = True
            set_run_font(lang_run, FONT_SONG, SIZE_BODY)

        code_para = self.document.add_paragraph(style="No Spacing")
        code_run = code_para.add_run(code)
        has_cjk = any("\u4e00" <= c <= "\u9fff" for c in code)
        if has_cjk:
            set_run_font(code_run, FONT_SONG, Pt(9))
        else:
            set_run_font(code_run, FONT_LATIN, Pt(9), latin_font="Courier New")
        self.document.add_paragraph()

    def _render_block_quote(self, token: Dict[str, Any]) -> None:
        quote_para = self.document.add_paragraph()
        quote_para.paragraph_format.left_indent = Inches(0.5)
        quote_para.paragraph_format.right_indent = Inches(0.5)
        quote_para.paragraph_format.line_spacing_rule = LINE_SPACING_RULE
        quote_para.paragraph_format.line_spacing = LINE_SPACING
        quote_para.paragraph_format.space_after = Pt(6)
        quote_para.paragraph_format.first_line_indent = Pt(0)

        for child in token.get("children", []):
            self._render_token_in_paragraph(child, quote_para)

        style_runs_in_paragraph(quote_para, FONT_SONG, SIZE_BODY)

    def _render_horizontal_rule(self) -> None:
        p = self.document.add_paragraph()
        run = p.add_run("━" * 30)
        set_run_font(run, FONT_SONG, SIZE_BODY)
        p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(12)

    def _cell_text(self, cell_token: Dict[str, Any]) -> str:
        parts: List[str] = []
        for child in cell_token.get("children", []):
            parts.append(self._extract_inline_text(child))
        return "".join(parts).strip()

    def _render_table(self, token: Dict[str, Any]) -> None:
        """医疗报告不输出 Word 表格，改成编号段落。"""
        rows = token.get("children", [])
        if not rows:
            return
        headers = [self._cell_text(c) for c in rows[0].get("children", [])]
        body = rows[1:] if len(rows) > 1 else []
        if not body:
            for i, name in enumerate(headers, 1):
                if name:
                    para = self.document.add_paragraph()
                    apply_body_paragraph_format(para)
                    run = para.add_run(f"{i}. {name}")
                    set_run_font(run, FONT_SONG, SIZE_BODY)
            return
        for ridx, row_token in enumerate(body, 1):
            cells = [self._cell_text(c) for c in row_token.get("children", [])]
            parts = []
            for cidx, cell in enumerate(cells):
                if not cell:
                    continue
                label = headers[cidx] if cidx < len(headers) and headers[cidx] else f"第{cidx + 1}项"
                parts.append(f"{label}：{cell}")
            if not parts:
                continue
            para = self.document.add_paragraph()
            apply_body_paragraph_format(para)
            run = para.add_run(f"{ridx}. " + "；".join(parts) + "。")
            set_run_font(run, FONT_SONG, SIZE_BODY)

    def _render_inline(self, token: Dict[str, Any], paragraph) -> None:
        token_type = token.get("type", "")
        if token_type == "text":
            paragraph.add_run(token.get("text", ""))
        elif token_type == "emphasis":
            run = paragraph.add_run(self._extract_inline_text(token))
            run.italic = True
        elif token_type == "strong":
            run = paragraph.add_run(self._extract_inline_text(token))
            run.bold = True
        elif token_type == "link":
            text = self._extract_inline_text(token) or token.get("title", "") or token.get("link", "")
            url = token.get("link", "")
            run = paragraph.add_run(text)
            run.font.underline = True
            run.font.color.rgb = RGBColor(0, 0, 255)
            note_run = paragraph.add_run(f" [{url}]")
            note_run.font.color.rgb = RGBColor(0, 0, 255)
        elif token_type == "image":
            self._render_image_block(token)
        elif token_type == "codespan":
            code_text = token.get("text", "")
            run = paragraph.add_run(code_text)
            has_cjk = any("\u4e00" <= c <= "\u9fff" for c in code_text)
            if has_cjk:
                set_run_font(run, FONT_SONG, SIZE_BODY)
            else:
                set_run_font(run, FONT_LATIN, SIZE_BODY, latin_font="Courier New")
        elif token_type == "linebreak":
            paragraph.add_run().add_break()
        elif token_type == "softbreak":
            paragraph.add_run(" ")
        else:
            text = token.get("text", "")
            if text:
                paragraph.add_run(text)

    def _content_box(self) -> tuple:
        """版心宽高（EMU）。高度给图题留出一行。"""
        section = self.document.sections[-1]
        width = int(section.page_width - section.left_margin - section.right_margin)
        height = int(section.page_height - section.top_margin - section.bottom_margin)
        return width, max(int(Cm(4)), height - int(Cm(1.4)))

    def _fit_picture(self, source) -> tuple:
        """按图片自身像素和 DPI 缩进版心，不放大，保持宽高比。"""
        from docx.image.image import Image as DocxImage

        image = DocxImage.from_file(source) if isinstance(source, str) else DocxImage.from_blob(source.read())
        if hasattr(source, "seek"):
            source.seek(0)
        dpi_x = image.horz_dpi or 96
        dpi_y = image.vert_dpi or 96
        cx = int(image.px_width * 914400 / dpi_x)
        cy = int(image.px_height * 914400 / dpi_y)
        max_w, max_h = self._content_box()
        scale = min(max_w / cx, max_h / cy, 1)
        return Emu(int(cx * scale)), Emu(int(cy * scale))

    def _resolve_image(self, src: str) -> Optional[str]:
        raw = unquote((src or "").strip().strip("<>")).replace("\\", "/")
        if not raw or raw.startswith(("http://", "https://")):
            return raw or None
        raw = raw.split("?", 1)[0].split("#", 1)[0]
        local = raw.replace("/", os.sep)
        candidates = []
        if os.path.isabs(local):
            candidates.append(local)
        else:
            for base in self.asset_dirs:
                candidates.append(os.path.normpath(os.path.join(base, local)))
            candidates.append(os.path.abspath(local))
        for path in candidates:
            if os.path.isfile(path):
                return path
        return None

    def _apply_figure_paragraph(self, paragraph, *, keep_with_next: bool) -> None:
        """图本身不用正文的首行缩进和固定行距，否则嵌入式图片会被裁切或挤偏。"""
        fmt = paragraph.paragraph_format
        fmt.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
        fmt.first_line_indent = Pt(0)
        fmt.left_indent = Pt(0)
        fmt.right_indent = Pt(0)
        fmt.line_spacing_rule = WD_LINE_SPACING.SINGLE
        fmt.space_before = Pt(6)
        fmt.space_after = Pt(0 if keep_with_next else 6)
        fmt.keep_together = True
        fmt.keep_with_next = keep_with_next

    def _add_caption(self, alt: str) -> None:
        caption = self.document.add_paragraph()
        fmt = caption.paragraph_format
        fmt.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
        fmt.first_line_indent = Pt(0)
        fmt.left_indent = Pt(0)
        fmt.right_indent = Pt(0)
        fmt.line_spacing_rule = WD_LINE_SPACING.SINGLE
        fmt.space_before = Pt(2)
        fmt.space_after = Pt(6)
        fmt.keep_together = True
        run = caption.add_run(alt)
        set_run_font(run, FONT_SONG, SIZE_BODY)

    def _add_picture_note(self, alt: str) -> None:
        para = self.document.add_paragraph()
        apply_body_paragraph_format(para)
        label = alt or "未命名图片"
        run = para.add_run(f"【图片未找到：{label}】")
        set_run_font(run, FONT_SONG, SIZE_BODY)

    def _render_image_block(self, token: Dict[str, Any]) -> None:
        """图片单独成段、居中、嵌入式，图题紧跟在下一行。"""
        src = token.get("src", "") or ""
        alt = (token.get("alt") or "").strip()
        resolved = self._resolve_image(src)
        try:
            if resolved and not resolved.startswith(("http://", "https://")):
                width, height = self._fit_picture(resolved)
                para = self.document.add_paragraph()
                self._apply_figure_paragraph(para, keep_with_next=bool(alt))
                para.add_run().add_picture(resolved, width=width, height=height)
                if alt:
                    self._add_caption(alt)
                return
            if src.startswith(("http://", "https://")):
                import requests
                from io import BytesIO

                response = requests.get(src, timeout=10)
                response.raise_for_status()
                blob = BytesIO(response.content)
                width, height = self._fit_picture(blob)
                para = self.document.add_paragraph()
                self._apply_figure_paragraph(para, keep_with_next=bool(alt))
                para.add_run().add_picture(blob, width=width, height=height)
                if alt:
                    self._add_caption(alt)
                return
            self._add_picture_note(alt or os.path.basename(src))
        except Exception:
            self._add_picture_note(alt or os.path.basename(src))

    def _extract_inline_text(self, token: Dict[str, Any]) -> str:
        token_type = token.get("type", "")
        if token_type in ("text", "codespan"):
            return token.get("text", "")
        if token_type == "link":
            children = token.get("children", [])
            if children:
                return "".join(self._extract_inline_text(c) for c in children)
            return token.get("text", "") or token.get("title", "")
        children = token.get("children", [])
        if children:
            return "".join(self._extract_inline_text(c) for c in children)
        return token.get("text", "")

    def _extract_list_item_text(self, item_token: Dict[str, Any]) -> str:
        parts: List[str] = []
        for child in item_token.get("children", []):
            ctype = child.get("type", "")
            if ctype == "list":
                continue
            if ctype == "paragraph":
                for inline in child.get("children", []):
                    parts.append(self._extract_inline_text(inline))
            else:
                parts.append(self._extract_inline_text(child))
        return "".join(parts)

    def _render_token_in_paragraph(self, token: Dict[str, Any], paragraph) -> None:
        token_type = token.get("type", "")
        if token_type == "paragraph":
            for child in token.get("children", []):
                self._render_inline(child, paragraph)
        else:
            self._render_inline(token, paragraph)
