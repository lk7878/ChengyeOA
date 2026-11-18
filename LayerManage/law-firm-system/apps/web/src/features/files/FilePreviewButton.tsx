import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Spin } from 'antd';
import Modal from '@/components/DraggableModal';
import { inPreviewFrame } from '@/features/authorization/preview-frame';
import { authenticatedFetch } from '../workspaces/api';

function decodeText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

async function readingPage(text: string, markdown: boolean) {
  const html = markdown ? (await import('marked')).marked.parse(text, { async: false }) : text;
  const template = document.createElement('template');
  template.innerHTML = html;
  // Uploaded pages may use local embedded figures. Never load linked resources from the reader's browser.
  for (const image of template.content.querySelectorAll('img')) {
    if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(image.getAttribute('src') || '')) image.removeAttribute('src');
  }
  const purifier = (await import('dompurify')).default;
  const body = purifier.sanitize(template.content, {
    ALLOWED_TAGS: ['p','br','div','span','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','strong','em','b','i','u','del','hr','table','caption','thead','tbody','tfoot','tr','td','th','img','sup','sub','figure','figcaption','dl','dt','dd'],
    ALLOWED_ATTR: ['colspan','rowspan','alt','src'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:16px/1.7 system-ui,sans-serif;overflow-wrap:anywhere;margin:20px}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}pre{white-space:pre-wrap}</style><body>${body}</body>`;
}

const errors: Record<string, string> = {
  FILE_PREVIEW_UNSUPPORTED: '此格式暂不支持在线预览。',
  FILE_PREVIEW_TOO_LARGE: '文件超过在线预览容量，可下载原件查看。',
  FILE_PREVIEW_BUSY: '正在转换其他文件，请稍后重试。',
  FILE_PREVIEW_CONVERTER_UNAVAILABLE: 'Office 预览服务暂不可用，可下载原件查看。',
  FILE_PREVIEW_CONVERSION_FAILED: '无法生成预览，请检查文件是否加密、损坏或过于复杂。',
};

function Preview({ url, name }: { url: string; name: string }) {
  const [content, setContent] = useState<ReactNode>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      const response = await authenticatedFetch(url + (url.includes('?') ? '&' : '?') + 'preview=1', controller.signal);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(errors[body.message] || ([401, 403, 404].includes(response.status) ? '文件不存在或当前账号没有阅读权限。' : '预览加载失败，请重新打开。'));
      }
      const format = response.headers.get('X-OA-Preview') || '';
      const style = { width: '100%', height: '68vh', border: 0, background: '#fff' };
      let view: ReactNode;
      if (['text', 'markdown', 'html'].includes(format)) {
        const text = decodeText(await response.arrayBuffer());
        view = format === 'text'
          ? <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{text || '空文件'}</pre>
          : <iframe sandbox="" referrerPolicy="no-referrer" title={name} srcDoc={await readingPage(text, format === 'markdown')} style={style} />;
      } else {
        if (!['pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'].includes(format)) throw new Error('服务未返回可用的文件预览。');
        const blob = await response.blob();
        if (format === 'pdf' && !(await blob.slice(0, 1024).text()).includes('%PDF-')) throw new Error('PDF 文件内容无效。');
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob.slice(0, blob.size, format === 'pdf' ? 'application/pdf' : format));
        view = format === 'pdf' ? <iframe title={name} src={objectUrl} style={style} />
          : <img alt={name} src={objectUrl} style={{ display: 'block', maxWidth: '100%', maxHeight: '68vh', margin: 'auto' }} onError={() => setError('无法显示此图片，请下载原件查看。')} />;
      }
      if (!controller.signal.aborted) setContent(view);
    }
    void load().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '文件预览失败。'); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, name]);
  return <div style={{ maxHeight: '72vh', overflow: 'auto' }}>{error ? <Alert type="warning" showIcon title={error} /> : content || <Spin aria-label="正在加载文件预览" />}</div>;
}

export default function FilePreviewButton({ url, name, children = '预览', link = false }: { url: string; name: string; children?: ReactNode; link?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type={link ? 'link' : 'default'} disabled={inPreviewFrame} title={inPreviewFrame ? '权限模拟中无法读取文件内容' : '在线预览'} onClick={() => setOpen(true)} style={link ? { maxWidth: '100%', whiteSpace: 'normal', height: 'auto', overflowWrap: 'anywhere' } : undefined}>{children}</Button>
    {open && <Modal open title={'预览 · ' + name} footer={null} width={1000} onCancel={() => setOpen(false)}>
      <Preview key={url + name} url={url} name={name} />
    </Modal>}
  </>;
}
