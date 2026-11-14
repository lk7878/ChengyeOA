import Table from '@/components/ResizableTable';
// SPEC-011 Task 11: 财务异常台账列表页（FIN-05）。沿 PaymentListPage 形态（AntD 6 + store 模式）。
// 四 Tab（已签未收/已收未开票/首签未二签/收款未建案）各一列表（合同号/客户/金额/已收/
// 签署日/缺口额）+ 行点击跳 /contracts/:id。纯只读，零动作。
// received-uninvoiced 口径 total = 候选池 count（Task 9/10 已文档化）——分页条渲染按此语义
// （页内条数可 < pageSize）。
import React, { useEffect } from 'react';
import { Alert, Button, Tabs, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { useAnomalyStore, type AnomalyMode } from '@/stores/anomaly-store';
import type { AnomalyContractView } from '@/api/anomaly';
import { CONTRACT_STATUS_META, CONTRACT_TYPE_META } from '../contracts/meta';

const TAB_CONFIG: Array<{ key: AnomalyMode; label: string }> = [
  { key: 'signedUnpaid', label: '已签未收' },
  { key: 'receivedUninvoiced', label: '已收未开票' },
  { key: 'firstSignNoFormal', label: '首签未二签' },
  { key: 'paidNoCase', label: '收款未建案' },
];

const AnomalyListPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    mode, anomalies, listTotal, listPage, listPageSize, listLoading, listError,
    setMode, fetchAnomalies,
  } = useAnomalyStore();

  useEffect(() => {
    void fetchAnomalies(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = [
    {
      title: '合同号',
      dataIndex: 'contractNo',
      key: 'contractNo',
      width: 160,
      render: (value: string, record: AnomalyContractView) => (
        <Button type="link" size="small" onClick={() => navigate(`/contracts/${record.contractId}`)}>{value}</Button>
      ),
    },
    { title: '客户', dataIndex: 'customerId', key: 'customerId', width: 140 },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right' as const },
    { title: '已收', dataIndex: 'receivedAmount', key: 'receivedAmount', width: 110, align: 'right' as const },
    {
      title: '签署日',
      dataIndex: 'signDate',
      key: 'signDate',
      width: 120,
      render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD') : '-'),
    },
    {
      title: '类型',
      dataIndex: 'contractType',
      key: 'contractType',
      width: 110,
      render: (value: AnomalyContractView['contractType']) => {
        const meta = CONTRACT_TYPE_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: AnomalyContractView['status']) => {
        const meta = CONTRACT_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '缺口额',
      dataIndex: 'gapAmount',
      key: 'gapAmount',
      width: 120,
      align: 'right' as const,
      // gapAmount 仅 received-uninvoiced 口径非空，其余口径恒 null。
      render: (value: string | null) => (value ?? '-'),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={() => void fetchAnomalies(1)}>刷新</Button>
      </div>

      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="异常台账加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Tabs
        activeKey={mode}
        onChange={key => void setMode(key as AnomalyMode)}
        destroyInactiveTabPane
        items={TAB_CONFIG.map(tab => ({
          key: tab.key,
          label: tab.label,
          children: (
            <Table<AnomalyContractView>
              columns={columns}
              dataSource={anomalies}
              rowKey="contractId"
              loading={listLoading}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: '暂无异常合同' }}
              onRow={record => ({ onClick: () => navigate(`/contracts/${record.contractId}`), style: { cursor: 'pointer' } })}
              pagination={{
                current: listPage,
                pageSize: listPageSize,
                total: listTotal,
                showSizeChanger: true,
                showTotal: total => `共 ${total} 条`,
                onChange: (page, pageSize) => void fetchAnomalies(page, pageSize),
              }}
            />
          ),
        }))}
      />
    </div>
  );
};

export default AnomalyListPage;
