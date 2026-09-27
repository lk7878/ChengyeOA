import { categoryLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { EditOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Organization, Position } from '../types';

export default function PositionTable({ data, organizations = [], loading, onEdit, onToggle, onRetry, onDelete }: { organizations?: Organization[]; data: Position[]; loading: boolean; onEdit: (position: Position) => void; onToggle: (position: Position) => void; onRetry: () => void; onDelete?: (position: Position) => void }) {
  function branchName(id: string) { const org = organizations.find(item => item.id === id); return organizations.filter(item => ['FIRM', 'BRANCH'].includes(item.type) && (item.id === id || org?.path.startsWith(item.path + '/'))).sort((a,b) => b.level-a.level)[0]?.name ?? '—'; }
  const columns: ColumnsType<Position> = [
    { title: '所属分所', dataIndex: 'organizationId', render: branchName }, { title: '所属部门', dataIndex: 'organizationId', render: id => { const org = organizations.find(item => item.id === id); return org && !['FIRM', 'BRANCH'].includes(org.type) ? org.name : '—'; } }, { title: '岗位编号', dataIndex: 'code', width: 200 }, { title: '岗位名称', dataIndex: 'name' },
    { title: '岗位分类', dataIndex: 'categoryCode', width: 160, render: code => <Tooltip title={`分类编码：${code}`}><span>{categoryLabel(code)}</span></Tooltip> }, { title: '级别', dataIndex: 'level', width: 80 },
    { title: '在任人数', dataIndex: 'activeAssignmentCount', width: 100 },
    { title: '状态', dataIndex: 'status', width: 90, render: value => <Tag color={value === 'ENABLED' ? 'green' : 'default'}>{value === 'ENABLED' ? '启用' : '停用'}</Tag> },
    { title: '操作', width: onDelete ? 210 : 130, render: (_, item) => <span className="md-row-actions"><Tooltip title="编辑"><Button aria-label={`编辑${item.name}`} icon={<EditOutlined />} onClick={() => onEdit(item)} /></Tooltip><Popconfirm title={`确认${item.status === 'ENABLED' ? '停用' : '启用'}该岗位？`} onConfirm={() => onToggle(item)}><Button>{item.status === 'ENABLED' ? '停用' : '启用'}</Button></Popconfirm>{onDelete && <Button danger aria-label={`删除${item.name}`} onClick={() => onDelete(item)}>删除</Button>}</span> },
  ];
  return <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={data} pagination={false} locale={{ emptyText: <div className="md-empty"><span>暂无岗位</span><Button onClick={onRetry}>重试</Button></div> }} scroll={{ x: 760 }} />;
}
