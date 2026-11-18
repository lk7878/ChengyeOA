import { useEffect, useRef, useState } from 'react';
import { Alert, Pagination, Spin } from 'antd';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
const assetRoot = new URL(import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : import.meta.env.BASE_URL + 'pdf-assets/', window.location.href).href;

function Page({ pdf, number, name }: { pdf: PDFDocumentProxy; number: number; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let active = true;
    let render: RenderTask | undefined;
    void pdf.getPage(number).then(async page => {
      const node = canvas.current;
      if (!active || !node) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 3200 / Math.max(natural.width, natural.height), Math.sqrt(8_000_000 / (natural.width * natural.height)));
      const viewport = page.getViewport({ scale });
      node.width = Math.ceil(viewport.width);
      node.height = Math.ceil(viewport.height);
      render = page.render({ canvas: node, viewport });
      await render.promise;
      if (active) setStatus('ready');
    }).catch(() => { if (active) setStatus('failed'); });
    return () => { active = false; render?.cancel(); };
  }, [pdf, number]);
  return <>
    {status === 'loading' && <Spin aria-label="正在绘制页面" />}
    {status === 'failed' && <Alert type="warning" title="此页无法显示，可下载原件查看。" />}
    <canvas ref={canvas} aria-label={`${name} · 第 ${number} 页`} style={{ display: status === 'ready' ? 'block' : 'none', width: '100%', height: 'auto', background: 'white' }} />
  </>;
}

export default function PdfPages({ bytes, name }: { bytes: Blob; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [number, setNumber] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    void bytes.arrayBuffer().then(async buffer => {
      if (!active) return;
      task = getDocument({ data: buffer, isEvalSupported: false, cMapUrl: assetRoot + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: assetRoot + 'standard_fonts/', wasmUrl: assetRoot + 'wasm/' });
      const document = await task.promise;
      if (active) setPdf(document);
    }).catch(reason => {
      if (active) setError(reason?.name === 'PasswordException' ? '此文件受密码保护，请下载原件后打开。' : '文件无法解析，请下载原件查看。');
    });
    return () => { active = false; void task?.destroy(); };
  }, [bytes]);
  if (error) return <Alert type="warning" title={error} />;
  if (!pdf) return <Spin aria-label="正在加载文档" />;
  return <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 8 }}>
      <span>共 {pdf.numPages} 页</span>
      {pdf.numPages > 1 && <Pagination simple current={number} total={pdf.numPages} pageSize={1} showSizeChanger={false} onChange={setNumber} />}
    </div>
    <div style={{ overflow: 'auto', maxHeight: '63vh' }} key={number}><Page pdf={pdf} number={number} name={name} /></div>
  </>;
}
