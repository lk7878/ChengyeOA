import React from 'react';
import { createRoot } from 'react-dom/client';
import OfficeEditor from '../src/pages/approvals/materials/OfficeEditor';
import '../src/pages/approvals/materials/materials.css';
declare global {
  interface Window {
    mountApprovalEditor: (fileName: string, base64: string) => void;
    savedApprovalFile?: { fileName: string; base64: string };
  }
}
const root = createRoot(document.getElementById('root')!);
window.mountApprovalEditor = (fileName, base64) => root.render(<OfficeEditor
  bytes={Uint8Array.from(atob(base64), char => char.charCodeAt(0)).buffer} fileName={fileName} readOnly={false} onDirty={() => {}}
  onSave={async file => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    window.savedApprovalFile = { fileName: file.name, base64: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) };
  }}
/>);
