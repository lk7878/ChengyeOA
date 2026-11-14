import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppFrame } from '../../../third_party/deepseek-harness/packages/client/ui-layout/src/client/AppFrame';
import { SidebarRoot } from '../../../third_party/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot';
import { ConversationRoot } from '../../../third_party/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot';
import { UserMessageNodeView } from '../../../third_party/deepseek-harness/packages/client/ui-chat/src/client/chat/MessageItem';
import { AssistantMarkdown } from '../../../third_party/deepseek-harness/packages/client/ui-chat/src/client/chat/AssistantMarkdown';
import { Button, Modal, IconFolderOpen16, IconCloseOutline16, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import chrome from '../../../third_party/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css';
import { useCaseWorkspace } from './useCaseWorkspace';
import { removeLegacyWorkspace } from './legacy-cleanup.mjs';
import { NativeComposer } from './NativeComposer';
import { NativeDecision } from './NativeDecision';
import { t } from './locale';
import { ModelSettings } from './ModelSettings';
import { DraggableModelDialog } from './DraggableModelDialog';

/** Present the original logged user/assistant chunks through Harness message components. */
function transcript(events: any[]) {
  const result: any[] = []; let assistant: any;
  for (const event of events) {
    if (event.type === 'user/message' && event.data.source?.kind === 'user') { assistant = undefined; result.push({ kind: 'user', key: String(event.seq), data: { content: event.data.content, time: event.time } }); }
    if (event.type !== 'assistant/chunk') continue;
    const chunk = event.data.chunk;
    if (!['text-delta', 'reasoning-delta'].includes(chunk?.type)) continue;
    if (!assistant) { assistant = { kind: 'assistant', key: String(event.seq), blocks: [] }; result.push(assistant); }
    const kind = chunk.type === 'text-delta' ? 'text' : 'reasoning';
    let block = assistant.blocks.at(-1);
    if (block?.kind !== kind) { block = { kind, text: '' }; assistant.blocks.push(block); }
    block.text += chunk.text ?? '';
  }
  return result;
}

function Transcript({ events, running }: { events: any[]; running: boolean }) {
  const rows = useMemo(() => transcript(events), [events]); const end = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const scroller = end.current?.closest('[data-conversation-scroll]'); if (!scroller) return;
    const onScroll = () => { pinned.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180; };
    scroller.addEventListener('scroll', onScroll); return () => scroller.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { if (pinned.current && rows.length) end.current?.scrollIntoView({ block: 'nearest' }); }, [events]);
  return <div className="native-transcript" aria-label="办案对话记录">{rows.map((row, i) => row.kind === 'user'
    ? <UserMessageNodeView key={row.key} {...({ node: row, renderMessageImages: () => null, useChat: (select: any) => select({ order: rows.map(r => r.key), nodes: new Map(rows.map(r => [r.key, r])) }), t } as any)} />
    : <section key={row.key} className="native-assistant"><AssistantMarkdown blocks={row.blocks} streaming={running && i === rows.length - 1} renderMessageImages={() => null} t={t as any} /></section>)}
    {running && <p role="status" className="muted">法律助手正在处理…</p>}<div ref={end} /></div>;
}
const Provider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

/** OA data faces composed into the unmodified Harness frame, sidebar, hero and composer. */
export function CaseCenter({ userId, api }: { userId: string; api: any }) {
  const model = useCaseWorkspace({ userId, api });
  const [panels, setPanels] = useState({ sidebar: 280, details: 0, narrow: false, narrowExpanded: false, primaryPage: null });
  const [dialog, setDialog] = useState<'tools' | 'settings' | 'materials' | null>(null);
  const [cleanupError, setCleanupError] = useState('');
  const [cleanupStatus, setCleanupStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const rootElement = useRef<HTMLDivElement>(null);
  const cleanLegacy = async () => {
    try { setCleanupStatus(await removeLegacyWorkspace(userId)); setCleanupError(''); }
    catch { setCleanupStatus('failed'); setCleanupError('旧版智慧办案测试资料清理未完成，请关闭其他旧版办案页面后重试。'); }
  };
  useEffect(() => { void cleanLegacy(); }, [userId]);
  useEffect(() => {
    const closeMenus = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      for (const menu of rootElement.current?.querySelectorAll<HTMLDetailsElement>('.native-session-item details[open]') || []) {
        if (event.type === 'keydown' || !event.composedPath().includes(menu)) menu.open = false;
      }
    };
    document.addEventListener('pointerdown', closeMenus, true);
    document.addEventListener('keydown', closeMenus, true);
    return () => { document.removeEventListener('pointerdown', closeMenus, true); document.removeEventListener('keydown', closeMenus, true); };
  }, []);
  const latest = useRef(model); latest.current = model;
  const actions = useMemo(() => ({
    setSidebar: (px: number) => setPanels(p => ({ ...p, sidebar: Math.max(264, Math.min(420, px)) })),
    setDetails: (px: number) => setPanels(p => ({ ...p, details: Math.max(300, Math.min(520, px)) })),
    toggleSidebar: () => setPanels(p => p.narrow ? { ...p, narrowExpanded: !p.narrowExpanded } : { ...p, sidebar: p.sidebar ? 0 : 280 }),
    setNarrow: (narrow: boolean) => setPanels(p => p.narrow === narrow ? p : { ...p, narrow, narrowExpanded: false }),
    closeDetails: () => setPanels(p => p.details ? { ...p, details: 0 } : p),
    openDetails: () => setPanels(p => ({ ...p, details: 360 })),
  }), []);
  const titles = new Map(model.cases.map(item => {
    const first = (model.events[item.id] || []).find(row => row.type === 'user/message' && row.data.source?.kind === 'user');
    return [item.id, item.title || first?.data.content?.find((block: any) => block.type === 'text')?.text?.slice(0, 32) || `${new Date(item.createdAt).toLocaleDateString()} · ${item.id.slice(-8)}`];
  }));
  const sessionEvents = model.events[model.selected] || [];
  const running = model.statuses[model.selected] === 'running';
  const blank = !sessionEvents.some(row => row.type === 'user/message');
  const session = { blank, running, awaitingFirstTurn: false, promptAttempted: false, openState: 'open', subagent: null };
  const sessions = { current: model.selected || undefined, byId: Object.fromEntries(model.cases.map(item => [item.id, { ...item, title: titles.get(item.id), blank: item.id === model.selected ? blank : false, cwd: '个人办案空间' }])) };
  const useSessions = (select: any) => select(sessions);
  const showMaterials = () => {
    // The native width solver hides details when the center would become too narrow.
    // A dialog keeps the same material controls reachable at those widths.
    if ((rootElement.current?.clientWidth ?? 0) < 1280) setDialog('materials'); else actions.openDetails();
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const materials = <div className="native-panel-content">
    <p className="muted">原件、提取文本和成果均保存在服务器，仅当前账号可访问。单文件最大200MB。</p>
    <label className="native-check"><input type="checkbox" checked={model.ocr} onChange={e => model.setOcr(e.target.checked)} />启用服务器 OCR 识别图片与扫描页（需管理员配置）</label>
    <Button variant="outline" disabled={!model.workspace || model.busy || model.filter !== 'active'} onClick={() => fileInput.current?.click()}>导入办案材料</Button>
    {model.uploadProgress && <p role="status">{model.uploadProgress} <Button onClick={model.cancelUpload}>取消上传</Button></p>}
    {model.files.map(file => <div className="native-file" key={file.id}><div><span>{file.name}</span><small>{(file.size / 1048576).toFixed(2)} MB · {{ ready: '可用于分析', queued: '等待解析', parsing: '解析中', failed: '解析失败，原件已保留' }[file.status as string]}{file.error ? ` · ${file.error}` : ''}</small></div><Button size="sm" disabled={model.busy} onClick={() => void model.downloadFile(file)}>下载</Button>{file.status === 'failed' && <Button size="sm" disabled={model.busy} onClick={() => void model.retryParse(file)}>重试解析</Button>}</div>)}
  </div>;
  const sidebarSlot = (name: string, owner: any, options?: any) => {
    if (name === 'sidebar.brand.mark') return <span aria-hidden="true">☰</span>;
    if (name === 'sidebar.brand.name') return <span>智慧办案</span>;
    if (name === 'sidebar.workspaces') return owner.wide ? <div className="native-session-list">
      <input aria-label="搜索会话" placeholder="搜索会话" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="native-section-label">个人办案空间 · 服务器</div>
      <select aria-label="会话分类" value={model.filter} onChange={e => void model.changeFilter(e.target.value)}><option value="active">最近会话</option><option value="archived">已归档</option><option value="deleted">已删除</option></select>
      {model.cases.filter(item => titles.get(item.id)?.includes(search)).map(item => <div className="native-session-item" key={item.id}>
        <button className="native-session-row" aria-current={model.selected === item.id ? 'page' : undefined} disabled={model.busy || !!item.deleted} onClick={() => void model.choose(item)}>{titles.get(item.id)}</button>
        <details><summary aria-label={`会话操作：${titles.get(item.id)}`}>···</summary><div className="native-session-actions" onClick={event => { const menu = event.currentTarget.closest('details'); if (menu) menu.open = false; }}>
          {item.deleted ? <button onClick={() => void model.changeSession(item.id, 'restore')}>恢复</button> : <>
            <button onClick={() => setRename({ id: item.id, title: titles.get(item.id) || '' })}>重命名</button>
            <button onClick={() => void model.changeSession(item.id, item.archived ? 'unarchive' : 'archive')}>{item.archived ? '取消归档' : '归档'}</button>
            <button onClick={() => setDeleteId(item.id)}>删除</button>
          </>}
        </div></details>
      </div>)}
      {!model.cases.length && <p className="muted">暂无办案会话</p>}
    </div> : null;
    if (name === 'sidebar.settings') return model.settings.canManage ? <Button size="sm" icon={<IconSettingsOutline16 />} aria-label="AI模型配置" onClick={() => setDialog('settings')}>{owner.wide ? 'AI模型配置' : null}</Button> : null;
    if (name === 'sidebar.footer.action') return <Button size="sm" icon={<IconFolderOpen16 />} aria-label="办案工具" onClick={() => setDialog('tools')}>{owner.wide ? '材料与知识库' : null}</Button>;
    return options?.fallback ?? null;
  };
  const conversationSlot = (name: string, owner: any, options?: any): React.ReactNode => {
    if (name === 'conversation.hero.brand.mark') return null;
    if (name === 'conversation.composer.bar') return <NativeComposer model={model} owner={owner} onTools={() => setDialog('tools')} />;
    if (name === 'conversation.hero.workspace') return null;
    if (name === 'conversation.hero.agentPreset') return <span className="native-preset">法律助手</span>;
    if (name === 'conversation.session.header') return <div className={`${chrome.header} ${blank ? chrome.headerHidden : ''}`}>
      <div className={chrome.titleRow}><div className={chrome.titleCluster}><span className={`${chrome.crumb} ${chrome.crumbCurrent}`}>{titles.get(model.selected)}</span></div>
        <div className={chrome.headerUtilities}><Button size="sm" icon={<IconFolderOpen16 />} onClick={showMaterials}>办案材料</Button><Button size="sm" onClick={() => setDialog('tools')}>知识库引用</Button></div></div>
      <div className={chrome.tabs}><button className={`${chrome.tab} ${chrome.tabActive}`} type="button">对话</button></div></div>;
    if (name === 'conversation.session') return blank ? null : <Transcript events={sessionEvents} running={running} />;
    if (name === 'conversation.input.left') return <Button size="sm" onClick={showMaterials}>办案材料 {model.files.length || ''}</Button>;
    if (name === 'conversation.input.right') return <span className="native-preset">法律助手</span>;
    if (name === 'conversation.composer.dock') return <p className="native-footnote">AI内容请核验后使用 · 材料按需发送至配置的模型服务</p>;
    return options?.fallback ?? null;
  };
  const frameSlot = (name: string, owner: any) => {
    if (name === 'sidebar') return <fieldset className="native-sidebar-controls" disabled={!model.workspace || model.busy}><SidebarRoot {...({ ...owner, startSession: () => { if (latest.current.workspace && !latest.current.busy) void latest.current.create(); }, toggleSidebar: actions.toggleSidebar, t, renderSlot: sidebarSlot } as any)} /></fieldset>;
    if (name === 'conversation') return <ConversationRoot {...({
      sessionId: model.selected || undefined, useSession: (select: any) => model.selected ? select(session) : undefined,
      useSessions, useSessionPendingInteraction: (select: any) => select(new Map()),
      useWorkspaces: (select: any) => select({ phase: 'ready', items: [{ workspaceId: 'server', title: '个人办案空间', sessionIds: model.cases.map(item => item.id) }] }),
      useConversation: (select: any) => select({ views: { get: () => undefined }, activeTargets: new Set(blank ? [] : ['chat']) }),
      useInput: (select: any) => select({ draft: model.text }), useComposerBlock: (select: any) => select(undefined),
      selectWorkspace: model.create, t, renderSlot: conversationSlot,
      renderSlotChain: (_: string, __: any, options: any) => {
        const event = model.pending.find(item => item.sessionId === model.selected);
        return event ? <NativeDecision key={event.id} event={event} model={model} /> : options.fallback;
      },
    } as any)} />;
    if (name === 'details') return <section className="native-details" aria-label="办案材料面板"><header><strong>办案材料与成果</strong><Button size="sm" aria-label="收起材料面板" icon={<IconCloseOutline16 />} onClick={actions.closeDetails} /></header>{materials}</section>;
    return null;
  };
  return <div className="native-case-root" ref={rootElement} data-legacy-cleanup={cleanupStatus}>
    {cleanupError && <div className="native-error" role="alert">{cleanupError}<Button onClick={() => void cleanLegacy()}>重试清理</Button></div>}
    {model.error && <div className="native-error" role="alert">{model.error}</div>}
    <input ref={fileInput} type="file" hidden disabled={!model.workspace || model.busy || model.filter !== 'active'} accept=".md,.txt,.pdf,.docx,.xlsx,.html,.png,.jpg,.jpeg,.webp" onChange={e => { const file = e.target.files?.[0]; if (file) void model.upload(file); e.target.value = ''; }} />
    <AppFrame {...({ useStore: (select: any) => select(panels), useSessions, actions, renderSlot: frameSlot, SessionProvider: Provider, t } as any)} />
    <Modal open={deleteId !== null} title="删除会话" closeLabel="取消" onClose={() => setDeleteId(null)}>
      <div className="native-panel-content"><p>删除此会话及其材料？可在“已删除”中恢复。</p><Button disabled={model.busy} onClick={() => setDeleteId(null)}>取消</Button><Button variant="primary" disabled={model.busy} onClick={() => { if (deleteId) { void model.changeSession(deleteId, 'delete'); setDeleteId(null); } }}>确认删除</Button></div>
    </Modal>
    <Modal open={rename !== null} title="重命名会话" closeLabel="关闭" onClose={() => setRename(null)}>
      <form className="native-panel-content" onSubmit={e => { e.preventDefault(); if (rename) { void model.changeSession(rename.id, 'rename', rename.title); setRename(null); } }}><input aria-label="会话名称" required maxLength={100} value={rename?.title || ''} onChange={e => setRename(old => old && ({ ...old, title: e.target.value }))} /><Button type="submit" variant="primary">保存名称</Button></form>
    </Modal>
    <DraggableModelDialog open={dialog === 'settings'} onClose={() => setDialog(null)}><ModelSettings model={model} /></DraggableModelDialog>
    <Modal open={dialog === 'tools' || dialog === 'materials'} title={dialog === 'materials' ? '办案材料与成果' : '办案工具'} closeLabel="关闭" onClose={() => setDialog(null)}>
      {dialog === 'materials' ? materials : dialog === 'tools' ? <div className="native-panel-content">
        <Button variant="outline" onClick={() => { setDialog(null); showMaterials(); }}>办案材料与成果</Button>
        <h3>引用云端知识库</h3>{model.bases.map(base => <label className="native-check" key={base.id}><input type="checkbox" checked={model.refs.includes(base.id)} onChange={e => model.setRefs(old => e.target.checked ? [...old, base.id] : old.filter(id => id !== base.id))} />{base.name}</label>)}
        {!model.bases.length && <p className="muted">暂无可引用的知识库。</p>}<a href="/knowledge">前往知识库</a>
      </div> : null}

    </Modal>
  </div>;
}
