import { useState } from 'react';
import { Button, Table, Alert } from 'antd';
import Modal from '@/components/DraggableModal';
import { formatMoney, formatBusinessDate } from '@/utils/business-format';
import AttachmentItem from './AttachmentItem';

interface Receipt {
  id: string;
  number: string;
  amount: string;
  paidAt: string | null;
  invoiceNo: string | null;
  invoiceStatus: string;
  files?: string[];
}
export default function ReceiptDetails({ value, tableId }: { value: unknown; tableId: string }) {
  const [open, setOpen] = useState(false);
  const rows = (Array.isArray(value) ? value : []) as Receipt[];
  return (
    <>
      <Button type="link" onClick={() => setOpen(true)} title="财务数据仅限财务部录入，此处为自动同步">
        {rows.length} 笔收款 · 查看明细
      </Button>
      <Modal title="收款明细" open={open} onCancel={() => setOpen(false)} footer={null} width={1000}>
        <Alert
          type="info"
          title="财务数据仅限财务部录入，此处为自动同步"
          description="按收款时间展示已确认的历史到账记录。累计收款为历史到账总额，退款另行展示。开票状态和号码取自关联合同的已完成发票，不代表该笔收款已逐笔核销。"
        />
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '收款流水号', dataIndex: 'number' },
            { title: '收款时间', dataIndex: 'paidAt', render: (value) => formatBusinessDate(value) },
            { title: '收款金额', dataIndex: 'amount', render: (value) => formatMoney(value) + ' 元' },
            { title: '合同发票号码', dataIndex: 'invoiceNo' },
            {
              title: '合同开票状态',
              dataIndex: 'invoiceStatus',
              render: (value) => (value === 'ISSUED' ? '已开票' : '未开票'),
            },
            {
              title: '凭证',
              render: (_, row) => (
                <>
                  {row.files?.map((id) => (
                    <AttachmentItem key={id} tableId={tableId} id={id} />
                  ))}
                </>
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
}
