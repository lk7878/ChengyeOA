import { labels, matches, type Instance, type FormField, type Values, type Option } from './api';

const escape = (value: unknown) =>
  String(value ?? '—').replace(
    /[&<>"']/g,
    (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]!,
  );
export function displayValue(f: FormField, value: unknown, users: Option[]): string {
  if (value == null || value === '') return '—';
  if (f.type === 'user') return users.find((u) => u.id === value)?.name ?? String(value);
  if (f.type === 'relation') return '已关联业务记录';
  if (f.type === 'file') return Array.isArray(value) ? `${value.length}份附件（在原单查看）` : '—';
  if (f.type === 'detail') return Array.isArray(value) ? `${value.length}行明细` : '—';
  return Array.isArray(value) ? value.join('、') : String(value);
}
export function approvalPrintHtml(i: Instance, users: Option[], printer: string): string {
  const person = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const time = (v: string) => new Date(v).toLocaleString('zh-CN');
  const fields = (list: FormField[], values: Values): string =>
    list
      .filter((f) => f.printable !== false && matches(f.visibleWhen, values))
      .map((f) => {
        const value = values[f.key];
        const contents =
          f.type === 'detail' && Array.isArray(value)
            ? value
                .map(
                  (row, index) =>
                    `<div class="print-detail"><b>明细 ${index + 1}</b>${fields(f.children ?? [], row)}</div>`,
                )
                .join('') || '—'
            : f.type === 'relation' && i.relationSnapshots?.[f.key]
              ? escape(i.relationSnapshots[f.key].label) + i.relationSnapshots[f.key].references.map(r =>
                `<div>${escape(r.name)}：${escape(r.text)}</div>`).join('')
              : escape(displayValue(f, value, users));
        return `<div class="print-field"><strong>${escape(f.label)}</strong><div>${contents}</div></div>`;
      })
      .join('');
  return `<article class="wf-print-sheet"><h1>${escape(i.title)}</h1><p>审批编号：${escape(i.id)}</p><p>发起人：${escape(person(i.applicantId))} &nbsp; 申请时间：${escape(time(i.createdAt))} &nbsp; 状态：${escape(labels[i.status] ?? i.status)}</p>${i.correctionOf ? `<p>更正原申请：${escape(i.correctionOf)}</p>` : ''}<h2>申请信息</h2>${fields(i.snapshot.fields, i.content)}<h2>审批记录</h2><table><thead><tr><th>时间</th><th>处理人</th><th>节点 / 操作</th><th>意见</th></tr></thead><tbody>${i.logs.map((l) => `<tr><td>${escape(time(l.createdAt))}</td><td>${escape(person(l.actorId))}</td><td>${escape(i.snapshot.nodes.find((n) => n.id === l.nodeId)?.name ?? '')} / ${escape(labels[l.action] ?? l.action)}</td><td>${escape(l.remark)}</td></tr>`).join('')}</tbody></table><footer>打印人：${escape(printer)} &nbsp; 打印时间：${escape(new Date().toLocaleString('zh-CN'))}<br>仅打印当前账号可见且允许打印的字段；以系统审批记录为准。</footer></article>`;
}
export const printStyles = `body{font-family:"Microsoft YaHei",sans-serif;color:#172b4d;margin:28px;font-size:12px}h1{font-size:22px}h2{font-size:16px;margin-top:24px}.print-field{display:grid;grid-template-columns:150px 1fr;border-bottom:1px solid #ddd;padding:10px;white-space:pre-wrap;overflow-wrap:anywhere}.print-detail{border:1px solid #ddd;margin:6px 0;padding:8px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #ddd;padding:8px;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap}tr,.print-field{break-inside:avoid}thead{display:table-header-group}footer{margin-top:24px;color:#64748b}@page{size:A4;margin:16mm}`;
