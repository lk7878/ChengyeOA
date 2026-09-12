import mammoth from '../../../third_party/deepseek-harness/packages/product/product-knowledge/node_modules/mammoth/mammoth.browser.js';
export default {
  extractRawText({ buffer }: { buffer: Uint8Array }) {
    return mammoth.extractRawText({ arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) });
  },
};
