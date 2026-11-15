#!/usr/bin/env python3
"""Install current-user units; never embeds credentials in unit files."""
import os,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[2]
node=Path(os.environ.get('NODE22','/opt/oa-system/toolchain/node/bin/node'))
units=Path.home()/'.config/systemd/user';units.mkdir(parents=True,exist_ok=True)
commands={'oa-smart-knowledge':f'/usr/bin/python3 "{root}/deploy/integration/start-weknora.py"','oa-smart-case':f'"{node}" "{root}/case-service/src/index.js"','oa-smart-workbench':f'"{node}" "{root}/deploy/integration/serve-workbench.mjs"'}
for name,command in commands.items():
 (units/(name+'.service')).write_text(f'''[Unit]
Description=OA smart case {name}
After=network.target
[Service]
WorkingDirectory={root}
Environment="GATEWAY_ENV={root}/data/integration/service.env"
ExecStart={command}
Restart=on-failure
RestartSec=3
TimeoutStopSec=45
KillMode=control-group
UMask=0077
[Install]
WantedBy=default.target
''')
subprocess.run(['systemctl','--user','daemon-reload'],check=True)
subprocess.run(['systemctl','--user','enable',*commands],check=True)
print('Installed three user service units; start after stopping previous instances.')
