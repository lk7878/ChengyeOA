import { Button, Select, Space, Tag } from 'antd';
import type { EmployeeDetail } from '../types';
import type { SelectOption } from './EmployeeForm';

interface Props { account: EmployeeDetail['account']; users: SelectOption[]; selectedUserId?: string; onSelect: (id: string) => void; onBind: () => void; onUnbind: () => void }

export default function AccountBindingPanel({ account, users, selectedUserId, onSelect, onBind, onUnbind }: Props) {
  if (account) return <Space wrap><span>已绑定账号：<strong>{account.username}</strong></span><Tag>{account.status}</Tag><Button danger onClick={onUnbind}>解除绑定</Button></Space>;
  return <Space wrap><Select aria-label="待绑定账号" showSearch value={selectedUserId} options={users} onChange={onSelect} style={{ minWidth: 220 }} /><Button type="primary" disabled={!selectedUserId} onClick={onBind}>绑定账号</Button></Space>;
}
