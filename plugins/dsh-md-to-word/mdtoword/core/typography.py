"""
医疗报告 Word 导出 typography — 公文风格字体与段落规范。

规范：
- 标题（Markdown #）：二号黑体，居中，加粗
- 一级标题（Markdown ##）：四号宋体，加粗，顶格
- 二/三/四级标题（Markdown ### ~ ######）：小四号宋体，加粗，顶格
- 正文：小四号宋体，首行缩进 2 字符，固定行距 28 磅
- 数字/英文：Times New Roman（与中文混排时由 Word 自动切换）
"""

from pathlib import Path
from typing import Optional

from docx.shared import Pt
from docx.oxml.ns import qn
from docx.enum.text import WD_LINE_SPACING, WD_PARAGRAPH_ALIGNMENT

# 字体名称（Windows 对应 SimHei / SimSun；fonts 目录提供同名文件备用）
FONT_HEITI = "黑体"
FONT_SONG = "宋体"
FONT_LATIN = "Times New Roman"

# 字号（磅）
SIZE_TITLE = Pt(22)   # 二号
SIZE_H1 = Pt(14)      # 四号
SIZE_BODY = Pt(12)    # 小四

FIRST_LINE_INDENT = Pt(24)   # 小四 × 2 字符
LINE_SPACING = Pt(28)
LINE_SPACING_RULE = WD_LINE_SPACING.EXACTLY

FONTS_DIR = Path(__file__).resolve().parents[1] / "fonts"


def set_run_font(
    run,
    cn_font: str,
    size: Pt,
    *,
    bold: bool = False,
    latin_font: str = FONT_LATIN,
) -> None:
    """设置 run 的中西文字体（eastAsia + ascii/hAnsi）。"""
    run.font.name = latin_font
    run.font.size = size
    run.bold = bold

    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.get_or_add_rFonts()
    r_fonts.set(qn("w:ascii"), latin_font)
    r_fonts.set(qn("w:hAnsi"), latin_font)
    r_fonts.set(qn("w:eastAsia"), cn_font)
    r_fonts.set(qn("w:cs"), latin_font)


def apply_body_paragraph_format(paragraph) -> None:
    """正文段落：小四宋体、首行缩进 2 字符、固定行距 28 磅。"""
    fmt = paragraph.paragraph_format
    fmt.alignment = WD_PARAGRAPH_ALIGNMENT.LEFT
    fmt.first_line_indent = FIRST_LINE_INDENT
    fmt.left_indent = Pt(0)
    fmt.line_spacing_rule = LINE_SPACING_RULE
    fmt.line_spacing = LINE_SPACING
    fmt.space_before = Pt(0)
    fmt.space_after = Pt(6)


def apply_heading_paragraph_format(paragraph, level: int) -> None:
    """按 Markdown 标题级别设置段落格式（顶格、行距）。"""
    fmt = paragraph.paragraph_format
    fmt.first_line_indent = Pt(0)
    fmt.left_indent = Pt(0)
    fmt.line_spacing_rule = LINE_SPACING_RULE
    fmt.line_spacing = LINE_SPACING

    if level == 1:
        fmt.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
        fmt.space_before = Pt(12)
        fmt.space_after = Pt(12)
    else:
        fmt.alignment = WD_PARAGRAPH_ALIGNMENT.LEFT
        fmt.space_before = Pt(6)
        fmt.space_after = Pt(6)


def heading_font_for_level(level: int) -> tuple[str, Pt]:
    """返回 (中文字体名, 字号)。"""
    if level == 1:
        return FONT_HEITI, SIZE_TITLE
    if level == 2:
        return FONT_SONG, SIZE_H1
    return FONT_SONG, SIZE_BODY


def style_runs_in_paragraph(
    paragraph,
    cn_font: str,
    size: Pt,
    *,
    bold: Optional[bool] = None,
) -> None:
    """统一段落内所有 run 的字体；bold=None 时保留 run 原有加粗状态。"""
    for run in paragraph.runs:
        is_bold = run.bold if bold is None else bold
        set_run_font(run, cn_font, size, bold=bool(is_bold))
