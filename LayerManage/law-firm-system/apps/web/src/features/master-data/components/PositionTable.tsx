import { categoryLabel, positionCodeLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { EditOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Position } from '../types';

export default function PositionTable({ data, loading, onEdit, onToggle, onRetry, onDelete }: { data: Position[]; loading: boolean; onEdit: (position: Position) => void; onToggle: (position: Position) => void; onRetry: () => void; onDelete?: (position: Position) => void }) {
  const columns: ColumnsType<Position> = [
    { title: '岗位编码', dataIndex: 'code', width: 200, render: (code, position) => <Tooltip title={`内部编码：${code}`}><span>{positionCodeLabel(code, position.name)}</span></Tooltip> }, { title: '岗位名称', dataIndex: 'name' },
    { title: '岗位分类', dataIndex: 'categoryCode', width: 160, render: code => <Tooltip title={`分类编码：${code}`}><span>{categoryLabel(code)}</span></Tooltip> }, { title: '级别', dataIndex: 'level', width: 80 },
    { title: '在任人数', dataIndex: 'activeAssignmentCount', width: 100 },
    { title: '状态', dataIndex: 'status', width: 90, render: value => <Tag color={value === 'ENABLED' ? 'green' : 'default'}>{value === 'ENABLED' ? '启用' : '停用'}</Tag> },
    { title: '操作', width: onDelete ? 210 : 130, render: (_, item) => <span className="md-row-actions"><Tooltip title="编辑"><Button aria-label={`编辑${item.name}`} icon={<EditOutlined />} onClick={() => onEdit(item)} /></Tooltip><Popconfirm title={`确认${item.status === 'ENABLED' ? '停用' : '启用'}该岗位？`} onConfirm={() => onToggle(item)}><Button>{item.status === 'ENABLED' ? '停用' : '启用'}</Button></Popconfirm>{onDelete && <Button danger aria-label={`删除${item.name}`} onClick={() => onDelete(item)}>删除</Button>}</span> },
  ];
  return <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={data} pagination={false} locale={{ emptyText: <div className="md-empty"><span>暂无岗位</span><Button onClick={onRetry}>重试</Button></div> }} scroll={{ x: 760 }} />;
}
