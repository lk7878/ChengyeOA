#!/usr/bin/env python3
"""Private native knowledge backend; original data/config are not rewritten."""
import os
from pathlib import Path
root=Path(__file__).resolve().parents[2]
env=dict(os.environ)
for line in (root/'WeKnora/.env.lite').read_text().splitlines():
 if not line.strip() or line.lstrip().startswith('#') or '=' not in line:continue
 key,value=line.split('=',1);env.setdefault(key.strip(),value.strip().strip('\"\''))
data=Path(env.get('SMART_CASE_KNOWLEDGE_DATA',str(root/'data/integration/weknora')));data.mkdir(parents=True,exist_ok=True,mode=0o700)
env.update(DB_DRIVER='sqlite',DB_PATH=str(data/'weknora.db'),RETRIEVE_DRIVER='sqlite',STORAGE_TYPE='local',LOCAL_STORAGE_BASE_DIR=str(data/'files'),STREAM_MANAGER_TYPE='memory',GIN_MODE='release',LOG_LEVEL='warn')
os.chdir(root/'WeKnora')
os.execve(root/'runtime/weknora-lite',[str(root/'runtime/weknora-lite')],env)
