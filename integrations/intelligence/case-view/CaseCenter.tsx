import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppFrame } from '../../../third_party/deepseek-harness/packages/client/ui-layout/src/client/AppFrame';
import { SidebarRoot } from '../../../third_party/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot';
import { ConversationRoot } from '../../../third_party/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot';
import { UserMessageNodeView } from '../../../third_party/deepseek-harness/packages/client/ui-chat/src/client/chat/MessageItem';
import { AssistantMarkdown } from '../../../third_party/deepseek-harness/packages/client/ui-chat/src/client/chat/AssistantMarkdown';
import { Button, Modal, IconFolderOpen16, IconCloseOutline16, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import chrome from '../../../third_party/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css';
import { useCaseWorkspace, download } from './useCaseWorkspace';
import { NativeComposer } from './NativeComposer';
import { NativeDecision } from './NativeDecision';
import { t } from './locale';

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
  const [dialog, setDialog] = useState<'tools' | 'storage' | 'materials' | null>(null);
  const [search, setSearch] = useState('');
  const rootElement = useRef<HTMLDivElement>(null);
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
    return [item.id, first?.data.content?.find((block: any) => block.type === 'text')?.text?.slice(0, 32) || `${new Date(item.createdAt).toLocaleDateString()} · ${item.id.slice(-8)}`];
  }));
  const sessionEvents = model.events[model.selected] || [];
  const running = model.statuses[model.selected] === 'running';
  const blank = !sessionEvents.some(row => row.type === 'user/message');
  const session = { blank, running, awaitingFirstTurn: false, promptAttempted: false, openState: 'open', subagent: null };
  const sessions = { current: model.selected || undefined, byId: Object.fromEntries(model.cases.map(item => [item.id, { ...item, title: titles.get(item.id), blank: item.id === model.selected ? blank : false, cwd: '本机办案工作区' }])) };
  const useSessions = (select: any) => select(sessions);
  const showMaterials = () => {
    // The native width solver hides details when the center would become too narrow.
    // A dialog keeps the same material controls reachable at those widths.
    if ((rootElement.current?.clientWidth ?? 0) < 1280) setDialog('materials'); else actions.openDetails();
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const materials = <div className="native-panel-content">
    <p className="muted">原件和成果保存在当前浏览器的本机工作区。</p>
    <label className="native-check"><input type="checkbox" checked={model.ocr} onChange={e => model.setOcr(e.target.checked)} />允许将需识别的图片或扫描页临时发送到云端 OCR</label>
    <Button variant="outline" disabled={!model.selected || model.busy} onClick={() => fileInput.current?.click()}>导入办案材料</Button>
    {!model.selected && <p className="muted">请先新建或打开办案会话。</p>}
    {model.files.map(file => <div className="native-file" key={file.name}><span>{file.name}</span><Button size="sm" onClick={() => void model.run(async () => { const value = await model.workspace.call('downloadFile', { sessionId: model.selected, fileName: file.name }); download(file.name, Uint8Array.from(atob(value.base64), character => character.charCodeAt(0)), 'application/octet-stream'); })}>下载</Button></div>)}
  </div>;
  const sidebarSlot = (name: string, owner: any, options?: any) => {
    if (name === 'sidebar.brand.name') return <span>智慧办案</span>;
    if (name === 'sidebar.workspaces') return owner.wide ? <div className="native-session-list">
      <input aria-label="搜索本机会话" placeholder="搜索会话" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="native-section-label">本机办案工作区</div>
      {model.cases.filter(item => titles.get(item.id)?.includes(search)).map(item => <button className="native-session-row" aria-current={model.selected === item.id ? 'page' : undefined} key={item.id} disabled={model.busy} onClick={() => void model.choose(item)}>{titles.get(item.id)}</button>)}
      {!model.cases.length && <p className="muted">暂无办案会话</p>}
    </div> : null;
    if (name === 'sidebar.settings') return <Button size="sm" icon={<IconSettingsOutline16 />} aria-label="工作区备份与设置" onClick={() => setDialog('storage')}>{owner.wide ? '工作区设置' : null}</Button>;
    if (name === 'sidebar.footer.action') return <Button size="sm" icon={<IconFolderOpen16 />} aria-label="办案工具" onClick={() => setDialog('tools')}>{owner.wide ? '材料与知识库' : null}</Button>;
    return options?.fallback ?? null;
  };
  const conversationSlot = (name: string, owner: any, options?: any): React.ReactNode => {
    if (name === 'conversation.composer.bar') return <NativeComposer model={model} owner={owner} onTools={() => setDialog('tools')} />;
    if (name === 'conversation.hero.workspace') return owner.open ? <Modal open title="本机办案工作区" closeLabel="关闭" onClose={owner.onClose}><p>材料与会话由浏览器保存在这台电脑。</p><Button disabled={!model.workspace || model.busy} variant="primary" onClick={() => { owner.onClose(); void model.create(); }}>新建会话</Button></Modal> : null;
    if (name === 'conversation.hero.agentPreset') return <span className="native-preset">法律助手</span>;
    if (name === 'conversation.session.header') return <div className={`${chrome.header} ${blank ? chrome.headerHidden : ''}`}>
      <div className={chrome.titleRow}><div className={chrome.titleCluster}><span className={`${chrome.crumb} ${chrome.crumbCurrent}`}>{titles.get(model.selected)}</span></div>
        <div className={chrome.headerUtilities}><Button size="sm" icon={<IconFolderOpen16 />} onClick={showMaterials}>办案材料</Button><Button size="sm" onClick={() => setDialog('tools')}>知识库引用</Button></div></div>
      <div className={chrome.tabs}><button className={`${chrome.tab} ${chrome.tabActive}`} type="button">对话</button></div></div>;
    if (name === 'conversation.session') return blank ? null : <Transcript events={sessionEvents} running={running} />;
    if (name === 'conversation.input.left') return <Button size="sm" onClick={showMaterials}>办案材料 {model.files.length || ''}</Button>;
    if (name === 'conversation.input.right') return <span className="native-preset">法律助手</span>;
    if (name === 'conversation.composer.dock') return <p className="native-footnote">内容由 AI 生成，请核验后使用 · 本机工作区</p>;
    return options?.fallback ?? null;
  };
  const frameSlot = (name: string, owner: any) => {
    if (name === 'sidebar') return <fieldset className="native-sidebar-controls" disabled={!model.workspace || model.busy}><SidebarRoot {...({ ...owner, startSession: () => { if (latest.current.workspace && !latest.current.busy) void latest.current.create(); }, toggleSidebar: actions.toggleSidebar, t, renderSlot: sidebarSlot } as any)} /></fieldset>;
    if (name === 'conversation') return <ConversationRoot {...({
      sessionId: model.selected || undefined, useSession: (select: any) => model.selected ? select(session) : undefined,
      useSessions, useSessionPendingInteraction: (select: any) => select(new Map()),
      useWorkspaces: (select: any) => select({ phase: 'ready', items: [{ workspaceId: 'local', title: '本机办案工作区', sessionIds: model.cases.map(item => item.id) }] }),
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
  return <div className="native-case-root" ref={rootElement}>
    {model.error && <div className="native-error" role="alert">{model.error}</div>}
    <input ref={fileInput} type="file" hidden disabled={!model.selected || model.busy} accept=".md,.txt,.pdf,.docx,.xlsx,.html,.png,.jpg,.jpeg,.webp" onChange={e => { const file = e.target.files?.[0]; if (file) void model.upload(file); e.target.value = ''; }} />
    <AppFrame {...({ useStore: (select: any) => select(panels), useSessions, actions, renderSlot: frameSlot, SessionProvider: Provider, t } as any)} />
    <Modal open={dialog !== null} title={dialog === 'storage' ? '本地 Harness 工作区 · 备份与存储设置' : dialog === 'materials' ? '办案材料与成果' : '办案工具'} closeLabel="关闭" onClose={() => setDialog(null)}>
      {dialog === 'materials' ? materials : dialog === 'tools' ? <div className="native-panel-content">
        <Button variant="outline" onClick={() => { setDialog(null); showMaterials(); }}>办案材料与成果</Button>
        <h3>引用云端知识库</h3>{model.bases.map(base => <label className="native-check" key={base.id}><input type="checkbox" checked={model.refs.includes(base.id)} onChange={e => model.setRefs(old => e.target.checked ? [...old, base.id] : old.filter(id => id !== base.id))} />{base.name}</label>)}
        {!model.bases.length && <p className="muted">暂无可引用的知识库。</p>}<a href="/knowledge">前往知识库</a>
      </div> : <div className="native-panel-content">
        <p>工作区与当前账号、浏览器和 OA 网址绑定。清除站点数据会删除本机资料；换电脑请先导出备份。</p>
        <p>{model.storage?.persisted ? '已启用持久化存储' : '尚未获得浏览器持久化授权'}{model.storage?.usage ? ` · 已用 ${(model.storage.usage / 1048576).toFixed(1)} MB` : ''}</p>
        <Button disabled={!model.workspace} onClick={() => void model.run(async () => { await model.workspace.persist(); model.setStorage(await model.workspace.storage()); })}>请求持久化存储</Button>
        <Button disabled={!model.workspace} onClick={() => void model.run(async () => download('办案工作区备份.json', JSON.stringify(await model.workspace.call('backup'))))}>导出完整备份</Button>
        <label className="native-backup-label">恢复备份<input type="file" accept=".json" disabled={!model.workspace || model.busy} onChange={e => { const file = e.target.files?.[0]; if (file) void model.run(async () => { if (file.size > 256 * 1024 * 1024) throw new Error('备份超过 256 MB'); await model.workspace.call('restore', { backup: JSON.parse(await file.text()) }); model.setCases(await model.workspace.call('sessions')); }); e.target.value = ''; }} /></label>
      </div>}
    </Modal>
  </div>;
}
