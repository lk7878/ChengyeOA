import { Button, Dropdown, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { labels, recipientRules, type FlowEdge, type Options, type WorkflowSchema } from './api';

import { insertFlowNode } from './flow-graph';
const sourceLabels: Record<string, string> = {
  SELF: '发起人本人',
  MANAGER: '部门负责人',
  SUPERVISOR: '连续多级主管',
  SELECT: '发起人自选',
  FIELD: '表单联系人',
};
export default function FlowCanvas({
  schema,
  options,
  selected,
  onNode,
  onEdge,
  onChange,
}: {
  schema: WorkflowSchema;
  options: Options;
  selected: string;
  onNode: (id: string) => void;
  onEdge: (id: string) => void;
  onChange: (s: WorkflowSchema) => void;
}) {
  const seen = new Set<string>();
  const render = (id: string, path: Set<string>): React.ReactNode => {
    const n = schema.nodes.find((n) => n.id === id);
    if (!n || path.has(id)) return <Tag color="red">连线需要修正</Tag>;
    if (seen.has(id))
      return (
        <Button type="dashed" onClick={() => onNode(id)}>
          汇合至：{n.name}
        </Button>
      );
    seen.add(id);
    const nextPath = new Set([...path, id]);
    const people = recipientRules(n)
      .map((rule) =>
        rule?.type === 'USER' || rule?.type === 'ROLE'
          ? (rule.ids ?? [])
              .map(
                (id) =>
                  (rule.type === 'USER' ? options.users : options.roles).find((u) => u.id === id)?.name ?? id,
              )
              .join('、') || '请选择处理人'
          : (sourceLabels[rule?.type ?? ''] ?? ''),
      )
      .join('；');
    const edges = schema.edges
      .filter((e) => e.from === id)
      .sort((a, b) => (a.priority ?? 160) - (b.priority ?? 160));
    const connect = (e: FlowEdge) => (
      <div className="wf-connector" key={e.id}>
        {n.type === 'BRANCH' && (
          <Button className="wf-branch-label" onClick={() => onEdge(e.id)}>
            {e.condition || e.groups ? `条件路径 · 优先级 ${e.priority ?? '按顺序'}` : '其他情况（默认）'}
          </Button>
        )}
        <Dropdown
          trigger={['click']}
          menu={{
            items: ['APPROVAL', 'CC', 'BRANCH'].map((type) => ({ key: type, label: labels[type] })),
            onClick: ({ key }) => onChange(insertFlowNode(schema, e.id, key as 'APPROVAL' | 'CC' | 'BRANCH')),
          }}
        >
          <Button
            shape="circle"
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            aria-label={`在${n.name}后插入节点`}
          />
        </Dropdown>
        {render(e.to, nextPath)}
      </div>
    );
    return (
      <div className="wf-flow-tree">
        <button
          type="button"
          className={`wf-node-card ${selected === n.id ? 'selected' : ''}`}
          onClick={() => onNode(n.id)}
        >
          <span className={`wf-node-kind kind-${n.type}`}>{labels[n.type]}</span>
          <strong>{n.name}</strong>
          <small>
            {n.type === 'APPROVAL'
              ? n.approvalType === 'APPROVE'
                ? '自动同意'
                : n.approvalType === 'REJECT'
                  ? '自动驳回'
                  : people
              : n.type === 'CC'
                ? people
                : n.type === 'START'
                  ? '设置提交范围与表单权限'
                  : n.type === 'BRANCH'
                    ? '从上到下按优先级匹配'
                    : '通过后同步业务数据'}
          </small>
        </button>
        <div className={edges.length > 1 ? 'wf-branches' : ''}>{edges.map(connect)}</div>
      </div>
    );
  };
  return (
    <div className="wf-tree-canvas">
      {schema.nodes
        .filter((n) => n.type === 'START')
        .map((n) => (
          <div key={n.id}>{render(n.id, new Set())}</div>
        ))}
    </div>
  );
}
