"""
MD to Word - 将Markdown文件转换为Word文档

用法示例:
    from mdtoword import convert
    convert("input.md", "output.docx")
"""

from .core.converter import convert
from .core.utils import flatten_markdown_tables

__version__ = "0.1.1"
__all__ = ["convert", "flatten_markdown_tables"]