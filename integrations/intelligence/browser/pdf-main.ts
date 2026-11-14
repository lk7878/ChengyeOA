import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;

/** Browser implementation of the small PDFParse surface used by Harness. */
export class PDFParse {
  private task;
  constructor({ data }: { data: Uint8Array }) {
    this.task = getDocument({ data: new Uint8Array(data), isEvalSupported: false,
      cMapUrl: new URL('./pdf/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('./pdf/standard_fonts/', import.meta.url).href,
      wasmUrl: new URL('./pdf/wasm/', import.meta.url).href });
  }
  async getText() {
    const document = await this.task.promise;
    if (document.numPages > 200) throw new Error('PDF 超过 200 页，请拆分后导入');
    const pages = [];
    for (let num = 1; num <= document.numPages; num++) {
      const page = await document.getPage(num);
      const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
      pages.push({ num, text }); page.cleanup();
    }
    return { total: document.numPages, pages };
  }
  async getScreenshot({ partial, desiredWidth }: { partial: number[]; desiredWidth: number }) {
    const document = await this.task.promise; const pages = [];
    for (const pageNumber of partial) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(desiredWidth, 4000) / base.width });
      if (viewport.width * viewport.height > 32_000_000) throw new Error('PDF 页面图片过大');
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器不支持 PDF 渲染');
      await page.render({ canvas: canvas as any, canvasContext: context as any, viewport }).promise;
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      pages.push({ pageNumber, data: new Uint8Array(await blob.arrayBuffer()) }); page.cleanup();
    }
    return { pages };
  }
  async destroy() { await this.task.destroy(); }
}
