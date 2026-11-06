/** Read-only source snapshot. Run with the application's installed tsx; no database connection. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { businessFields } from '../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table';
import { domainSources } from '../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-domain-source';
import { inventoryFields, inventoryKinds, inventoryNames } from '../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets';
import { lifecycleFields, lifecycleKinds } from '../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/lifecycle-worksheet';
import { followSupportFields, followSupportKinds, followSupportNames } from '../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/follow-support-templates';
import { lawyerProspectFields, lawyerProspectTemplate } from '../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/lawyer-prospect-template';
import { PERMISSION_CATALOG } from '../../../LayerManage/law-firm-system/apps/server/app/domain/authorization/permission-catalog';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const app = 'LayerManage/law-firm-system/';
const out = path.join(root, 'docs/spec/reference');
const checkOnly = process.argv.includes('--check');
if (!checkOnly) fs.mkdirSync(out, { recursive: true });
const read = (p: string) => fs.readFileSync(path.join(root, app, p), 'utf8');
const escape = (v: unknown) => String(v ?? '—').replaceAll('|', '\\|').replaceAll('\n', '<br>');
const table = (headers: string[], rows: unknown[][]) => '\n| ' + headers.join(' | ') + ' |\n|' + headers.map(() => '---').join('|') + '|\n' + rows.map(r => '| ' + r.map(escape).join(' | ') + ' |').join('\n') + '\n';
const source = (p: string) => `[源码](../../../${app}${p})`;
function write(name: string, title: string, body: string) {
  const file = path.join(out, name + '.md');
  const content = `# ${title}\n\n> 2026-11-06 实现基线：dcf8447d。由 [export-current.ts](../tools/export-current.ts) 从源码生成；不是生产数据库数据或本轮测试报告。\n\n${body}`.trimEnd() + '\n';
  if (checkOnly) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n') !== content)
      throw new Error(`Source snapshot differs: ${name}`);
  } else fs.writeFileSync(file, content, 'utf8');
}

let fields = '以下是代码内标准字段模板；已有表可以保留自定义字段、归档字段及本地配置。必填列来自模板元数据，业务创建服务可能另有必填、状态和跨字段校验。字段可编辑性由接口 capabilities、行状态及授权共同决定，不能仅凭字段类型判断。options 列保留来源键、选择项、精度、日期和只读提示，不能把 FORMULA 类型一概理解为任意公式编辑器。\n';
let fieldCount = 0, groupCount = 0;
function fieldGroup(code: string, name: string, values: any[], location: string) {
  groupCount++; fieldCount += values.length;
  fields += `\n## ${code} — ${name}\n\n${source(location)}；${values.length} 个标准字段。\n`;
  fields += table(['顺序', '字段', '类型', '模板必填', '选项与来源规则'], values.map((f, i) => [i + 1, f.name, f.type, f.required ? '是' : '否', JSON.stringify(f.options ?? {})]));
}
for (const code of ['LEADS', 'FOLLOWS', ...Object.keys(domainSources)]) fieldGroup(code, code, businessFields(code), 'apps/server/app/application/crm/workspace-business-table.ts');
for (const code of inventoryKinds) fieldGroup(code, inventoryNames[code], inventoryFields(code), 'apps/server/app/application/collaboration/inventory-worksheets.ts');
for (const code of lifecycleKinds) fieldGroup(code, code === 'AFTER_SALES' ? '售后管理表' : '退费管理表', lifecycleFields(code), 'apps/server/app/application/collaboration/lifecycle-worksheet.ts');
for (const code of followSupportKinds) fieldGroup(code, followSupportNames[code], followSupportFields(code), 'apps/server/app/application/collaboration/follow-support-templates.ts');
fieldGroup(lawyerProspectTemplate, '律师客资表', lawyerProspectFields(), 'apps/server/app/application/collaboration/lawyer-prospect-template.ts');
write('STANDARD-FIELDS', '标准工作表字段清单', `共 ${groupCount} 组、${fieldCount} 个字段定义（跨表同名字段分别计数）。\n\n` + fields);

const schema = read('apps/server/prisma/schema.prisma');
const models = [...schema.matchAll(/^model (\w+) \{\r?\n([\s\S]*?)^\}/gm)];
const migrations = fs.readdirSync(path.join(root, app, 'apps/server/prisma/migrations'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
let modelText = `唯一权威 schema：${source('apps/server/prisma/schema.prisma')}。${models.length} 个模型，${migrations.length} 个迁移目录；目录存在不等于目标数据库已应用。下列字段包含 Prisma 关系字段，关系字段不等于数据库实体列。String 状态的全部合法值须继续核对对应领域服务。\n`;
for (const [, name, body] of models) {
  modelText += `\n## ${name}\n\n数据库表：\`${/@@map\("([^"]+)"\)/.exec(body)?.[1] ?? name}\`。\n`;
  modelText += table(['字段或约束', '类型/定义'], body.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('//')).map(l => { const i = l.indexOf(' '); return i < 0 ? [l, '—'] : [l.slice(0, i), l.slice(i + 1).trim()]; }));
}
modelText += '\n## 迁移顺序\n\n' + migrations.map(n => '- `' + n + '`').join('\n');
write('DATA-MODELS', '数据模型与迁移清单', modelText);

const router = read('apps/server/app/router.ts');
const routes = [...router.matchAll(/router\.(get|post|put|patch|delete|options|all)\(\s*(['"])(.*?)\2\s*,([\s\S]*?)\);/g)];
write('HTTP-API', 'HTTP 接口注册清单', `来源：${source('apps/server/app/router.ts')}。共 ${routes.length} 个静态路由注册；所有权限仍须核对 controller/service，路由未显式挂 requirePermission 不等于匿名访问。退役接口返回410，不作为现行写入入口。\n` + table(['方法', '路径', '控制器', '路由级约束（另有服务校验）', '状态'], routes.map(([, method, , url, tail]) => [method.toUpperCase(), url, /controller\.\w+\.\w+/.exec(tail)?.[0] ?? tail.trim(), [...tail.matchAll(/require\w+\([^)]*\)/g)].map(m => m[0]).join('; ') || '见认证中间件/控制器/服务', tail.includes('.retired') ? '退役 410' : '已注册'])));

const require = createRequire(path.join(root, app, 'apps/server/package.json'));
const ts = require('typescript');
const nav = read('apps/web/src/features/navigation/catalog.ts').replace(/^import .*;\r?\n/gm, '');
const context = { exports: {} as any };
vm.runInNewContext(ts.transpileModule(nav, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
write('NAVIGATION', '页面导航与菜单权限', `来源：${source('apps/web/src/features/navigation/catalog.ts')}。下列为目录注册（含隐藏详情入口），最终路由挂载见 ${source('apps/web/src/App.tsx')}；隐藏不等于无权限可直接访问。共享配置不替代服务端数据权限。\n` + table(['区域', '分组', '名称', '路由', '要求', '特殊标记'], context.exports.entries.map((e: any) => [e.area, e.group, e.title, e.path, JSON.stringify({ required: e.required ?? [], anyOf: e.anyOf ?? [] }), [e.hidden && '隐藏', e.superAdminOnly && '仅超管', e.global && '全局'].filter(Boolean).join('、') || '—'])) + '\n## 旧路径重定向\n' + table(['旧路径', '现入口'], Object.entries(context.exports.legacyRedirects)));
write('PERMISSIONS', '权限代码与动作清单', `来源：${source('apps/server/app/domain/authorization/permission-catalog.ts')}。共 ${PERMISSION_CATALOG.length} 项。权限目录存在不等于所有账号已经获授，也不等于一个菜单动作覆盖该模块全部字段和记录。数据范围与临时授权有效期另行校验。\n` + table(['权限代码', '显示名称', '类型', '资源', '动作', '风险', '关联路由'], PERMISSION_CATALOG.map(p => [p.code, p.name, p.type, p.resource, p.action, p.riskLevel, p.route])));
console.log(JSON.stringify({ tables: groupCount, fields: fieldCount, models: models.length, migrations: migrations.length, routes: routes.length, navigation: context.exports.entries.length, permissions: PERMISSION_CATALOG.length }));
