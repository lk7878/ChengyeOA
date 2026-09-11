import { approvalMaterialsApi, downloadBlob, type ApprovalMaterial } from '@/api/approval-materials';
import type { WordBlock } from './office-documents';

const STATUS: Record<string, string> = { PENDING: '审批中（尚未通过）', APPROVED: '已通过', REJECTED: '已驳回', WITHDRAWN: '已撤回', CANCELLED: '已取消' };
const text = (value: unknown) => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export function materialBlocks(data: ApprovalMaterial): WordBlock[] {
  const { instance, tasks, attachments, people } = data;
  const person = (id: string) => people.find(item => item.id === id)?.name || id;
  const fields = instance.formSnapshot?.formSchema?.fields || [];
  return [
    { kind: 'paragraph', text: '重庆承业律师事务所 · 审批材料' },
    { kind: 'paragraph', text: instance.title },
    { kind: 'table', rows: [['审批编号', instance.id], ['审批类型', instance.formSnapshot?.name || instance.businessType], ['当前状态', STATUS[instance.status] || instance.status], ['申请人', person(instance.applicantId)], ['申请时间', new Date(instance.createdAt).toLocaleString('zh-CN')], ...Object.entries(instance.content).map(([key, value]) => [fields.find(field => field.key === key)?.label || key, text(value)])] },
    { kind: 'paragraph', text: '附件及证明材料清单' },
    { kind: 'table', rows: [['序号', '文件名称', '大小（KB）'], ...attachments.map((file, i) => [String(i + 1), file.fileName, (file.fileSize / 1024).toFixed(1)])] },
    { kind: 'paragraph', text: '线上审批记录' },
    { kind: 'table', rows: [['审批节点', '审批人', '状态', '意见', '处理时间'], ...tasks.map(task => [task.nodeName, person(task.assigneeId), STATUS[task.status] || task.status, task.remark || '', task.processedAt ? new Date(task.processedAt).toLocaleString('zh-CN') : ''])] },
    { kind: 'paragraph', text: '线下签字与归档' },
    { kind: 'paragraph', text: '申请人签字：________________    日期：________________\n审批人签字：________________    日期：________________\n归档人：________________    归档编号：________________' },
    { kind: 'paragraph', text: '此材料记录导出时的审批状态；线下签字不会自动改变系统审批结果。附件原文件请随材料一并归档。' },
  ];
}
export function blocksHtml(blocks: WordBlock[]): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  return blocks.map(block => block.kind === 'paragraph' ? `<p>${escape(block.text).replaceAll('\n', '<br>')}</p>` : `<table>${block.rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</table>`).join('');
}
export async function exportApprovalMaterial(instanceId: string, print = false): Promise<void> {
  // Open synchronously in the user's click gesture to avoid popup blockers.
  const page = print ? window.open('', '_blank') : null;
  if (print && !page) throw new Error('请允许弹出打印窗口后重试');
  try {
    const data = (await approvalMaterialsApi.material(instanceId)).data;
    const blocks = materialBlocks(data);
    if (page) {
      page.opener = null;
      page.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>审批材料</title><style>body{font-family:SimSun,serif;color:#111;margin:28px}p{white-space:normal;line-height:1.7}table{width:100%;border-collapse:collapse;table-layout:fixed}td{border:1px solid #999;padding:8px;overflow-wrap:anywhere}tr{break-inside:avoid}@page{size:A4;margin:15mm}</style></head><body>${blocksHtml(blocks)}</body></html>`);
      page.document.close(); page.focus(); page.print();
    } else {
      const { writeWord } = await import('./office-documents');
      downloadBlob(await writeWord(blocks), data.instance.title.replace(/[<>:"/\\|?*]/g, '_') + '_审批材料.docx');
    }
  } catch (error) { page?.close(); throw error; }
}
