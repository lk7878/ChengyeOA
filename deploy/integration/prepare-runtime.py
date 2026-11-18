from pathlib import Path
import shutil,json,os,re
root=Path(__file__).resolve().parents[2];bundle=Path(os.environ.get('OA_RUNTIME_BUNDLE_DIR',root/'runtime/bundle'));bundle.mkdir(exist_ok=True)
for name in ['package','plugins','presets']:
 dst=bundle/name
 if dst.exists():shutil.rmtree(dst)
 shutil.copytree(root/name,dst,ignore=shutil.ignore_patterns('node_modules','.git','__pycache__','*.log','*.env','upstream','test','tests'))
 for f in dst.rglob('*'):
  if f.is_file() and f.suffix in ['.yml','.yaml','.mjs','.js','.py','.md']:
   try:s=f.read_text()
   except UnicodeError:continue
   s=s.replace('E:/A','/app').replace('E:\\\\A','/app').replace('pythonPath: python','pythonPath: python3').replace("spawn('python',","spawn('python3',")
   f.write_text(s)
if (bundle/'node_modules').is_symlink():(bundle/'node_modules').unlink()
modules=bundle/'node_modules';modules.mkdir(exist_ok=True)
engine=root/'runtime/upstream/harness'
for f in [*engine.glob('packages/*/*/package.json'),*engine.glob('vendor/*/package.json'),*engine.glob('apps/*/package.json')]:
 name=json.loads(f.read_text()).get('name')
 if not name:continue
 link=modules/name;link.parent.mkdir(parents=True,exist_ok=True)
 if link.is_symlink():link.unlink()
 link.symlink_to('/engine/'+str(f.parent.relative_to(engine)))
for f in (engine/'node_modules').iterdir():
 if not f.name.startswith('@') and not (modules/f.name).exists() and not (modules/f.name).is_symlink():(modules/f.name).symlink_to('/engine/node_modules/'+f.name)
for name in ['dsh-file-convert','dsh-mask']:
 p=bundle/'plugins'/name/'package.json';m=json.loads(p.read_text())
 for dep in m.get('peerDependencies',{}):
  if dep.startswith('@deepseek-ai/dsh-'):m['peerDependencies'][dep]='0.2.2-rc.3'
 p.write_text(json.dumps(m,indent=2))
profile=bundle/'profile';profile.mkdir(exist_ok=True)
plugins=['oa-legal-presets','dsh-file-convert','dsh-md-to-word','dsh-free-web-search','dsh-mask','dsh-docx-preview','dsh-case-open','dsh-baiyou-brand']
manifest={'name':'oa-task-runtime','private':True,'dependencies':{x:'link:/app/plugins/'+x for x in plugins},'dsh':{'profile':{'bundles':['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app',*plugins]}}}
(profile/'package.json').write_text(json.dumps(manifest,indent=2))
mods=profile/'node_modules';mods.mkdir(exist_ok=True)
for name in plugins:
 p=mods/name
 if p.is_symlink():p.unlink()
 p.symlink_to('/app/plugins/'+name)
(profile/'cordis.patch.yml').write_text('''- id: locale
  config:
    preference: zh
- id: workspace-files
  config:
    maxFileBytes: 134217728
- id: agent-preset-registry
  config:
    default: general-legal
- id: dsh-file-convert
  config:
    outputRoots: [/workspace/drafts, /workspace/reports]
- id: dsh-md-to-word
  config:
    pythonPath: python3
    outputRoots: [/workspace/drafts, /workspace/reports]
''')
print('Prepared isolated runtime bundle; no data or credentials copied')

# Latest Harness uses declaration bundles rather than scanning preset directories.
preset=bundle/'plugins/oa-legal-presets';preset.mkdir(exist_ok=True)
(preset/'package.json').write_text(json.dumps({'name':'oa-legal-presets','version':'1.0.0','private':True,'type':'module','dsh':{'bundle':{'patch':'./cordis.patch.yml'}}}))
patch='- insert:\n'
for id in ['general-legal','injury','medical-review','traffic-accident']:
 source=(bundle/'package'/id/'agent.cordis.yml').read_text()
 source=re.sub(r'name: (\.\.?/[^\n]+)',lambda m:'name: '+os.path.normpath('/app/package/'+id+'/'+m.group(1)),source)
 source=re.sub(r'    - id: tool-subagent-list-agents\n      name: [^\n]+\n','',source)
 source=source.replace('@deepseek-ai/dsh-workflow-worker-thread','@deepseek-ai/dsh-workflow-ptc')
 source=source.replace('baseUrl: https://api.openai-proxy.org/v1','baseUrl: http://127.0.0.1:8090/ocr/v1').replace('baseUrl: https://api.openai-proxy.org','baseUrl: http://127.0.0.1:8090/clinical')
 source=source.replace('【模型协同】主会话默认 closeai/qwen3.8-flash。','【模型协同】主会话使用管理员配置的默认模型。')
 source=source.replace('百佑智业','承业智慧办案').replace('{{cwd}}','/workspace')
 patch+='    - id: preset-'+id+'\n      name: "@deepseek-ai/dsh-agent-preset"\n      config:\n        id: '+id+'\n        name: '+id+'\n        plugins:\n'+''.join('          '+line+'\n' for line in source.splitlines())
(preset/'cordis.patch.yml').write_text(patch)

# Additional converter dependencies are installed from the deployment lock, separate from Harness.
for f in (root/'runtime/plugin-deps/node_modules').iterdir():
 if f.name.startswith('.') or f.name=='@deepseek-ai':continue
 link=modules/f.name
 if link.is_symlink():link.unlink()
 if not link.exists():link.symlink_to('/deps/node_modules/'+f.name)
# Search settings are deployment-owned; remove the retired mutable settings bridge.
search=bundle/'plugins/dsh-free-web-search/lib'
f=search/'constants.js';text=f.read_text();text=text.replace("import { settingsNamespace } from '@deepseek-ai/dsh-settings';",'').replace("settingsNamespace('free-search')","'free-search'");f.write_text(text)
f=search/'index.js';text=f.read_text();text=re.sub(r"import \{ installSettingsSection \}[^\n]+\n",'',text);text=re.sub(r"import \{ makeBridgeRoutes \}[^\n]+\n",'',text)
start=text.index('    installSettingsSection(');end=text.index('    ctxAny.web.registerSearchProvider',start);text=text[:start]+text[end:];f.write_text(text)

shutil.copy2(root/'deploy/integration/task-bridge.mjs',bundle/'task-bridge.mjs')

f=bundle/'package/record-parse/parse-records.mjs';text=f.read_text();text=re.sub(r"const CLOSE_BASE = '[^']+'", "const CLOSE_BASE = 'http://127.0.0.1:8090/ocr/v1'",text);text=re.sub(r"const ALIYUN_BASE = '[^']+'", "const ALIYUN_BASE = 'http://127.0.0.1:8090/ocr/v1'",text);f.write_text(text)

# Brand initial HTML before any upstream JavaScript or plugins execute.
import subprocess
subprocess.run([os.environ.get("NODE_BINARY", "node"), str(root/"deploy/integration/brand-entrypoints.mjs"), str(root)], check=True)
