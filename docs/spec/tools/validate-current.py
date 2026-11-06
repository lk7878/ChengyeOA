"""Validate the current specification without reading a database or running business mutations."""
from pathlib import Path
from urllib.parse import unquote
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'docs/spec'
APP = ROOT / 'LayerManage/law-firm-system'
errors = []
files = [p for p in BASE.rglob('*.md') if 'history' not in p.parts and not p.name.startswith('_template')]
files += [ROOT / 'README.md', ROOT / 'docs/专项设计/README.md',
          ROOT / 'docs/superpowers/README.md', APP / 'docs/PRD.md',
          APP / 'docs/CURRENT_SPEC.md', APP / 'docs/DATABASE.md',
          APP / 'docs/API_SPEC.md', APP / 'docs/api-spec.md',
          APP / 'apps/server/docs/api-spec.md', APP / 'docs/DEVELOPMENT.md',
          APP / 'docs/DEPLOY.md', APP / 'docs/visual-approval-guide.md']
files += list((ROOT / 'docs/专项设计').glob('*.md'))
files = sorted(set(files))
links = 0
for p in files:
    text = p.read_text(encoding='utf-8-sig')
    for m in re.finditer(r'\[[^\]\n]+\]\(([^)]+)\)', text):
        target = m.group(1).strip('<>')
        if re.match(r'\w+://', target) or target.startswith('#'):
            continue
        target = unquote(target.split('#')[0])
        if not target:
            continue
        links += 1
        if not (p.parent / target).exists():
            errors.append(f'{p.relative_to(ROOT)}: missing link {target}')
    if re.search(r'postgres(?:ql)?://[^/\s:@]+:[^@\s/]+@', text, re.I):
        errors.append(f'{p.relative_to(ROOT)}: credential-bearing database URL')
    if p.parent.name in ['modules', 'foundations']:
        for required in ['source_commit: dcf8447d', '## 实现与回归入口', '## 历史需求追溯']:
            if required not in text:
                errors.append(f'{p.name}: missing {required}')

schema = (APP / 'apps/server/prisma/schema.prisma').read_text(encoding='utf-8')
models = re.findall(r'^model (\w+) \{', schema, re.M)
snapshot = (BASE / 'reference/DATA-MODELS.md').read_text(encoding='utf-8')
if models != re.findall(r'^## ([A-Za-z][A-Za-z0-9_]*)$', snapshot, re.M):
    errors.append('Model snapshot differs from schema')
router = (APP / 'apps/server/app/router.ts').read_text(encoding='utf-8')
route_count = len(re.findall(r'router\.(?:get|post|put|patch|delete|options|all)\(', router))
api = (BASE / 'reference/HTTP-API.md').read_text(encoding='utf-8')
api_count = len(re.findall(r'^\| (?:GET|POST|PUT|PATCH|DELETE|OPTIONS|ALL) \|', api, re.M))
if route_count != api_count:
    errors.append(f'API count mismatch: {route_count} source calls vs {api_count} exported')
fields = (BASE / 'reference/STANDARD-FIELDS.md').read_text(encoding='utf-8')
field_count = len(re.findall(r'^\| \d+ \|', fields, re.M))
table_count = len(re.findall(r'^## ', fields, re.M))
if (table_count, field_count) != (48, 730):
    errors.append(f'Baseline field count changed: {table_count}/{field_count}; update spec deliberately')
if len(list((BASE / 'modules').glob('MOD-*.md'))) != 13 or len(list((BASE / 'foundations').glob('FTN-*.md'))) != 7:
    errors.append('Expected 13 MOD and 7 FTN specs')

# Historical links are reported separately, never silently interpreted as current evidence.
historical_missing = set()
for p in (BASE / 'history').rglob('*.md'):
    for m in re.finditer(r'\[[^\]\n]+\]\(([^)]+)\)', p.read_text(encoding='utf-8')):
        target = m.group(1).split('#')[0]
        if target and not re.match(r'\w+://', target) and not (p.parent / target).exists():
            historical_missing.add((str(p.relative_to(BASE)), target))

print(json.dumps({'documents_checked': len(files), 'local_links_checked': links,
    'models': len(models), 'routes': api_count, 'template_groups': table_count,
    'fields': field_count, 'historical_missing_links': len(historical_missing),
    'errors': errors}, ensure_ascii=False, indent=2))
sys.exit(1 if errors else 0)
