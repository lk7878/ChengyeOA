import { useState } from 'react';
import { Alert, Button, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { customerApi } from '@/api/customer';
import { requestErrorMessage } from '@/api/errors';
import type { CustomerView } from '@/api/types';

export default function CustomerDeleteButton({ customer, onDeleted }: {
  customer: CustomerView;
  onDeleted: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await customerApi.remove(customer.id, customer.version);
      message.success('客户已删除');
      setOpen(false);
      await onDeleted();
    } catch (reason) {
      setError(requestErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <Button type="link" size="small" danger onClick={() => { setError(null); setOpen(true); }}>删除</Button>
    <Modal title="删除客户" open={open} onCancel={() => { if (!busy) setOpen(false); }}
      onOk={() => void remove()} okText="确认删除" okButtonProps={{ danger: true }}
      cancelButtonProps={{ disabled: busy }} confirmLoading={busy} mask={{ closable: false }} destroyOnHidden>
      <p>确认删除客户“{customer.name}”（{customer.customerNo}）？</p>
      <p>删除后将从客户列表中移除。已关联业务记录的客户无法删除。</p>
      {error && <Alert role="alert" type="error" showIcon title={error} />}
    </Modal>
  </>;
}
