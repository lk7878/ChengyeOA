import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const children = new Set();

/** Native KnowledgeController OCR seam, supervised stdio instead of HTTP. */
export class LocalPaddleOcrClient {
  constructor() { this.children = new Set(); this.closed = false; }
  async recognize(image, pageNumber) {
    if (this.closed) throw new Error('OCR 服务已关闭');
    if (!process.env.CHENGYE_OCR_PYTHON || !process.env.CHENGYE_OCR_MODEL_CACHE) throw Object.assign(new Error('云端 OCR 未配置，请联系系统管理员配置 Python 环境及模型目录'), { code: 'OCR_UNCONFIGURED' });
    if (!image.length || image.length > 15000000) throw new Error('OCR 图片超出大小限制');
    if (children.size >= 2) throw Object.assign(new Error('OCR 正在处理其他资料，请稍后重试'), { code: 'OCR_BUSY' });
    return new Promise((resolve, reject) => {
      const child = spawn(process.env.CHENGYE_OCR_PYTHON, [fileURLToPath(new URL('./ocr_stdio.py', import.meta.url))], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP,
          PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', PADDLE_PDX_CACHE_HOME: process.env.CHENGYE_OCR_MODEL_CACHE,
          CHENGYE_OCR_DEVICE: process.env.CHENGYE_OCR_DEVICE || 'cpu' },
      });
      this.children.add(child); children.add(child); let output = ''; let failure;
      const timer = setTimeout(() => { failure = new Error('云端 OCR 处理超时'); child.kill(); }, 300000);
      child.stdout.on('data', bytes => { output += bytes.toString(); if (output.length > 10000000) { failure = new Error('OCR 结果超出大小限制'); child.kill(); } });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.once('error', () => { failure = new Error('无法启动云端 OCR，请联系管理员检查环境'); });
      child.once('close', code => {
        clearTimeout(timer); this.children.delete(child); children.delete(child);
        if (failure) { reject(failure); return; }
        try {
          const value = JSON.parse(output);
          if (code !== 0 || !value.ok || typeof value.result?.text !== 'string' || !Array.isArray(value.result.blocks)) throw new Error();
          resolve(value.result);
        } catch { reject(new Error('云端 OCR 未完成，请联系管理员检查模型环境')); }
      });
      child.stdin.end(JSON.stringify({ imageBase64: Buffer.from(image).toString('base64'), pageNumber }));
    });
  }
  close() { this.closed = true; for (const child of this.children) child.kill(); }
}
