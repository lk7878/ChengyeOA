import { useState } from 'react';
import { Button, Drawer, Input, message, Space } from 'antd';
import { EyeOutlined, LockOutlined } from '@ant-design/icons';
import { masterDataApi } from '../api';

interface Props { employeeId: string; allowed: boolean }

export default function SensitiveEmployeeFields({ employeeId, allowed }: Props) {
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!allowed) return <span>无权查看</span>;

  const close = () => {
    setOpen(false);
    setPurpose('');
    setValue(null);
    setLoading(false);
  };

  const reveal = async () => {
    if (purpose.trim().length < 10) return;
    setLoading(true);
    try {
      const response = await masterDataApi.employees.viewSensitive(employeeId, ['employee.idCard'], purpose.trim());
      setValue(response.data['employee.idCard']);
    } catch {
      setValue(null);
      message.error('敏感信息查看失败或已被拒绝');
    } finally { setLoading(false); }
  };

  return <>
    <Button size="small" icon={<EyeOutlined />} aria-label="查看完整身份证号" onClick={() => setOpen(true)}>查看完整身份证号</Button>
    <Drawer open={open} title={<Space><LockOutlined />高敏感信息查看</Space>} closable={false} onClose={close} size="default" destroyOnHidden>
      <div className="auth-editor-section">
        <p>本次查看会记录人员、用途、时间和字段。原始值仅在此抽屉中临时展示。</p>
        <label htmlFor="sensitive-purpose">查看用途</label>
        <Input.TextArea id="sensitive-purpose" aria-label="查看用途" value={purpose} onChange={event => setPurpose(event.target.value)} rows={3} maxLength={200} placeholder="请填写具体业务用途，至少 10 个字符" />
        <Button type="primary" loading={loading} disabled={purpose.trim().length < 10} onClick={() => void reveal()}>确认查看</Button>
        {value !== null && <div><strong>身份证号</strong><div><code>{value}</code></div></div>}
        <Button aria-label="关闭敏感信息" onClick={close}>关闭</Button>
      </div>
    </Drawer>
  </>;
}
