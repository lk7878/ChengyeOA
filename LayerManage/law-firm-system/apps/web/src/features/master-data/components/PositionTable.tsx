import { EditOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Position } from '../types';

export default function PositionTable({ data, loading, onEdit, onToggle, onRetry }: { data: Position[]; loading: boolean; onEdit: (position: Position) => void; onToggle: (position: Position) => void; onRetry: () => void }) {
  const columns: ColumnsType<Position> = [
    { title: '编码', dataIndex: 'code', width: 140 }, { title: '岗位名称', dataIndex: 'name' },
    { title: '分类', dataIndex: 'categoryCode', width: 140 }, { title: '级别', dataIndex: 'level', width: 80 },
    { title: '在任人数', dataIndex: 'activeAssignmentCount', width: 100 },
    { title: '状态', dataIndex: 'status', width: 90, render: value => <Tag color={value === 'ENABLED' ? 'green' : 'default'}>{value === 'ENABLED' ? '启用' : '停用'}</Tag> },
    { title: '操作', width: 130, render: (_, item) => <span className="md-row-actions"><Tooltip title="编辑"><Button aria-label={`编辑${item.name}`} icon={<EditOutlined />} onClick={() => onEdit(item)} /></Tooltip><Popconfirm title={`确认${item.status === 'ENABLED' ? '停用' : '启用'}该岗位？`} onConfirm={() => onToggle(item)}><Button>{item.status === 'ENABLED' ? '停用' : '启用'}</Button></Popconfirm></span> },
  ];
  return <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={data} pagination={false} locale={{ emptyText: <div className="md-empty"><span>暂无岗位</span><Button onClick={onRetry}>重试</Button></div> }} scroll={{ x: 760 }} />;
}
