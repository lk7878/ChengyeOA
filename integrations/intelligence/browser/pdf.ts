import { hostCall } from './host-bridge';

/** The SQLite worker delegates PDF.js's DOM-dependent coordinator to this
 * browser page; bytes stay on the lawyer's computer. */
export class PDFParse {
  private id = crypto.randomUUID();
  private ready: Promise<unknown>;
  constructor({ data }: { data: Uint8Array }) { this.ready = hostCall('pdf.open', { id: this.id, data }); }
  async getText() { await this.ready; return hostCall('pdf.text', { id: this.id }); }
  async getScreenshot(options: { partial: number[]; desiredWidth: number }) { await this.ready; return hostCall('pdf.screenshot', { id: this.id, options }); }
  async destroy() { await this.ready.catch(() => {}); await hostCall('pdf.close', { id: this.id }); }
}
