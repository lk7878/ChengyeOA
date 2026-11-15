"""
命令行接口
提供命令行方式调用MD转Word功能
"""

import argparse
import sys
import os
from typing import Dict, Any, List, Optional

from mdtoword.core.converter import convert

def parse_args(args: Optional[List[str]] = None) -> argparse.Namespace:
    """
    解析命令行参数

    Args:
        args: 命令行参数列表，默认为None（使用sys.argv）

    Returns:
        解析后的参数
    """
    parser = argparse.ArgumentParser(
        description='将Markdown文件转换为Word文档',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    
    parser.add_argument(
        'input_file',
        help='输入的Markdown文件路径'
    )
    
    parser.add_argument(
        '-o', '--output',
        dest='output_file',
        help='输出的Word文档路径，默认为与输入文件同名但扩展名为.docx'
    )
    
    parser.add_argument(
        '-t', '--template',
        dest='template_path',
        help='Word文档模板路径（可选）'
    )
    
    parser.add_argument(
        '--title',
        help='文档标题（可选）'
    )
    
    parser.add_argument(
        '--author',
        help='文档作者（可选）'
    )
    
    parser.add_argument(
        '--subject',
        help='文档主题（可选）'
    )
    
    parser.add_argument(
        '--keywords',
        help='文档关键词，逗号分隔（可选）'
    )
    
    parsed_args = parser.parse_args(args)
    
    # 如果未指定输出文件，则使用输入文件名（更改扩展名为.docx）
    if not parsed_args.output_file:
        input_base, _ = os.path.splitext(parsed_args.input_file)
        parsed_args.output_file = f"{input_base}.docx"
    
    return parsed_args

def main(args: Optional[List[str]] = None) -> int:
    """
    主函数

    Args:
        args: 命令行参数列表，默认为None（使用sys.argv）

    Returns:
        退出码，0表示成功，非0表示失败
    """
    parsed_args = parse_args(args)
    
    # 收集元数据
    metadata: Dict[str, Any] = {}
    if parsed_args.title:
        metadata['title'] = parsed_args.title
    if parsed_args.author:
        metadata['author'] = parsed_args.author
    if parsed_args.subject:
        metadata['subject'] = parsed_args.subject
    if parsed_args.keywords:
        metadata['keywords'] = parsed_args.keywords
    
    # 执行转换
    success = convert(
        parsed_args.input_file,
        parsed_args.output_file,
        parsed_args.template_path,
        metadata
    )
    
    return 0 if success else 1

if __name__ == '__main__':
    sys.exit(main())