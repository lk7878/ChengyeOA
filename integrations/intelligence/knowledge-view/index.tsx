import React from 'react';
import { createRoot } from 'react-dom/client';
import { KnowledgeBaseCenter } from '../../../third_party/deepseek-harness/packages/product/product-knowledge/src/client/KnowledgeBaseCenter';
import { zh } from '../../../third_party/deepseek-harness/packages/product/product-knowledge/src/client/locales';
import { knowledgeActions } from './actions';
import { KnowledgeReader } from './Reader';
import './theme.css';

/** Own React 18 root; only a DOM element and ordinary callbacks cross into OA. */
export function mountKnowledge(container: HTMLElement, service: { call: any }, close: () => void, readOnly = false) {
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
  const styles = document.createElement('link'); styles.rel = 'stylesheet'; styles.href = new URL('./knowledge-view.css', import.meta.url).href;
  const host = document.createElement('div'); host.className = 'knowledge-island';
  shadow.replaceChildren(styles, host);
  const root = createRoot(host);
  const strings = { ...zh, close: '返回 OA', titleDescription: '云端统一知识库 · 管理员维护',
    createDescription: '填写唯一英文标识和中文名称，供办案时选用。', aliasPlaceholder: 'law-library', namePlaceholder: '律所业务知识库',
    semanticUnavailable: '云端语义模型或索引不可用', importFileDescription: '上传到云端后解析并建立检索索引。',
    manageKnowledgeBasesDescription: '切换、新建或恢复云端知识库。', recentDocumentsDescription: '当前云端资料库。',
    uploadDescription: '源文件已保存在云端', indexDescription: '证据分段已写入云端索引',
    documentCenterDescription: '导入、检查和处理云端知识库资料。',
    chatSessionHint: '管理员问答与历史引用保存在云端；律师办案会话在个人工作区。',
    compilerGapSave: '保存核验', localMode: '确定性检索回答', localExtractive: '抽取式检索',
    semanticIndex: '知识库语义索引', semanticIndexDescription: '派生向量保存在云端；重建不改变原文。' };
  const t = (key: string, values: Record<string, unknown> = {}) => String((strings as any)[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => name in values ? String(values[name]) : match);
  root.render(readOnly ? <KnowledgeReader call={service.call} /> : <KnowledgeBaseCenter {...knowledgeActions(service.call, close)} t={t as any} />);
  return () => { root.unmount(); shadow.replaceChildren(); };
}
