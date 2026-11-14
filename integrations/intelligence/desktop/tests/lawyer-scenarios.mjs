// Real desktop smoke extension. Only external search/fetch responses and the
// model are fixtures; native Loader, skills, tools, Wiki and files stay real.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const names = ['contract-review', 'litigation-response', 'litigation-jurisdiction', 'china-legal-query'];
const titles = ['合同审查', '应诉分析', '管辖分析', '法律检索'];
const files = ['review-template.md', 'response-template.md', 'jurisdiction-template.md', 'source-protocol.md'];
const legalUrl = 'https://legal-source.example.test/rule';

export function lawyerScenarios({ work, home, ref, documentId }) {
  const observed = new Set(), searchRequests = [];
  const input = join(work, '法律测试材料.txt');
  const inputText = 'LOCAL-PRIVATE-MARKER：乙方委托审查。合同第7条付款条件不清。原告主张款项未付，尚未提供收款凭证。送达日期、被告住所地和拟起诉日期未提供。';
  const reports = titles.map(title => `# ${title}草稿（供律师复核）\n\n原告主张与已核验事实分别列示。条款定位：法律测试材料.txt 第7条。风险：付款条件需明确；建议补充验收与付款条件。\n证据缺口：收款凭证待提供。期限待确认：送达日期缺失。地域管辖、级别管辖分别待核验，不套用旧金额表。\n来源：证据指引.md 第1–3行；公开检索夹具 ${legalUrl}，原文仅用于集成测试。\n`);
  function resource(messages, name, file) {
    const full = messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
    const block = [...full.matchAll(/<skill_content name="([^"]+)">[\s\S]*?Base directory for this skill: ([^\r\n]+)[\s\S]*?<\/skill_content>/g)].findLast(match => match[1] === name);
    assert.ok(block, 'native skill instructions and resource base must reach model: ' + name);
    const base = block[2].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
    assert.ok(base.includes('中文 安装目录'), 'skill resources must come from relocated packaged preset');
    return join(base, 'references', file);
  }
  return {
    searchRequests,
    async prepare(appDir, run) {
      await writeFile(input, inputText);
      // Archive the desktop build, then run the extracted copy. The imported
      // Harness and Node remain the documented development dependencies.
      const archive = join(home, 'desktop-build.tar');
      await run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-cf', archive, '-C', appDir, '.']);
      const install = join(home, '中文 安装目录');
      const moved = join(install, 'dist/desktop'); await mkdir(moved, { recursive: true });
      // This is a development build, not a standalone installer: retain its
      // separately maintained plugin dependency while moving the packaged preset.
      await symlink(resolve(appDir, '../../desktop-plugin'), join(install, 'desktop-plugin'), process.platform === 'win32' ? 'junction' : 'dir');
      await run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archive, '-C', moved]);
      const fixture = join(home, 'legal-fetch-fixture.mjs');
      await writeFile(fixture, `export const name='legal-fetch-fixture'; export const inject=['web'];
export function apply(ctx) { ctx.web.registerFetchProvider({ id:'legal-fixture', available:()=>true,
async fetch({url}, signal) { signal?.throwIfAborted(); if(url!==${JSON.stringify(legalUrl)}) throw new Error('unexpected fixture URL');
return {url,statusCode:200,body:{kind:'html',content:'<h1>公开原文夹具</h1><p>仅用于验证引用传递，不是真实法律意见。</p>'},truncated:false}; } }); }`);
      const patchFile = join(moved, 'product.patch.yml');
      let patch = await readFile(patchFile, 'utf8');
      patch = patch.replace(/path: "[^"\r\n]*\/presets"/, 'path: ' + JSON.stringify(join(moved, 'presets').replaceAll('\\', '/')));
      assert.ok(patch.includes('中文 安装目录'));
      patch += `\n- id: web\n  config:\n    fetchProvider: legal-fixture\n- insert:\n    - id: legal-fetch-fixture\n      name: ${JSON.stringify(pathToFileURL(fixture).href)}\n`;
      await writeFile(patchFile, patch);
      return moved;
    },
    async search(req, res) {
      if (!req.url.endsWith('/messages')) return false;
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); searchRequests.push(body);
      assert.equal(req.headers['x-api-key'], 'desktop-fixture');
      assert.doesNotMatch(JSON.stringify(body), /LOCAL-PRIVATE-MARKER|desktop-oa-test-only/);
      const query = JSON.stringify(body.messages);
      res.setHeader('Content-Type', 'application/json');
      if (query.includes('失败夹具')) { res.statusCode = 503; res.end(JSON.stringify({ error: { message: 'fixture search unavailable' } })); }
      else res.end(JSON.stringify({ content: [{ type: 'web_search_tool_result', content: query.includes('无命中夹具') ? [] : [{ type: 'web_search_result', title: '公开法律来源夹具', url: legalUrl, page_age: '2026-09-14' }] }] }));
      return true;
    },
    step(body) {
      if (!body.tools?.some(tool => tool.function?.name === 'skill')) return undefined;
      const start = body.messages.findLastIndex(message => message.role === 'user' && typeof message.content === 'string' && /法律技能验收 LS-[0-3]/.test(message.content));
      if (start < 0) return undefined;
      if (body.messages.slice(start + 1).some(message => message.role === 'user' && typeof message.content === 'string' && /账号.*查询验证/.test(message.content))) return undefined;
      const n = Number(body.messages[start].content.match(/LS-([0-3])/)[1]);
      const current = body.messages.slice(start), results = current.filter(message => message.role === 'tool');
      const all = JSON.stringify(body.messages);
      for (const name of names) assert.ok(all.includes('`' + name + '`'), 'native available_skills catalog: ' + name);
      for (const toolName of ['read','write','cloud_wiki','web_search','web_fetch']) assert.ok(body.tools.some(tool => tool.function?.name === toolName));
      if (n === 0) resource(current, names[n], files[n]); // explicit /contract-review injection
      const plan = [];
      const call = (name, args) => ({ name, arguments: JSON.stringify(args) });
      if (n !== 0) plan.push(() => call('skill', { name: names[n] }));
      plan.push(() => call('read', { file_path: input }));
      plan.push(() => call('read', { file_path: resource(current, names[n], files[n]) }));
      if (n === 1) plan.push(() => call('read', { file_path: resource(current, names[n], 'evidence-checklist.md') }));
      if (n === 2) plan.push(() => call('read', { file_path: resource(current, names[n], 'jurisdiction-sources.md') }));
      if (n !== 3) plan.push(() => call('skill', { name: 'china-legal-query' }));
      plan.push(() => call('cloud_wiki', { method: 'read', ref, documentId, startLine: 1, endLine: 3 }));
      plan.push(() => call('web_search', { queries: ['合同管辖 法律依据 官方来源'] }));
      plan.push(() => call('web_fetch', { url: legalUrl }));
      if (n === 3) {
        plan.push(() => call('web_search', { queries: ['无命中夹具'] }));
        plan.push(() => call('web_search', { queries: ['失败夹具'] }));
      }
      plan.push(() => {
        assert.match(JSON.stringify(results), /公开原文夹具/);
        assert.match(JSON.stringify(results), /核对原件/);
        if (n === 3) assert.match(JSON.stringify(results.at(-1)), /fixture search unavailable|HTTP 503/);
        return call('write', { file_path: join(work, titles[n] + '.md'), content: reports[n] + (n === 3 ? '\n检索不足：无命中不等于不存在，补充检索服务失败，相关依据待核验。\n' : '') });
      });
      if (results.length < plan.length) return { tool: plan[results.length]() };
      observed.add(n);
      return { finalText: `法律技能 ${n} 验收完成。` };
    },
    async verify(agent, expect) {
      for (let n = 0; n < names.length; n++) {
        const composer = agent.locator('[contenteditable=true]').first();
        await composer.fill(`法律技能验收 LS-${n} ${n === 0 ? '/contract-review' : names[n]} 请处理法律测试材料.txt，核对来源并保存草稿。`);
        await composer.press('Enter');
        await expect(agent.getByText(`法律技能 ${n} 验收完成。`, { exact: true })).toBeVisible({ timeout: 90000 });
        assert.equal(await readFile(join(work, titles[n] + '.md'), 'utf8'), reports[n] + (n === 3 ? '\n检索不足：无命中不等于不存在，补充检索服务失败，相关依据待核验。\n' : ''));
      }
      assert.equal(observed.size, 4);
      assert.equal(searchRequests.length, 6);
      assert.equal(await readFile(input, 'utf8'), inputText);
      await agent.screenshot({ path: join(home, 'lawyer-skills-results.png') });
      console.log('PASS: four native skills, manual invocation, relocated packaged resources, real read/Wiki/search/fetch/write and failure results.');
    },
  };
}
