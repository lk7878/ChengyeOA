import { Button, message } from 'antd';
import DraggableModal from '@/components/DraggableModal';
import type { Instance, Option } from './api';
import { approvalPrintHtml, printStyles } from './print-format';

export default function ApprovalPrint({
  instance,
  users,
  printer,
  onClose,
}: {
  instance?: Instance;
  users: Option[];
  printer: string;
  onClose: () => void;
}) {
  const html = instance ? approvalPrintHtml(instance, users, printer) : '';
  return (
    <DraggableModal
      title="审批单打印预览"
      open={!!instance}
      width={950}
      onCancel={onClose}
      footer={
        <Button
          type="primary"
          onClick={() => {
            const win = window.open('', '_blank', 'width=1000,height=800');
            if (!win) {
              message.error('请允许打开打印窗口');
              return;
            }
            win.opener = null;
            win.document.write(
              `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>审批单</title><style>${printStyles}</style></head><body>${html}</body></html>`,
            );
            win.document.close();
            void win.document.fonts.ready.then(() => {
              win.focus();
              win.print();
            });
          }}
        >
          打印 / 保存为PDF
        </Button>
      }
    >
      <div className="wf-print-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </DraggableModal>
  );
}
