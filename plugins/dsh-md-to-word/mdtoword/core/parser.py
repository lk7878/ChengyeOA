"""
Markdown解析模块
负责将Markdown文本解析为结构化数据
"""

import mistune
from typing import Dict, List, Any, Union

class MarkdownParser:
    """Markdown解析器，使用mistune将Markdown文本解析为结构化数据"""

    def __init__(self):
        """初始化Markdown解析器"""
        # mistune 2.x API
        self.markdown = mistune.create_markdown(
            renderer=mistune.AstRenderer(),
            plugins=['table', 'strikethrough', 'footnotes', 'task_lists']
        )

    def parse(self, markdown_text: str) -> List[Dict[str, Any]]:
        """
        解析Markdown文本为结构化数据

        Args:
            markdown_text: Markdown文本内容

        Returns:
            解析后的结构化数据列表
        """
        try:
            # 使用mistune解析Markdown为AST
            ast = self.markdown(markdown_text)
            return ast
        except Exception as e:
            # 打印详细错误信息以便调试
            import traceback
            print(f"Markdown解析错误: {str(e)}")
            print(traceback.format_exc())
            raise

    @staticmethod
    def extract_text(token: Dict[str, Any]) -> str:
        """
        从token中提取纯文本内容

        Args:
            token: Markdown AST中的token

        Returns:
            提取的文本内容
        """
        if 'text' in token:
            return token['text']
        
        if 'children' in token:
            return ''.join(MarkdownParser.extract_text(child) 
                          for child in token['children'])
        
        return ''