import Table from '@/components/ResizableTable';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Popconfirm,
  Row,
  Space,
  Tabs,
  Tag,
  message,
} from 'antd';
import { SearchOutlined, UserAddOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { useLeadStore } from '@/stores/lead-store';
import type { LeadStatus, LeadView, PoolStatus } from '@/api/types';
import { LEAD_STATUS_META, SOURCE_TYPE_META, intentionStars } from './meta';

const PublicPoolPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    poolLeads, poolTotal, poolPage, poolPageSize, poolStatus, poolLoading, poolError,
    fetchPool, applyPoolStatus, applyPoolKeyword, claimLead,
  } = useLeadStore();
  const [keyword, setKeyword] = useState('');
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    void fetchPool(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClaim = async (leadId: string) => {
    setClaimingId(leadId);
    try {
      const ok = await claimLead(leadId);
      if (ok) message.success('领取成功，线索已转入你的私海');
    } finally {
      setClaimingId(null);
    }
  };

  const columns = [
    { title: '线索编号', dataIndex: 'leadNo', key: 'leadNo', width: 140 },
    { title: '姓名', dataIndex: 'name', key: 'name' },
    // L3 字段：服务端预脱敏，原样渲染。
    { title: '电话', dataIndex: 'phone', key: 'phone', render: (value: string | null) => value ?? '-' },
    {
      title: '意向',
      dataIndex: 'intentionLevel',
      key: 'intentionLevel',
      width: 110,
      render: (level: number) => intentionStars(level),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: LeadStatus) => {
        const meta = LEAD_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '来源',
      dataIndex: 'sourceType',
      key: 'sourceType',
      width: 100,
      render: (value: string) => SOURCE_TYPE_META[value as keyof typeof SOURCE_TYPE_META] ?? value,
    },
    {
      title: '进入时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: unknown, record: LeadView) => (
        <Space size="small">
          <Popconfirm
            title="确认领取该线索？"
            okText="确定"
            cancelText="取消"
            onConfirm={() => void handleClaim(record.id)}
          >
            <Button type="link" size="small" icon={<UserAddOutlined />} loading={claimingId === record.id}>
              领取
            </Button>
          </Popconfirm>
          <Button type="link" size="small" onClick={() => navigate(`/leads/${record.id}`)}>详情</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Tabs
          activeKey={poolStatus}
          onChange={key => void applyPoolStatus(key as PoolStatus)}
          items={[
            { key: 'PUBLIC', label: '公海' },
            { key: 'RECYCLED', label: '回收池' },
          ]}
        />
        <Row gutter={[16, 12]}>
          <Col flex="auto">
            <Space wrap>
              <Input
                placeholder="搜索姓名/电话/编号"
                value={keyword}
                onChange={event => setKeyword(event.target.value)}
                onPressEnter={() => void applyPoolKeyword(keyword.trim())}
                prefix={<SearchOutlined />}
                style={{ width: 220 }}
                allowClear
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={() => void applyPoolKeyword(keyword.trim())}>
                搜索
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {poolError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="公海列表加载失败"
          description={poolError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<LeadView>
        columns={columns}
        dataSource={poolLeads}
        rowKey="id"
        loading={poolLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无可领取线索' }}
        pagination={{
          current: poolPage,
          pageSize: poolPageSize,
          total: poolTotal,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchPool(page, pageSize),
        }}
      />
    </div>
  );
};

export default PublicPoolPage;
