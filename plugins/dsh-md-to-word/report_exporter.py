#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
报告导出工具类 - 支持 Word 和 PDF 导出
使用本地 mdtoword 模块进行 Word 导出
"""
from __future__ import annotations

import os
import re
import logging
import tempfile
from pathlib import Path
from datetime import datetime

# Word 导出 - 使用本地 mdtoword 模块
from .mdtoword import convert as mdtoword_convert
from .mdtoword.core.utils import flatten_markdown_tables

# PDF 导出相关
try:
    import markdown
    from bs4 import BeautifulSoup
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
    from reportlab.lib.colors import HexColor
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

logger = logging.getLogger(__name__)


class ReportExporter:
    """报告导出核心类"""

    @staticmethod
    def _sanitize_markdown(md_content: str) -> str:
        """导出前清理 Markdown，避免隐藏字符导致的格式错乱。"""
        if not isinstance(md_content, str):
            return ""

        cleaned = flatten_markdown_tables(
            md_content.replace("\ufeff", "")
            .replace("\u200b", "")
            .replace("\u200c", "")
            .replace("\u200d", "")
            .replace("\u2060", "")
            .replace("\xa0", " ")
        )

        lines = cleaned.splitlines()
        out = []
        blank_count = 0
        for line in lines:
            current = line.rstrip()
            if not current:
                blank_count += 1
                if blank_count <= 1:
                    out.append("")
                continue
            blank_count = 0
            out.append(current)
        return "\n".join(out).strip() + "\n"

    @staticmethod
    def _add_title_divider(md_content: str) -> str:
        """在一级标题「# 病历分析报告」下方插入分割线（Word 导出排版）。"""
        lines = md_content.splitlines()
        result: list[str] = []
        divider = "---"

        for idx, line in enumerate(lines):
            result.append(line)
            if not re.match(r"^#\s*病历分析报告\s*$", line):
                continue
            nxt = lines[idx + 1].strip() if idx + 1 < len(lines) else ""
            if nxt in (divider, "___", "***"):
                continue
            result.append(divider)

        return "\n".join(result)

    @staticmethod
    def export_to_word(md_content: str, title: str, output_path: Path) -> Path:
        """
        将 Markdown 转换为 Word 文档
        
        使用本地 mdtoword 模块进行转换
        
        Args:
            md_content: Markdown 内容
            title: 文档标题
            output_path: 输出文件路径
            
        Returns:
            输出文件路径
            
        Raises:
            Exception: 转换失败时抛出异常
        """
        logger.info("使用 mdtoword 库导出 Word...")
        
        # 创建临时 Markdown 文件
        tmp_md_path = None
        try:
            safe_md = ReportExporter._add_title_divider(
                ReportExporter._sanitize_markdown(md_content)
            )
            with tempfile.NamedTemporaryFile(
                mode='w',
                encoding='utf-8',
                suffix='.md',
                delete=False
            ) as tmp_md:
                # 直接使用报告原文，不额外插入导出文件名作为标题
                tmp_md.write(safe_md)
                tmp_md_path = tmp_md.name
            
            # 准备元数据
            metadata = {
                'title': title,
                'author': '百佑智鉴',
                'subject': '医疗病历审查报告',
                'keywords': '医疗,审查,鉴定',
                'comments': f'自动生成于 {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}'
            }
            
            # 使用 mdtoword.convert() 进行转换
            # convert(input_file, output_file, template_path=None, metadata=None)
            success = mdtoword_convert(
                tmp_md_path,
                str(output_path),
                metadata=metadata
            )
            
            if success:
                logger.info(f"✅ Word 导出成功: {output_path}")
                return output_path
            else:
                error_msg = f"mdtoword 转换返回失败: {output_path}"
                logger.error(error_msg)
                raise Exception(error_msg)
        
        except Exception as e:
            logger.error(f"❌ Word 导出失败: {e}", exc_info=True)
            raise Exception(f"Word 导出失败: {str(e)}")
        
        finally:
            # 清理临时文件
            if tmp_md_path and os.path.exists(tmp_md_path):
                try:
                    os.unlink(tmp_md_path)
                    logger.debug(f"已清理临时文件: {tmp_md_path}")
                except Exception as e:
                    logger.warning(f"清理临时文件失败: {e}")

    @staticmethod
    def _setup_pdf_fonts():
        """注册 PDF 字体：优先使用 mdtoword/fonts 内置字体，与 Word 导出规范一致。"""
        if not PDF_AVAILABLE:
            return {"song": "Helvetica", "heiti": "Helvetica", "latin": "Helvetica"}

        fonts_dir = Path(__file__).resolve().parent / "mdtoword" / "fonts"
        candidates = {
            "song": [
                fonts_dir / "SIMSUN.TTC",
                fonts_dir / "simsun.ttc",
                "C:/Windows/Fonts/simsun.ttc",
            ],
            "heiti": [
                fonts_dir / "SIMHEI.TTF",
                fonts_dir / "simhei.ttf",
                "C:/Windows/Fonts/simhei.ttf",
            ],
            "latin": [
                "C:/Windows/Fonts/times.ttf",
                "C:/Windows/Fonts/timesbd.ttf",
            ],
        }
        registered = {}
        for key, paths in candidates.items():
            reg_name = f"Report{key.capitalize()}"
            for path in paths:
                p = Path(path)
                if p.exists():
                    try:
                        pdfmetrics.registerFont(TTFont(reg_name, str(p)))
                        registered[key] = reg_name
                        logger.debug(f"PDF 字体注册成功 [{key}]: {p}")
                        break
                    except Exception as e:
                        logger.debug(f"PDF 字体注册失败 {p}: {e}")
            if key not in registered:
                registered[key] = "Helvetica"
                logger.warning(f"PDF 字体未找到 [{key}]，回退 Helvetica")

        return registered

    @staticmethod
    def export_to_pdf(md_content: str, title: str, output_path: Path) -> Path:
        """
        将 Markdown 转换为 PDF
        
        Args:
            md_content: Markdown 内容
            title: 文档标题
            output_path: 输出文件路径
            
        Returns:
            输出文件路径
            
        Raises:
            ImportError: 缺少必要的库
            Exception: 转换失败时抛出异常
        """
        if not PDF_AVAILABLE:
            raise ImportError(
                "PDF 导出功能不可用！请安装必要的库：\n"
                "  pip install reportlab markdown beautifulsoup4"
            )
        
        logger.info("使用 reportlab 库导出 PDF...")
        
        try:
            fonts = ReportExporter._setup_pdf_fonts()
            song = fonts["song"]
            heiti = fonts["heiti"]

            doc = SimpleDocTemplate(
                str(output_path),
                pagesize=A4,
                margin=2 * cm,
                title=title,
                author="百佑智鉴",
            )

            # 与 Word 导出一致的公文排版
            pdf_styles = {
                "title": ParagraphStyle(
                    "PdfTitle",
                    fontName=heiti,
                    fontSize=22,
                    leading=33,
                    alignment=TA_CENTER,
                    spaceBefore=12,
                    spaceAfter=12,
                    textColor=HexColor("#000000"),
                ),
                "h1": ParagraphStyle(
                    "PdfH1",
                    fontName=song,
                    fontSize=14,
                    leading=21,
                    alignment=TA_LEFT,
                    spaceBefore=6,
                    spaceAfter=6,
                    textColor=HexColor("#000000"),
                ),
                "h2_plus": ParagraphStyle(
                    "PdfH2Plus",
                    fontName=song,
                    fontSize=12,
                    leading=18,
                    alignment=TA_LEFT,
                    spaceBefore=6,
                    spaceAfter=6,
                    textColor=HexColor("#000000"),
                ),
                "body": ParagraphStyle(
                    "PdfBody",
                    fontName=song,
                    fontSize=12,
                    leading=18,
                    alignment=TA_JUSTIFY,
                    firstLineIndent=24,
                    spaceAfter=6,
                    textColor=HexColor("#000000"),
                ),
                "list": ParagraphStyle(
                    "PdfList",
                    fontName=song,
                    fontSize=12,
                    leading=18,
                    alignment=TA_LEFT,
                    leftIndent=18,
                    spaceAfter=6,
                    textColor=HexColor("#000000"),
                ),
            }
            
            # 转换 Markdown 为 HTML
            html = markdown.markdown(
                ReportExporter._sanitize_markdown(md_content),
                extensions=['fenced_code', 'nl2br']
            )
            soup = BeautifulSoup(html, 'html.parser')
            
            # 构建 PDF 内容（标题已在 Markdown 正文中，不再重复插入导出文件名）
            story = []

            # 渲染元素
            container = soup.body if soup.body else soup
            for element in container.contents:
                if element.name:
                    ReportExporter._render_pdf_element(
                        story,
                        element,
                        pdf_styles,
                        depth=0,
                    )
            
            # 生成 PDF
            doc.build(story)
            logger.info(f"✅ PDF 导出成功: {output_path}")
            return output_path
        
        except Exception as e:
            logger.error(f"❌ PDF 导出失败: {e}", exc_info=True)
            raise Exception(f"PDF 导出失败: {str(e)}")

    @staticmethod
    def _pdf_heading_style(tag_name: str, styles: dict) -> ParagraphStyle:
        """Markdown 标题 -> PDF 样式：h1 二号黑体居中；h2 四号宋体；h3+ 小四宋体。"""
        if tag_name == "h1":
            return styles["title"]
        if tag_name == "h2":
            return styles["h1"]
        return styles["h2_plus"]

    @staticmethod
    def _render_pdf_element(story, element, styles, depth=0):
        """递归渲染 PDF 元素"""
        if element.name in ["h1", "h2", "h3", "h4", "h5", "h6"]:
            text = element.get_text().strip()
            if text:
                style = ReportExporter._pdf_heading_style(element.name, styles)
                story.append(Paragraph(f"<b>{text}</b>", style))

        elif element.name == "p":
            inner = ReportExporter._get_clean_html(element)
            if inner.strip():
                story.append(Paragraph(inner, styles["body"]))

        elif element.name in ["ul", "ol"]:
            is_ordered = element.name == "ol"
            for idx, li in enumerate(element.find_all("li", recursive=False), 1):
                prefix = f"{idx}. " if is_ordered else "• "
                inner_text = ""
                for child in li.contents:
                    if isinstance(child, str):
                        inner_text += str(child).strip()
                    elif child.name == "p":
                        inner_text += ReportExporter._get_clean_html(child)
                list_style = ParagraphStyle(
                    f"List_{depth}",
                    parent=styles["list"],
                    leftIndent=15 * (depth + 1),
                )
                if inner_text.strip():
                    story.append(Paragraph(f"{prefix}{inner_text}", list_style))
                for sub in li.find_all(["ul", "ol"], recursive=False):
                    ReportExporter._render_pdf_element(story, sub, styles, depth + 1)

        elif element.name == "table":
            rows = element.find_all("tr")
            headers = []
            body = []
            for idx, row in enumerate(rows):
                cells = [cell.get_text().strip() for cell in row.find_all(["td", "th"])]
                if idx == 0:
                    headers = cells
                else:
                    body.append(cells)
            items = body or [headers]
            labels = headers if body else []
            for ridx, row in enumerate(items, 1):
                parts = []
                for cidx, cell in enumerate(row):
                    if not cell:
                        continue
                    label = labels[cidx] if cidx < len(labels) and labels[cidx] else f"第{cidx + 1}项"
                    parts.append(f"{label}：{cell}" if labels else cell)
                if parts:
                    story.append(Paragraph(f"{ridx}. " + "；".join(parts) + "。", styles["list"]))
            story.append(Spacer(1, 0.2 * cm))

        elif element.name == "hr":
            story.append(Spacer(1, 0.5 * cm))

        if element.name in ["p", "h1", "h2", "h3", "h4", "h5", "h6"]:
            story.append(Spacer(1, 0.15 * cm))

    @staticmethod
    def _get_clean_html(element):
        """将 HTML 标签转换为 PDF 支持的格式"""
        inner = "".join([str(c) for c in element.contents]).strip()
        
        # 转换标签
        replacements = {
            '<strong>': '<b>',
            '</strong>': '</b>',
            '<em>': '<i>',
            '</em>': '</i>',
            '<br>': '<br/>',
            '<br/>': '<br/>',
        }
        
        for old, new in replacements.items():
            inner = inner.replace(old, new)
        
        return inner
