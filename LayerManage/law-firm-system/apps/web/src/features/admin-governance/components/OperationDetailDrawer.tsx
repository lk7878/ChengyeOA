import { businessLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { Alert, Descriptions, Drawer, Empty, Spin, Tag, Timeline, Typography } from 'antd';
import type { AdminOperationDetail } from '../types';
import { OPERATION_LABELS } from '../form-rules';

const { Text } = Typography;
type Props = { open: boolean; loading: boolean; error: boolean; detail: AdminOperationDetail | null; onClose: () => void; onReload: () => void };

function json(value: unknown) {
  return <pre className="governance-json">{value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}</pre>;
}

export default function OperationDetailDrawer({ open, loading, error, detail, onClose, onReload }: Props) {
  return <Drawer title={<span id="governance-detail-title">{detail ? `治理详情 · ${detail.operationNo}` : '治理详情'}</span>} aria-labelledby="governance-detail-title" open={open} onClose={onClose} size="large" className="governance-drawer" destroyOnHidden>
    <Spin spinning={loading}>
      {error && <Alert type="error" showIcon title="治理详情加载失败" action={<button className="governance-link-button" onClick={onReload}>重新加载</button>} />}
      {!loading && !error && !detail && <Empty description="暂无详情" />}
      {detail && <>
        <Descriptions size="small" column={1} items={[
          { key: 'no', label: '申请编号', children: <Text copyable>{detail.operationNo}</Text> },
          { key: 'type', label: '治理操作', children: OPERATION_LABELS[detail.operationType] },
          { key: 'status', label: '状态', children: <Tag>{businessLabel(detail.status)}</Tag> },
          { key: 'risk', label: '风险', children: <Tag>{businessLabel(detail.riskLevel)}</Tag> },
          { key: 'requester', label: '申请人', children: detail.requesterUserId },
          { key: 'target', label: '目标', children: `${businessLabel(detail.targetType)} · ${detail.targetId}` },
          { key: 'reason', label: '申请理由', children: detail.reason },
          { key: 'payload', label: '不可变参数快照', children: json(detail.payloadSnapshot) },
        ]} />
        <h3>审核记录</h3>
        {detail.reviews.length ? <Timeline items={detail.reviews.map(review => ({ children: <><strong>{businessLabel(review.decision)}</strong> · {review.reviewerUserId}<br /><Text type="secondary">{review.comment || '无附加意见'} · {new Date(review.createdAt).toLocaleString()}</Text></> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审核记录" />}
        <h3>执行轨迹</h3>
        {detail.executions.length ? <Table size="small" rowKey="id" pagination={false} scroll={{ x: 760 }} dataSource={detail.executions} columns={[
          { title: '次数', dataIndex: 'attemptNo', width: 64 }, { title: '状态', dataIndex: 'status', width: 100, render: value => <Tag>{businessLabel(value)}</Tag> },
          { title: '结果码', dataIndex: 'resultCode', width: 190, render: value => value || '—' },
          { title: '错误', dataIndex: 'errorMessage', width: 180, render: value => value || '—' },
          { title: '执行前', dataIndex: 'beforeSnapshot', width: 220, render: json },
          { title: '执行后', dataIndex: 'afterSnapshot', width: 220, render: json },
        ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未执行" />}
      </>}
    </Spin>
  </Drawer>;
}
