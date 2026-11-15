#!/usr/bin/env python3
"""Runs retained document tools on synthetic inputs inside the task mounts."""
import subprocess,tempfile,os
from pathlib import Path
root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='oa-tools-') as work:
 Path(work,'reports').mkdir();Path(work,'materials').mkdir()
 Path(work,'draft.md').write_text('# 合成验收报告\n\n此处仅有虚构测试内容，不含案件信息。\n\n## 材料来源\n\n- 合成材料第 1 页。\n')
 args=['bwrap','--unshare-all','--die-with-parent','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp']
 for src,dst in [('runtime/bundle','/app'),('runtime/plugin-deps','/deps'),('runtime/upstream/harness','/engine'),('runtime/node24','/runtime'),('runtime/python-deps','/pydeps')]:args+=['--ro-bind',str(root/src),dst]
 args+=['--bind',work,'/workspace','--clearenv','--setenv','PATH','/runtime/bin:/usr/bin:/bin','--setenv','PYTHONPATH','/pydeps','--setenv','LANG','C.UTF-8','--chdir','/workspace']
 subprocess.run(args+['python3','/app/plugins/dsh-md-to-word/export_cli.py','--input','draft.md','--output','reports/验收.docx','--author','承业智慧办案'],check=True)
 subprocess.run(args+['python3','/app/package/record-parse/worker.py','--help'],check=True,stdout=subprocess.DEVNULL)
 subprocess.run(args+['python3','-c',"from docx import Document;import fitz;d=Document('reports/验收.docx');assert any('合成' in p.text for p in d.paragraphs);p=fitz.open();page=p.new_page();page.insert_text((50,50),'Synthetic integration input');p.save('materials/synthetic.pdf');assert 'Synthetic' in fitz.open('materials/synthetic.pdf')[0].get_text();print('DOCX export/read and PDF parser dependencies passed in network-isolated runtime')"],check=True)
