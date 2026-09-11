import Table from '@/components/ResizableTable';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
  Tag,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { useContractStore, type ContractListFilters } from '@/stores/contract-store';
import { useAuthStore } from '@/stores/authStore';
import {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  type ContractStatus,
  type ContractType,
  type ContractView,
} from '@/api/contract';
import { CONTRACT_STATUS_META, CONTRACT_TYPE_META } from './meta';

const ContractListPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    contracts, listTotal, listPage, listPageSize, listLoading, listError,
    fetchContracts, applyFilters,
  } = useContractStore();
  const canReadApproval = useAuthStore(s => s.hasPermission('approval.read'));
  const canCreate = useAuthStore(state => state.hasPermission('contract.create'));
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<ContractStatus | undefined>(undefined);
  const [contractType, setContractType] = useState<ContractType | undefined>(undefined);

  useEffect(() => {
    void fetchContracts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    const filters: ContractListFilters = {};
    if (keyword.trim()) filters.keyword = keyword.trim();
    if (status) filters.status = status;
    if (contractType) filters.contractType = contractType;
    void applyFilters(filters);
  };

  const handleReset = () => {
    setKeyword('');
    setStatus(undefined);
    setContractType(undefined);
    void applyFilters({});
  };

  const columns = [
    { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', width: 160 },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: ContractView) => (
        <Button type="link" size="small" onClick={() => navigate(`/contracts/${record.id}`)}>{title}</Button>
      ),
    },
    {
      title: '类型',
      dataIndex: 'contractType',
      key: 'contractType',
      width: 110,
      render: (value: ContractType) => {
        const meta = CONTRACT_TYPE_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: ContractStatus) => {
        const meta = CONTRACT_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    // 金额为 toFixed(2) 字符串投影，直接渲染（非 L3 不脱敏）。
    { title: '合同金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const },
    { title: '已收金额', dataIndex: 'receivedAmount', key: 'receivedAmount', width: 120, align: 'right' as const },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: ContractView) => (
        <Button type="link" size="small" onClick={() => navigate(`/contracts/${record.id}`)}>详情</Button>
      ),
    },
  ];

  return (
    <div>
      {canReadApproval && <p><a href="/approval-ledger?target=CONTRACT_CHANGE">已通过的合同变更台账</a></p>}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col flex="auto">
            <Space wrap>
              <Input
                placeholder="搜索合同编号/标题"
                value={keyword}
                onChange={event => setKeyword(event.target.value)}
                onPressEnter={handleSearch}
                prefix={<SearchOutlined />}
                style={{ width: 200 }}
                allowClear
              />
              <Select
                aria-label="类型筛选"
                placeholder="类型筛选"
                value={contractType}
                onChange={value => setContractType(value)}
                style={{ width: 130 }}
                allowClear
                options={CONTRACT_TYPES.map(value => ({ value, label: CONTRACT_TYPE_META[value].text }))}
              />
              <Select
                aria-label="状态筛选"
                placeholder="状态筛选"
                value={status}
                onChange={value => setStatus(value)}
                style={{ width: 130 }}
                allowClear
                options={CONTRACT_STATUSES.map(value => ({ value, label: CONTRACT_STATUS_META[value].text }))}
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          {canCreate && (
            <Col>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/contracts/new')}>新建合同</Button>
            </Col>
          )}
        </Row>
      </Card>

      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="合同列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<ContractView>
        columns={columns}
        dataSource={contracts}
        rowKey="id"
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无合同' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchContracts(page, pageSize),
        }}
      />
    </div>
  );
};

export default ContractListPage;
