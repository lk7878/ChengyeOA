"""
Markdown转Word转换器
提供将Markdown文件转换为Word文档的核心功能
"""

import os
from typing import Optional, Dict, Any

from .parser import MarkdownParser
from .renderer import DocxRenderer
from .utils import (
    flatten_markdown_tables,
    validate_input_file,
    validate_output_file,
    resolve_path,
)

def convert(
    input_file: str, 
    output_file: str, 
    template_path: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """
    将Markdown文件转换为Word文档

    Args:
        input_file: Markdown文件路径
        output_file: 输出Word文档路径
        template_path: Word模板路径（可选）
        metadata: 文档元数据（可选）

    Returns:
        是否转换成功
    """
    # 验证输入文件
    input_file = resolve_path(input_file)
    is_valid, error_msg = validate_input_file(input_file)
    if not is_valid:
        print(f"错误: {error_msg}")
        return False

    # 验证输出文件
    output_file = resolve_path(output_file)
    is_valid, error_msg = validate_output_file(output_file)
    if not is_valid:
        print(f"错误: {error_msg}")
        return False

    # 读取Markdown文件内容
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            markdown_text = flatten_markdown_tables(f.read())
    except Exception as e:
        print(f"读取Markdown文件失败: {str(e)}")
        return False

    # 解析Markdown
    try:
        parser = MarkdownParser()
        ast = parser.parse(markdown_text)
    except Exception as e:
        print(f"解析Markdown失败: {str(e)}")
        return False

    # 渲染Word文档
    try:
        source_dir = os.path.dirname(input_file)
        renderer = DocxRenderer(
            template_path,
            asset_dirs=[source_dir, os.path.dirname(source_dir)],
        )
        document = renderer.render(ast)
        
        # 添加元数据
        if metadata:
            # 设置文档属性
            core_properties = document.core_properties
            if 'title' in metadata:
                core_properties.title = metadata['title']
            if 'author' in metadata:
                core_properties.author = metadata['author']
            if 'subject' in metadata:
                core_properties.subject = metadata['subject']
            if 'keywords' in metadata:
                core_properties.keywords = metadata['keywords']
            if 'comments' in metadata:
                core_properties.comments = metadata['comments']
        
        # 保存文档
        document.save(output_file)
    except Exception as e:
        print(f"生成Word文档失败: {str(e)}")
        return False

    print(f"转换完成: {input_file} -> {output_file}")
    return True