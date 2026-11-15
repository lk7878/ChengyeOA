"""
工具函数模块
提供文件处理、路径处理等辅助功能
"""

import os
import re
from typing import List, Optional, Tuple

_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{3,}")


def _split_table_row(line: str) -> List[str]:
    raw = line.strip()
    if raw.startswith("|"):
        raw = raw[1:]
    if raw.endswith("|"):
        raw = raw[:-1]
    return [cell.strip() for cell in raw.split("|")]


def flatten_markdown_tables(markdown_text: str) -> str:
    """把 Markdown 表格摊成编号段落，医疗报告 Word 中不保留表格。"""
    lines = str(markdown_text or "").replace("\r\n", "\n").split("\n")
    out: List[str] = []
    i = 0
    while i < len(lines):
        if (
            i + 1 < len(lines)
            and _TABLE_ROW_RE.match(lines[i] or "")
            and _TABLE_SEP_RE.match(lines[i + 1] or "")
        ):
            header = _split_table_row(lines[i])
            i += 2
            rows: List[List[str]] = []
            while i < len(lines) and _TABLE_ROW_RE.match(lines[i] or ""):
                rows.append(_split_table_row(lines[i]))
                i += 1
            if not rows:
                for col, name in enumerate(header, 1):
                    if name:
                        out.append(f"{col}. {name}")
                continue
            for ridx, row in enumerate(rows, 1):
                parts = []
                for cidx, cell in enumerate(row):
                    if not cell:
                        continue
                    label = header[cidx] if cidx < len(header) and header[cidx] else f"第{cidx + 1}项"
                    parts.append(f"{label}：{cell}")
                if parts:
                    out.append(f"{ridx}. " + "；".join(parts) + "。")
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)

def ensure_file_exists(filepath: str) -> bool:
    """
    确保文件存在

    Args:
        filepath: 文件路径

    Returns:
        文件是否存在
    """
    return os.path.isfile(filepath)

def ensure_dir_exists(directory: str) -> None:
    """
    确保目录存在，如果不存在则创建

    Args:
        directory: 目录路径
    """
    if not os.path.exists(directory):
        os.makedirs(directory)

def get_file_extension(filepath: str) -> str:
    """
    获取文件扩展名（不含点号）

    Args:
        filepath: 文件路径

    Returns:
        文件扩展名
    """
    return os.path.splitext(filepath)[1][1:].lower()

def validate_input_file(input_file: str) -> Tuple[bool, Optional[str]]:
    """
    验证输入文件是否有效

    Args:
        input_file: 输入文件路径

    Returns:
        (是否有效, 错误信息)
    """
    if not ensure_file_exists(input_file):
        return False, f"输入文件不存在: {input_file}"
    
    ext = get_file_extension(input_file)
    if ext != 'md':
        return False, f"输入文件不是Markdown文件（.md）: {input_file}"
    
    return True, None

def validate_output_file(output_file: str) -> Tuple[bool, Optional[str]]:
    """
    验证输出文件是否有效

    Args:
        output_file: 输出文件路径

    Returns:
        (是否有效, 错误信息)
    """
    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        try:
            ensure_dir_exists(output_dir)
        except Exception as e:
            return False, f"无法创建输出目录: {output_dir}，错误: {str(e)}"
    
    ext = get_file_extension(output_file)
    if ext != 'docx':
        return False, f"输出文件不是Word文档（.docx）: {output_file}"
    
    return True, None

def resolve_path(path: str) -> str:
    """
    解析路径，将相对路径转换为绝对路径

    Args:
        path: 文件路径

    Returns:
        绝对路径
    """
    if os.path.isabs(path):
        return path
    return os.path.abspath(path)

def get_image_dimensions(image_path: str) -> Tuple[Optional[int], Optional[int]]:
    """
    获取图片尺寸

    Args:
        image_path: 图片路径

    Returns:
        (宽度, 高度)，如果无法读取则返回(None, None)
    """
    try:
        from PIL import Image
        with Image.open(image_path) as img:
            return img.width, img.height
    except Exception:
        return None, None