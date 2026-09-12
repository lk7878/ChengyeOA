import React, { useEffect, useState } from 'react';
import { MarkdownText } from '../../../third_party/deepseek-harness/packages/client/ui-primitives/src/markdown/MarkdownText';

export function KnowledgeReader({ call }: { call: any }) {
  const [bases, setBases] = useState<any[]>([]); const [ref, setRef] = useState('');
  const [pages, setPages] = useState<any[]>([]); const [text, setText] = useState(''); const [query, setQuery] = useState('');
  const [hits, setHits] = useState<any[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [documentId, setDocumentId] = useState('');
  const pageText = (page: any) => page ? `# ${page.title}\n\n${page.sections?.map((section: any) => `## ${section.heading}\n${section.content}`).join('\n\n') || page.summary || '暂无已编译内容'}` : '暂无已编译资料';
  useEffect(() => { let live = true; call('list').then((value: any) => { if (live) { setBases(value.knowledgeBases); setRef(value.knowledgeBases[0]?.id || ''); } }).catch((e: Error) => live && setError(e.message)); return () => { live = false; }; }, [call]);
  useEffect(() => {
    if (!ref) return; let live = true; setError(''); setHits([]);
    setDocumentId(''); setText('加载知识页面…');
    call('wiki', { ref }).then((value: any) => { if (live) { setPages(value.pages); setDocumentId(value.pages[0]?.documentId || ''); setText(pageText(value.pages[0])); } }).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [ref, call]);
  useEffect(() => {
    if (!documentId) return; let live = true;
    call('wiki', { ref, documentId }).then((value: any) => { if (live) setText(pageText(value.pages[0])); }).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [ref, documentId, call]);
  const search = async () => { setBusy(true); setError(''); try { const value = await call('search', { ref, query, limit: 8 }); setHits(value.hits || []); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const read = async (hit: any) => { setDocumentId(''); try { const value = await call('read', { ref, documentId: hit.documentId, startLine: hit.startLine, endLine: hit.endLine }); setText(`## ${hit.documentName}（第 ${value.startLine}—${value.endLine} 行）\n\n${value.content}`); } catch (e) { setError((e as Error).message); } };
  return <div className="reader">
    <header><h2>云端知识库</h2><p>由系统管理员统一维护和编译。选择知识库，检索资料并核对原文引用。</p></header>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="toolbar"><select aria-label="选择知识库" value={ref} onChange={e => setRef(e.target.value)}>{bases.map(base => <option key={base.id} value={base.id}>{base.name}</option>)}</select>
      <form onSubmit={e => { e.preventDefault(); void search(); }}><input aria-label="检索知识库" placeholder="输入问题或关键词" value={query} onChange={e => setQuery(e.target.value)} /><button disabled={!ref || !query.trim() || busy}>{busy ? '检索中…' : '检索'}</button></form></div>
    {!bases.length ? <p>管理员尚未发布可用知识库。</p> : <div className="reader-grid"><aside>
      {hits.length > 0 && <><h3>检索结果</h3>{hits.map((hit, i) => <button key={i} onClick={() => void read(hit)}>{hit.documentName}<small>第 {hit.startLine}—{hit.endLine} 行</small></button>)}</>}
      <h3>知识页面</h3>{pages.map(page => <button key={page.id} onClick={() => setDocumentId(page.documentId)}>{page.title}</button>)}
    </aside><article><MarkdownText text={text} /></article></div>}
  </div>;
}
