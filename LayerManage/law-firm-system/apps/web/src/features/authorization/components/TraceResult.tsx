import { businessLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { Descriptions, Empty, Tag } from 'antd';
import type { PermissionTraceView } from '../types';

export default function TraceResult({ trace }: { trace: PermissionTraceView | null }) {
  if (!trace) return <Empty description="请选择条件查询权限来源" />;
  return <div className="auth-trace-result">
    <Descriptions size="small" column={{ xs: 1, md: 3 }} items={[
      { key: 'result', label: '判定', children: <Tag color={trace.allowed ? 'success' : 'error'}>{trace.allowed ? '允许' : '拒绝'}</Tag> },
      { key: 'permission', label: '权限代码', children: trace.permissionCode ?? '全部有效权限' },
      { key: 'refusal', label: '拒绝原因', children: trace.refusalCode ?? '-' },
      { key: 'evaluated', label: '计算时间', children: new Date(trace.evaluatedAt).toLocaleString() },
    ]} />
    <h3>权限来源</h3>
    <Table rowKey={row => `${row.sourceType}:${row.sourceId}:${row.permissionCode}`} size="small" pagination={false} dataSource={trace.sources} columns={[
      { title: '来源', dataIndex: 'sourceType', render: value => <Tag>{businessLabel(value)}</Tag> },
      { title: '权限', dataIndex: 'permissionCode' },
      { title: '数据范围', dataIndex: 'scopeTypes', render: (values: string[]) => values.length ? values.map(value => <Tag key={value}>{businessLabel(value)}</Tag>) : '-' },
      { title: '有效期至', dataIndex: 'validUntil', render: (value: string | null) => value ? new Date(value).toLocaleString() : '长期' },
    ]} />
    <h3>字段能力</h3>
    <Table rowKey={row => `${row.sourceRoleId}:${row.fieldCode}`} size="small" pagination={false} dataSource={trace.fieldCapabilities} columns={[
      { title: '字段', dataIndex: 'fieldCode' },
      { title: '读取', dataIndex: 'readLevel', render: value => <Tag color={value === 'NONE' ? 'error' : value === 'MASKED' ? 'warning' : 'success'}>{businessLabel(value)}</Tag> },
      { title: '写入', dataIndex: 'canWrite', render: value => value ? '允许' : '禁止' },
      { title: '导出', dataIndex: 'canExport', render: value => value ? '允许' : '禁止' },
    ]} />
  </div>;
}
