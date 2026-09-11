import Table from '@/components/ResizableTable';
// SPEC-033 Task 3 + SPEC-035 Task 2: 案件列表/详情页。
// SPEC-033：最小列表/详情 + 新建/结案（per 设计 D8）；任务/沟通详情只读展示。
// SPEC-035：补全任务/沟通交互——详情抽屉内任务新建 + 状态翻转（PENDING→IN_PROGRESS→COMPLETED）
// + 沟通新建（补全 D8 范围 OUT；后端端点 SPEC-033 已建）。
// 替代 SPEC-001 遗留原型（其依赖已根除的 DELETE /cases/:id 与嵌套 customer/lawyer 投影、
// 嵌套 pagination 形态——重建后端均不再提供）。
// 沿 CostListPage 形态：AntD 6 + useAuthStore 权限门控 + PagedResult 读取（res.data.list/total）。

import { useSearchParams } from 'react-router';
import { integrationApi } from '@/api/business-integration';
import { contractApi } from '@/api/contract';
import type { ContractView } from '@/api/contract';
import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  Timeline,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { caseApi } from '@/api/business';
import { customerApi } from '@/api/customer';
import { employeeApi } from '@/api/organization';
import { useAuthStore } from '@/stores/authStore';
import type { Case, CaseFile, CaseTask, Communication, Employee } from '@/types';
import type { CustomerView } from '@/api/types';

const STATUS_META: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待受理', color: 'blue' },
  ACCEPTED: { text: '已受理', color: 'cyan' },
  PROCESSING: { text: '办理中', color: 'orange' },
  CLOSED: { text: '已结案', color: 'green' },
  ARCHIVED: { text: '已归档', color: 'default' },
};

const PRIORITY_META: Record<string, { text: string; color: string }> = {
  LOW: { text: '低', color: 'default' },
  NORMAL: { text: '普通', color: 'blue' },
  HIGH: { text: '高', color: 'orange' },
  URGENT: { text: '紧急', color: 'red' },
};

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

// CaseTask nodeType 枚举（镜像后端 CASE_TASK_NODE_TYPES）。
const TASK_NODE_TYPES = [
  '立案准备', '材料收集', '立案提交', '开庭', '文书提交', '裁判反馈', '执行', '结案',
] as const;

// Communication type 枚举（镜像后端 CASE_COMMUNICATION_TYPES）。
const COMM_TYPES: Record<string, string> = {
  PHONE: '电话',
  MEETING: '会议',
  WECHAT: '微信',
  EMAIL: '邮件',
  OTHER: '其他',
};

const TASK_STATUS_META: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待办理', color: 'default' },
  IN_PROGRESS: { text: '办理中', color: 'processing' },
  COMPLETED: { text: '已完成', color: 'success' },
  OVERDUE: { text: '已逾期', color: 'error' },
};

interface CreateFormValues {
  title: string;
  customerId: string;
  lawyerId?: string;
  caseType: string;
  priority?: string;
  fee?: number;
  description?: string;
}

interface CloseFormValues {
  result?: string;
  satisfaction?: number;
}

interface CreateTaskFormValues {
  name: string;
  nodeType: string;
  dueDate?: dayjs.Dayjs;
  remark?: string;
}

interface CreateCommFormValues {
  type: string;
  content: string;
  isKey?: boolean;
}

const CasePage: React.FC = () => {
  const canCreate = useAuthStore(state => state.hasPermission('case.create'));
  const canClose = useAuthStore(state => state.hasPermission('case.close'));
  const canTask = useAuthStore(state => state.hasPermission('case.task.manage'));
  const canCommunicate = useAuthStore(state => state.hasPermission('case.communication.create'));

  const [data, setData] = useState<Case[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [searchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get('caseNo') || '');
  const [binding, setBinding] = useState<Case>();
  const [financeContracts, setFinanceContracts] = useState<ContractView[]>([]);
  const [financeContractId, setFinanceContractId] = useState<string>();
  const [bindingBusy, setBindingBusy] = useState(false);
  const canBindFinance = useAuthStore(s => s.hasPermission('case.update') && s.hasPermission('contract.read'));
  const [status, setStatus] = useState<string | undefined>(undefined);

  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createForm] = Form.useForm<CreateFormValues>();

  const [closeOpen, setCloseOpen] = useState(false);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeForm] = Form.useForm<CloseFormValues>();

  const [taskOpen, setTaskOpen] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [taskForm] = Form.useForm<CreateTaskFormValues>();

  const [commOpen, setCommOpen] = useState(false);
  const [commSubmitting, setCommSubmitting] = useState(false);
  const [commForm] = Form.useForm<CreateCommFormValues>();

  const [detail, setDetail] = useState<Case | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchList = async (nextPage = page, nextSize = pageSize) => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = { page: nextPage, pageSize: nextSize };
      if (keyword) params.keyword = keyword;
      if (status) params.status = status;
      const res = await caseApi.list(params);
      setData(res.data.list);
      setTotal(res.data.total);
      setPage(res.data.page);
      setPageSize(res.data.pageSize);
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setLoading(false);
    }
  };

  // 锚点映射数据：客户/主办律师下拉 + 详情名称映射，懒加载一次。
  useEffect(() => {
    // 首屏加载推迟到微任务：避免 effect 体内同步 setState（react-hooks/set-state-in-effect 纪律，沿 NegotiationListPage 先例）。
    void Promise.resolve().then(() => {
      void fetchList(1, pageSize);
      customerApi.list({ page: 1, pageSize: 100 })
        .then(res => setCustomers(res.data.list ?? []))
        .catch(() => undefined);
      employeeApi.list({ page: 1, pageSize: 100 })
        .then(res => setEmployees(res.data.list ?? []))
        .catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => { void fetchList(1, pageSize); };
  const handleReset = () => { setKeyword(''); setStatus(undefined); void fetchList(1, pageSize); };

  const openDetail = async (record: Case) => {
    setDetail(null);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await caseApi.detail(record.id);
      setDetail(res.data);
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setDetailLoading(false);
    }
  };

  const openCreate = () => {
    createForm.resetFields();
    setCreateOpen(true);
  };

  const handleCreate = async (values: CreateFormValues) => {
    setCreateSubmitting(true);
    try {
      await caseApi.create({
        title: values.title,
        customerId: values.customerId,
        caseType: values.caseType,
        ...(values.lawyerId ? { lawyerId: values.lawyerId } : {}),
        ...(values.priority ? { priority: values.priority } : {}),
        ...(values.fee !== undefined ? { fee: values.fee.toFixed(2) } : {}),
        ...(values.description?.trim() ? { description: values.description.trim() } : {}),
      });
      message.success('案件已创建');
      setCreateOpen(false);
      void fetchList(1, pageSize);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const openClose = (record: Case) => {
    setDetail(record);
    closeForm.resetFields();
    setCloseOpen(true);
  };

  const handleClose = async (values: CloseFormValues) => {
    if (!detail) return;
    setCloseSubmitting(true);
    try {
      await caseApi.close(detail.id, {
        ...(values.result?.trim() ? { result: values.result.trim() } : {}),
        ...(values.satisfaction !== undefined ? { satisfaction: values.satisfaction } : {}),
      });
      message.success('案件已结案');
      setCloseOpen(false);
      await openDetailWithFiles(detail);
      void fetchList();
    } finally {
      setCloseSubmitting(false);
    }
  };

  const openCreateTask = () => {
    taskForm.resetFields();
    setTaskOpen(true);
  };

  const handleCreateTask = async (values: CreateTaskFormValues) => {
    if (!detail) return;
    setTaskSubmitting(true);
    try {
      await caseApi.createTask(detail.id, {
        name: values.name.trim(),
        nodeType: values.nodeType,
        ...(values.dueDate ? { dueDate: values.dueDate.toISOString() } : {}),
        ...(values.remark?.trim() ? { remark: values.remark.trim() } : {}),
      });
      message.success('任务已添加');
      setTaskOpen(false);
      await openDetailWithFiles(detail);
    } finally {
      setTaskSubmitting(false);
    }
  };

  const handleFlipTask = async (task: CaseTask, nextStatus: 'IN_PROGRESS' | 'COMPLETED') => {
    if (!detail) return;
    try {
      await caseApi.updateTask(detail.id, task.id, { status: nextStatus });
      message.success(nextStatus === 'COMPLETED' ? '任务已完成' : '任务已开始办理');
      await openDetailWithFiles(detail);
    } catch {
      // 共享拦截器已提示错误。
    }
  };

  const openCreateComm = () => {
    commForm.resetFields();
    setCommOpen(true);
  };

  const handleCreateComm = async (values: CreateCommFormValues) => {
    if (!detail) return;
    setCommSubmitting(true);
    try {
      await caseApi.createCommunication(detail.id, {
        type: values.type,
        content: values.content.trim(),
        ...(values.isKey ? { isKey: true } : {}),
      });
      message.success('沟通记录已添加');
      setCommOpen(false);
      await openDetailWithFiles(detail);
    } finally {
      setCommSubmitting(false);
    }
  };

  // SPEC-042：案件文件/证据（case.file.read/manage 门控）。
  const canReadFiles = useAuthStore(state => state.hasPermission('case.file.read'));
  const canManageFiles = useAuthStore(state => state.hasPermission('case.file.manage'));
  const [files, setFiles] = useState<CaseFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const fetchFiles = async (caseId?: string) => {
    const targetId = caseId ?? detail?.id;
    if (!canReadFiles || !targetId) return;
    setFilesLoading(true);
    try {
      const res = await caseApi.listFiles(targetId, { page: 1, pageSize: 50 });
      setFiles(res.data.list);
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setFilesLoading(false);
    }
  };

  // 详情打开时拉取文件列表（openDetail 成功后）——显式传 caseId 避免陈旧闭包（detail 初值 null）。
  const originalOpenDetail = openDetail;
  const openDetailWithFiles = async (record: Case) => {
    await originalOpenDetail(record);
    void fetchFiles(record.id);
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !detail) return;
    setFileUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      await caseApi.uploadFile(detail.id, { fileName: file.name, fileType: file.type || 'application/octet-stream', base64 });
      message.success('文件已上传');
      await fetchFiles();
    } catch {
      // 共享拦截器已提示错误。
    } finally {
      setFileUploading(false);
    }
  };

  const handleDownloadFile = async (file: CaseFile) => {
    try {
      const res = await caseApi.downloadFile(file.id);
      const byteString = atob(res.data.base64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i += 1) bytes[i] = byteString.charCodeAt(i);
      const blob = new Blob([bytes], { type: res.data.fileType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = res.data.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // 共享拦截器已提示错误。
    }
  };

  const handleRemoveFile = async (file: CaseFile) => {
    try {
      await caseApi.removeFile(file.id);
      message.success('文件已删除');
      await fetchFiles();
    } catch {
      // 共享拦截器已提示错误。
    }
  };

  const customerMap = new Map(customers.map(item => [item.id, item.name]));
  const employeeMap = new Map(employees.map(item => [item.id, item.name]));

  const columns = [
    { title: '案件编号', dataIndex: 'caseNo', key: 'caseNo', width: 160, render: (caseNo: string) => <span>{caseNo}<br /><a href={'/finance?caseNo=' + encodeURIComponent(caseNo)}>关联财务</a></span> },
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: '客户', key: 'customer', width: 120, render: (_: unknown, record: Case) => customerMap.get(record.customerId) ?? record.customerId },
    { title: '主办律师', key: 'lawyer', width: 110, render: (_: unknown, record: Case) => (record.lawyerId ? employeeMap.get(record.lawyerId) ?? record.lawyerId : '-') },
    { title: '案由', dataIndex: 'caseType', key: 'caseType', width: 120 },
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 90, render: (value: string) => <Tag color={PRIORITY_META[value]?.color}>{PRIORITY_META[value]?.text ?? value}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (value: string) => <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.text ?? value}</Tag> },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: unknown, record: Case) => (
        <Space size={0}>
          {canBindFinance && !record.contractId && <Button type="link" size="small" onClick={async () => { setBindingBusy(true); try { const res = await contractApi.list({ page: 1, pageSize: 100, customerId: record.customerId }); setFinanceContracts(res.data.list); setFinanceContractId(undefined); setBinding(record); } catch { message.error('合同加载失败'); } finally { setBindingBusy(false); } }}>关联财务合同</Button>}
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => void openDetailWithFiles(record)}>详情</Button>
          {canClose && record.status !== 'CLOSED' && record.status !== 'ARCHIVED' && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => openClose(record)}>结案</Button>
          )}
        </Space>
      ),
    },
  ];

  const isTerminal = detail?.status === 'CLOSED' || detail?.status === 'ARCHIVED';

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <Space wrap>
              <Input
                aria-label="案件关键词"
                placeholder="搜索编号/标题/案由"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onPressEnter={handleSearch}
                style={{ width: 240 }}
              />
              <Select
                aria-label="状态筛选"
                placeholder="状态"
                value={status}
                onChange={value => setStatus(value)}
                style={{ width: 130 }}
                allowClear
                options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.text }))}
              />
              <Button type="primary" onClick={handleSearch}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          {canCreate && (
            <Col>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建案件</Button>
            </Col>
          )}
        </Row>
      </Card>

      <Table<Case>
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无案件' }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: totalCount => `共 ${totalCount} 条`,
          onChange: (nextPage, nextSize) => void fetchList(nextPage, nextSize),
        }}
      />

      {/* 新建案件 */}
      <Modal
        title="新建案件"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createSubmitting}
        okText="确定"
        width={560}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入案件标题' }]}>
            <Input aria-label="案件标题" maxLength={100} />
          </Form.Item>
          <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
            <Select
              aria-label="客户"
              showSearch
              optionFilterProp="label"
              placeholder="选择客户"
              options={customers.map(item => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item name="lawyerId" label="主办律师">
            <Select
              aria-label="主办律师"
              showSearch
              optionFilterProp="label"
              placeholder="可选"
              allowClear
              options={employees.map(item => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item name="caseType" label="案由" rules={[{ required: true, message: '请输入案由' }]}>
            <Input aria-label="案由" placeholder="如：合同纠纷" maxLength={100} />
          </Form.Item>
          <Form.Item name="priority" label="优先级" initialValue="NORMAL">
            <Select
              aria-label="优先级"
              options={PRIORITIES.map(value => ({ value, label: PRIORITY_META[value].text }))}
            />
          </Form.Item>
          <Form.Item name="fee" label="费用">
            <InputNumber aria-label="费用" min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="案情描述">
            <Input.TextArea rows={3} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 结案 */}
      <Modal
        title="结案"
        open={closeOpen}
        onCancel={() => setCloseOpen(false)}
        onOk={() => closeForm.submit()}
        confirmLoading={closeSubmitting}
        okText="结案"
        width={480}
        destroyOnHidden
      >
        <Form form={closeForm} layout="vertical" onFinish={handleClose}>
          <Form.Item name="result" label="案件结果">
            <Input.TextArea rows={2} maxLength={1000} placeholder="如：胜诉/调解成功/撤诉" />
          </Form.Item>
          <Form.Item name="satisfaction" label="满意度（1-5 分）">
            <InputNumber aria-label="满意度" min={1} max={5} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新建任务 */}
      <Modal
        title="新建任务"
        open={taskOpen}
        onCancel={() => setTaskOpen(false)}
        onOk={() => taskForm.submit()}
        confirmLoading={taskSubmitting}
        okText="确定"
        width={480}
        destroyOnHidden
      >
        <Form form={taskForm} layout="vertical" onFinish={handleCreateTask}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
            <Input aria-label="任务名称" maxLength={100} />
          </Form.Item>
          <Form.Item name="nodeType" label="节点类型" rules={[{ required: true, message: '请选择节点类型' }]}>
            <Select
              aria-label="节点类型"
              placeholder="选择案件阶段"
              virtual={false}
              options={TASK_NODE_TYPES.map(value => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item name="dueDate" label="截止日期">
            <DatePicker aria-label="截止日期" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新增沟通 */}
      <Modal
        title="新增沟通记录"
        open={commOpen}
        onCancel={() => setCommOpen(false)}
        onOk={() => commForm.submit()}
        confirmLoading={commSubmitting}
        okText="确定"
        width={480}
        destroyOnHidden
      >
        <Form form={commForm} layout="vertical" onFinish={handleCreateComm}>
          <Form.Item name="type" label="沟通方式" rules={[{ required: true, message: '请选择沟通方式' }]} initialValue="PHONE">
            <Select
              aria-label="沟通方式"
              virtual={false}
              options={Object.entries(COMM_TYPES).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入沟通内容' }]}>
            <Input.TextArea aria-label="沟通内容" rows={3} maxLength={2000} />
          </Form.Item>
          <Form.Item name="isKey" label="关键沟通" valuePropName="checked">
            <input type="checkbox" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 案件详情 */}
      <Drawer
        title={detail ? `${detail.caseNo} ${detail.title}` : '案件详情'}
        width={700}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {detailLoading && <div style={{ textAlign: 'center', color: '#999' }}>加载中...</div>}
        {!detailLoading && detail && (
          <div>
            <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
              <Row gutter={[16, 8]}>
                <Col span={8}><strong>客户：</strong>{customerMap.get(detail.customerId) ?? detail.customerId}</Col>
                <Col span={8}><strong>主办律师：</strong>{detail.lawyerId ? employeeMap.get(detail.lawyerId) ?? detail.lawyerId : '-'}</Col>
                <Col span={8}><strong>案由：</strong>{detail.caseType}</Col>
                <Col span={8}><strong>优先级：</strong><Tag color={PRIORITY_META[detail.priority]?.color}>{PRIORITY_META[detail.priority]?.text ?? detail.priority}</Tag></Col>
                <Col span={8}><strong>状态：</strong><Tag color={STATUS_META[detail.status]?.color}>{STATUS_META[detail.status]?.text ?? detail.status}</Tag></Col>
                <Col span={8}><strong>费用：</strong>¥{detail.fee}</Col>
                <Col span={8}><strong>可转介绍：</strong>{detail.isReferrable ? '是' : '否'}</Col>
                <Col span={8}><strong>创建时间：</strong>{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Col>
                {detail.closedAt && <Col span={8}><strong>结案时间：</strong>{dayjs(detail.closedAt).format('YYYY-MM-DD HH:mm')}</Col>}
              </Row>
              {detail.description && (
                <p style={{ marginTop: 8 }}><strong>案情描述：</strong>{detail.description}</p>
              )}
              {detail.result && (
                <p><strong>案件结果：</strong>{detail.result}</p>
              )}
            </Card>

            <Card
              size="small"
              title={(
                <Space>
                  任务进度
                  {canTask && !isTerminal && (
                    <Button type="link" size="small" icon={<PlusOutlined />} onClick={openCreateTask}>新建任务</Button>
                  )}
                </Space>
              )}
              style={{ marginBottom: 16 }}
            >
              {detail.tasks && detail.tasks.length > 0 ? (
                <Timeline>
                  {detail.tasks.map((task: CaseTask) => (
                    <Timeline.Item key={task.id} color={task.status === 'COMPLETED' ? 'green' : task.status === 'OVERDUE' ? 'red' : 'blue'}>
                      <p style={{ margin: 0 }}>
                        <strong>{task.name}</strong> <Tag>{task.nodeType}</Tag> <Tag color={TASK_STATUS_META[task.status]?.color}>{TASK_STATUS_META[task.status]?.text ?? task.status}</Tag>
                        {canTask && !isTerminal && task.status === 'PENDING' && (
                          <Button type="link" size="small" onClick={() => void handleFlipTask(task, 'IN_PROGRESS')}>开始办理</Button>
                        )}
                        {canTask && !isTerminal && task.status === 'IN_PROGRESS' && (
                          <Button type="link" size="small" onClick={() => void handleFlipTask(task, 'COMPLETED')}>完成</Button>
                        )}
                      </p>
                      <p style={{ color: '#999', fontSize: 12, margin: 0 }}>
                        截止：{task.dueDate ? dayjs(task.dueDate).format('YYYY-MM-DD') : '无'}
                        {task.completedAt ? ` ｜ 完成：${dayjs(task.completedAt).format('YYYY-MM-DD')}` : ''}
                      </p>
                      {task.remark && <p style={{ color: '#999', fontSize: 12, margin: 0 }}>{task.remark}</p>}
                    </Timeline.Item>
                  ))}
                </Timeline>
              ) : <p style={{ color: '#999' }}>暂无任务</p>}
            </Card>

            <Card
              size="small"
              title={(
                <Space>
                  沟通记录
                  {canCommunicate && !isTerminal && (
                    <Button type="link" size="small" icon={<MessageOutlined />} onClick={openCreateComm}>新增沟通</Button>
                  )}
                </Space>
              )}
            >
              {detail.communications && detail.communications.length > 0 ? (
                <List
                  size="small"
                  dataSource={detail.communications}
                  renderItem={(comm: Communication) => (
                    <List.Item>
                      <div>
                        <Tag>{COMM_TYPES[comm.type] ?? comm.type}</Tag>
                        {comm.isKey && <Tag color="red">关键</Tag>}
                        <p style={{ margin: 0 }}>{comm.content}</p>
                        <p style={{ color: '#999', fontSize: 12, margin: 0 }}>{dayjs(comm.createdAt).format('YYYY-MM-DD HH:mm')}</p>
                      </div>
                    </List.Item>
                  )}
                />
              ) : <p style={{ color: '#999' }}>暂无沟通记录</p>}
            </Card>

            <Card
              size="small"
              title={(
                <Space>
                  文件/证据
                  {canManageFiles && !isTerminal && (
                    <Button type="link" size="small" icon={<UploadOutlined />} loading={fileUploading} onClick={() => fileInputRef.current?.click()}>上传</Button>
                  )}
                </Space>
              )}
              style={{ marginBottom: 16 }}
            >
              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelected} />
              <List
                size="small"
                loading={filesLoading}
                dataSource={files}
                locale={{ emptyText: '暂无文件' }}
                renderItem={file => (
                  <List.Item
                    actions={[
                      <Button key="download" type="link" size="small" icon={<DownloadOutlined />} onClick={() => void handleDownloadFile(file)}>下载</Button>,
                      ...(canManageFiles
                        ? [<Popconfirm key="remove" title="确认删除该文件？" onConfirm={() => void handleRemoveFile(file)}>
                            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
                          </Popconfirm>]
                        : []),
                    ]}
                  >
                    <Space wrap>
                      <PaperClipOutlined />
                      <strong>{file.fileName}</strong>
                      <Tag>{file.fileType}</Tag>
                      <span style={{ color: '#999', fontSize: 12 }}>{(file.fileSize / 1024).toFixed(1)} KB</span>
                    </Space>
                    <p style={{ color: '#999', fontSize: 12, margin: 0 }}>
                      上传于 {dayjs(file.createdAt).format('YYYY-MM-DD HH:mm')}
                    </p>
                  </List.Item>
                )}
              />
            </Card>

            {canClose && !isTerminal && (
              <div style={{ textAlign: 'right', marginTop: 16 }}>
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => openClose(detail)}>结案</Button>
              </div>
            )}
          </div>
        )}
      </Drawer>
      <Modal okText="确定" cancelText="取消" title="关联财务合同" open={!!binding} confirmLoading={bindingBusy} okButtonProps={{ disabled: !financeContractId || bindingBusy }} onCancel={() => { if (!bindingBusy) setBinding(undefined); }} onOk={async () => { if (!binding || !financeContractId) return; setBindingBusy(true); try { await integrationApi.bindCase(binding.id, { contractId: financeContractId, version: binding.version }); setBinding(undefined); await fetchList(); message.success('案件已关联财务合同'); } catch { message.error('关联未完成，请检查合同客户、占用情况或记录版本'); } finally { setBindingBusy(false); } }}>
        <p>案件 {binding?.caseNo}：选择同一客户的合同。关联后，该合同的收款、开票和退款减免将统一显示此案件编号。</p>
        <Select style={{ width: '100%' }} showSearch optionFilterProp="label" placeholder="选择财务合同" value={financeContractId} onChange={setFinanceContractId} options={financeContracts.map(c => ({ value: c.id, label: c.contractNo + ' / ' + c.title }))} />
      </Modal>
    </div>
  );
};

export default CasePage;
