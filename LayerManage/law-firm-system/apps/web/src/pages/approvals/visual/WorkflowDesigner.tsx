import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Select, Space, Tabs, Tag, Modal, message } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import WorkflowForm from './WorkflowForm';
import DraggableModal from '@/components/DraggableModal';
import FlowCanvas from './FlowCanvas';
import { BasicSettings, MoreSettings, SubmissionScope } from './WorkflowSettings';
import BranchConditions from './BranchConditions';
import {
  fieldLabels,
  labels,
  get,
  post,
  errorText,
  validateSchema,
  type Definition,
  type WorkflowSchema,
  type FormField,
  type FlowNode,
  type Condition,
  type Options,
  type Option,
  type TableSchema,
  type Values,
  type FieldMode,
} from './api';

const uid = (prefix: string) => prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 10);
const option = (value: string, label: string) => ({ value, label });
const modeOptions = [option('EDIT', '可编辑'), option('READ', '只读'), option('HIDDEN', '隐藏')];
const Field = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="wf-property">
    <label>{title}</label>
    {children}
  </div>
);
function ConditionEditor({
  value,
  fields,
  onChange,
}: {
  value?: Condition;
  fields: FormField[];
  onChange: (c: Condition | undefined) => void;
}) {
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Checkbox
        checked={!!value}
        onChange={(e) =>
          onChange(e.target.checked ? { field: fields[0]?.key ?? '', op: 'eq', value: '' } : undefined)
        }
      >
        启用条件
      </Checkbox>
      {value && (
        <>
          <Select
            style={{ width: '100%' }}
            value={value.field}
            options={fields.map((f) => option(f.key, f.label))}
            onChange={(field) => onChange({ ...value, field })}
          />
          <Select
            value={value.op}
            options={[
              ['eq', '等于'],
              ['ne', '不等于'],
              ['gt', '大于'],
              ['gte', '大于等于'],
              ['lt', '小于'],
              ['lte', '小于等于'],
              ['contains', '包含'],
              ['present', '不为空'],
            ].map(([a, b]) => option(a, b))}
            onChange={(op) => onChange({ ...value, op })}
          />
          {value.op !== 'present' &&
            (fields.find((f) => f.key === value.field)?.type === 'number' ? (
              <InputNumber
                value={Number(value.value) || 0}
                onChange={(v) => onChange({ ...value, value: v ?? 0 })}
              />
            ) : (
              <Input
                value={String(value.value ?? '')}
                placeholder="比较值"
                onChange={(e) => onChange({ ...value, value: e.target.value })}
              />
            ))}
        </>
      )}
    </Space>
  );
}
function FieldProperties({
  field,
  fields,
  tables,
  onChange,
}: {
  field: FormField;
  fields: FormField[];
  tables: Option[];
  onChange: (f: FormField) => void;
}) {
  const set = (patch: Partial<FormField>) => onChange({ ...field, ...patch });
  return (
    <>
      <Field title="字段名称">
        <Input value={field.label} onChange={(e) => set({ label: e.target.value })} />
      </Field>
      <Field title="类型">
        <span>{fieldLabels[field.type]}</span>
      </Field>
      <Field title="输入提示">
        <Input
          value={field.placeholder}
          maxLength={2000}
          onChange={(e) => set({ placeholder: e.target.value })}
        />
      </Field>
      <Field title="字段说明">
        <Input.TextArea
          value={field.description}
          maxLength={2000}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <Checkbox checked={field.printable !== false} onChange={(e) => set({ printable: e.target.checked })}>
        允许打印此字段
      </Checkbox>
      {field.type === 'detail' && (
        <Field title="明细排列">
          <Select
            value={field.layout ?? 'vertical'}
            options={[option('vertical', '纵向'), option('horizontal', '横向')]}
            onChange={(layout) => set({ layout })}
          />
        </Field>
      )}
      <Checkbox checked={field.required} onChange={(e) => set({ required: e.target.checked })}>
        必填
      </Checkbox>
      {['text', 'textarea'].includes(field.type) && (
        <>
          <Field title="最小 / 最大长度">
            <Space>
              <InputNumber
                min={0}
                max={2000}
                value={field.minLength}
                onChange={(v) => set({ minLength: v ?? undefined })}
              />
              <InputNumber
                min={0}
                max={2000}
                value={field.maxLength}
                onChange={(v) => set({ maxLength: v ?? undefined })}
              />
            </Space>
          </Field>
          <Field title="格式校验（基础正则）">
            <Input
              placeholder="例如 ^[0-9]{11}$"
              value={field.pattern}
              onChange={(e) => set({ pattern: e.target.value || undefined })}
            />
          </Field>
        </>
      )}
      {['select', 'multi'].includes(field.type) && (
        <Field title="选项（每行一个）">
          <Input.TextArea
            rows={4}
            value={field.options?.join('\n')}
            onChange={(e) => set({ options: e.target.value.split('\n') })}
          />
        </Field>
      )}
      {field.type === 'relation' && (
        <Field title="关联数据表">
          <Select
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            value={field.tableId}
            options={tables.map((t) => option(t.id, t.name))}
            onChange={(tableId) => set({ tableId })}
          />
        </Field>
      )}
      {field.type === 'moneyUpper' && (
        <Field title="来源金额字段">
          <Select
            style={{ width: '100%' }}
            value={field.sourceField}
            options={fields.filter((f) => f.type === 'number').map((f) => option(f.key, f.label))}
            onChange={(sourceField) => set({ sourceField })}
          />
        </Field>
      )}
      {field.type === 'formula' && (
        <>
          <Field title="运算">
            <Select
              value={field.formula?.op ?? 'add'}
              options={[
                ['add', '加法'],
                ['subtract', '减法'],
                ['multiply', '乘法'],
                ['divide', '除法'],
                ['sum', '求和 / 明细求和'],
              ].map(([a, b]) => option(a, b))}
              onChange={(op) => set({ formula: { op, fields: [] } })}
            />
          </Field>
          <Field title="参与计算的字段（按选择顺序）">
            <Select
              style={{ width: '100%' }}
              mode="multiple"
              value={field.formula?.fields ?? []}
              options={fields.flatMap((f) =>
                f.type === 'number'
                  ? [option(f.key, f.label)]
                  : field.formula?.op === 'sum' && f.type === 'detail'
                    ? (f.children ?? [])
                        .filter((c) => c.type === 'number')
                        .map((c) => option(`${f.key}.${c.key}`, `${f.label} / ${c.label}`))
                    : [],
              )}
              onChange={(refs) => set({ formula: { op: field.formula?.op ?? 'add', fields: refs } })}
            />
          </Field>
        </>
      )}
      <Field title="显示条件">
        <ConditionEditor
          value={field.visibleWhen}
          fields={fields.filter((f) => f.key !== field.key)}
          onChange={(visibleWhen) => set({ visibleWhen })}
        />
      </Field>
      <Field title="条件必填">
        <ConditionEditor
          value={field.requiredWhen}
          fields={fields.filter((f) => f.key !== field.key)}
          onChange={(requiredWhen) => set({ requiredWhen })}
        />
      </Field>
      {field.type === 'detail' && (
        <Field title="明细列">
          <Space direction="vertical" style={{ width: '100%' }}>
            {field.children?.map((c, index) => (
              <Space key={c.key}>
                <Input
                  value={c.label}
                  placeholder="列名称"
                  onChange={(e) =>
                    set({
                      children: field.children!.map((x, i) =>
                        i === index ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
                <Select
                  value={c.type}
                  options={['text', 'textarea', 'number', 'date', 'user'].map((t) =>
                    option(t, fieldLabels[t]),
                  )}
                  onChange={(type) =>
                    set({ children: field.children!.map((x, i) => (i === index ? { ...x, type } : x)) })
                  }
                />
                <Checkbox
                  checked={c.required}
                  onChange={(e) =>
                    set({
                      children: field.children!.map((x, i) =>
                        i === index ? { ...x, required: e.target.checked } : x,
                      ),
                    })
                  }
                />
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => set({ children: field.children!.filter((_, i) => i !== index) })}
                />
              </Space>
            ))}
            <Button
              onClick={() =>
                set({
                  children: [...(field.children ?? []), { key: uid('col'), label: '明细列', type: 'text' }],
                })
              }
            >
              添加明细列
            </Button>
          </Space>
        </Field>
      )}
    </>
  );
}
export default function WorkflowDesigner({
  definition,
  options,
  onSaved,
  onClose,
}: {
  definition: Definition;
  options: Options;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [schema, setSchema] = useState<WorkflowSchema>(structuredClone(definition.schema)),
    [name, setName] = useState(definition.name),
    [id, setId] = useState(definition.id),
    [revision, setRevision] = useState(definition.revision),
    [version, setVersion] = useState(definition.version);
  const [tab, setTab] = useState('basic'),
    [selectedField, setSelectedField] = useState(''),
    [selectedNode, setSelectedNode] = useState(''),
    [selectedEdge, setSelectedEdge] = useState(''),
    [linkFrom, setLinkFrom] = useState(''),
    [role, setRole] = useState(''),
    [saving, setSaving] = useState(false),
    [preview, setPreview] = useState<Values>({}),
    [tables, setTables] = useState<Option[]>([]),
    [table, setTable] = useState<TableSchema>();
  const [advanced, setAdvanced] = useState(false),
    [previewOpen, setPreviewOpen] = useState(false),
    [nodeTab, setNodeTab] = useState('people');
  const [savedState, setSavedState] = useState(
    JSON.stringify({ name: definition.name, schema: definition.schema }),
  );
  const dirty = savedState !== JSON.stringify({ name, schema });
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null),
    svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    get<Option[]>('/workflows/tables')
      .then(setTables)
      .catch((e) => message.error(errorText(e)));
  }, []);
  useEffect(() => {
    let live = true;
    if (schema.binding?.tableId)
      get<TableSchema>(`/tables/${schema.binding.tableId}`)
        .then((t) => {
          if (live) setTable(t);
        })
        .catch((e) => {
          if (live) message.error(errorText(e));
        });
    return () => {
      live = false;
    };
  }, [schema.binding?.tableId]);
  const f = schema.fields.find((f) => f.key === selectedField),
    node = schema.nodes.find((n) => n.id === selectedNode),
    edge = schema.edges.find((e) => e.id === selectedEdge);
  const updateNode = (patch: Partial<FlowNode>) =>
    setSchema((s) => ({ ...s, nodes: s.nodes.map((n) => (n.id === selectedNode ? { ...n, ...patch } : n)) }));
  const addField = (type: FormField['type']) => {
    const field: FormField = {
      key: uid('f'),
      label: fieldLabels[type],
      type,
      ...(['select', 'multi'].includes(type) ? { options: ['选项一', '选项二'] } : {}),
      ...(type === 'detail'
        ? { children: [{ key: uid('col'), label: '内容', type: 'text' } as FormField] }
        : {}),
    };
    setSchema((s) => ({ ...s, fields: [...s.fields, field] }));
    setSelectedField(field.key);
  };
  const moveField = (key: string, index: number) =>
    setSchema((s) => {
      const fields = [...s.fields],
        from = fields.findIndex((f) => f.key === key);
      if (from < 0) return s;
      const [field] = fields.splice(from, 1);
      fields.splice(Math.max(0, index), 0, field);
      return { ...s, fields };
    });
  const save = async (publish: boolean) => {
    try {
      if (publish) validateSchema(schema);
      setSaving(true);
      const result = await post<{ id: string; revision: number; version: number }>(
        `/workflows/definitions${id ? '/' + id : ''}`,
        { name, schema, revision, publish },
      );
      setId(result.id);
      setRevision(result.revision);
      setVersion(result.version);
      setSavedState(JSON.stringify({ name, schema }));
      message.success(publish ? '流程已发布，新申请将使用此版本' : '草稿已保存');
      onSaved();
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * 1000) / rect.width,
      y: ((e.clientY - rect.top) * 600) / rect.height,
    };
  };
  const form = (
    <div className="wf-designer">
      <aside>
        <h3>组件库</h3>
        <p>拖入画布或点击添加</p>
        {Object.entries(fieldLabels).map(([type, label]) => (
          <Button
            block
            key={type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('control', type);
            }}
            onClick={() => addField(type as FormField['type'])}
          >
            {label}
          </Button>
        ))}
      </aside>
      <section
        className="wf-canvas"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const type = e.dataTransfer.getData('control');
          if (type in fieldLabels) addField(type as FormField['type']);
        }}
      >
        <h3>表单画布</h3>
        {!schema.fields.length && <div className="wf-empty">将左侧控件拖入这里</div>}
        {schema.fields.map((field, index) => (
          <div
            key={field.key}
            className={'wf-design-field ' + (field.key === selectedField ? 'selected' : '')}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('field', field.key)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const k = e.dataTransfer.getData('field');
              if (k) {
                e.preventDefault();
                e.stopPropagation();
                moveField(k, index);
              }
            }}
            onClick={() => setSelectedField(field.key)}
          >
            <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>
                {field.required ? '* ' : ''}
                {field.label}
              </strong>
              <Space>
                <Button
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    const copy = {
                      ...structuredClone(field),
                      key: uid('f'),
                      label: field.label + '（副本）',
                    };
                    setSchema((s) => ({
                      ...s,
                      fields: [...s.fields.slice(0, index + 1), copy, ...s.fields.slice(index + 1)],
                    }));
                    setSelectedField(copy.key);
                  }}
                >
                  复制
                </Button>
                <Button
                  aria-label="上移字段"
                  size="small"
                  disabled={!index}
                  icon={<ArrowUpOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    moveField(field.key, index - 1);
                  }}
                />
                <Button
                  aria-label="下移字段"
                  size="small"
                  disabled={index === schema.fields.length - 1}
                  icon={<ArrowDownOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    moveField(field.key, index + 1);
                  }}
                />
                <Button
                  aria-label="删除字段"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSchema((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== field.key) }));
                  }}
                />
              </Space>
            </Space>
            <div className="wf-control-preview">
              <WorkflowForm
                fields={[{ ...field, visibleWhen: undefined }]}
                values={
                  field.type === 'detail' && !preview[field.key] ? { ...preview, [field.key]: [{}] } : preview
                }
                onChange={setPreview}
                editable={[]}
                users={options.users}
                preview
              />
            </div>
          </div>
        ))}
      </section>
      <aside className="wf-inspector">
        <h3>控件属性</h3>
        {f ? (
          <FieldProperties
            field={f}
            fields={schema.fields}
            tables={tables}
            onChange={(field) =>
              setSchema((s) => ({ ...s, fields: s.fields.map((f) => (f.key === field.key ? field : f)) }))
            }
          />
        ) : (
          <p>选择画布中的字段</p>
        )}
      </aside>
    </div>
  );
  const flow = (
    <div className="wf-flow-layout">
      <div>
        <Space style={{ marginBottom: 12 }}>
          <Button onClick={() => setAdvanced(!advanced)}>
            {advanced ? '返回直观流程图' : '高级连线编辑'}
          </Button>
          <span>点击节点配置；点击连接线上的＋插入节点。</span>
        </Space>
        {!advanced && (
          <FlowCanvas
            schema={schema}
            options={options}
            selected={selectedNode}
            onNode={(id) => {
              setSelectedNode(id);
              setSelectedEdge('');
            }}
            onEdge={(id) => {
              setSelectedEdge(id);
              setSelectedNode('');
            }}
            onChange={setSchema}
          />
        )}
        <div hidden={!advanced}>
          <Space wrap style={{ marginBottom: 12 }}>
            <Select
              aria-label="选择流程节点"
              style={{ width: 180 }}
              placeholder="选择流程节点"
              value={selectedNode || undefined}
              options={schema.nodes.map((n) => option(n.id, n.name))}
              onChange={(id) => {
                setSelectedNode(id);
                setSelectedEdge('');
              }}
            />
            <Select
              aria-label="连线起点"
              style={{ width: 170 }}
              placeholder="连线起点"
              value={linkFrom || undefined}
              options={schema.nodes.filter((n) => n.type !== 'END').map((n) => option(n.id, n.name))}
              onChange={setLinkFrom}
            />
            <Select<string>
              aria-label="连线终点"
              style={{ width: 170 }}
              placeholder="选择终点添加连线"
              value={undefined}
              disabled={!linkFrom}
              options={schema.nodes
                .filter((n) => n.type !== 'START' && n.id !== linkFrom)
                .map((n) => option(n.id, n.name))}
              onChange={(to) => {
                setSchema((s) => ({ ...s, edges: [...s.edges, { id: uid('e'), from: linkFrom, to }] }));
                setLinkFrom('');
              }}
            />
          </Space>
          <Space wrap>
            {(['APPROVAL', 'CC', 'BRANCH', 'END'] as const).map((type) => (
              <Button
                key={type}
                icon={<PlusOutlined />}
                onClick={() => {
                  const n: FlowNode = {
                    id: uid('n'),
                    name: labels[type],
                    type,
                    x: 60 + (schema.nodes.length % 4) * 220,
                    y: 260 + Math.floor(schema.nodes.length / 4) * 90,
                    ...(['APPROVAL', 'CC'].includes(type)
                      ? { rule: { type: 'USER', ids: [] }, mode: 'ALL' }
                      : {}),
                  };
                  setSchema((s) => ({ ...s, nodes: [...s.nodes, n] }));
                  setSelectedNode(n.id);
                  setSelectedEdge('');
                }}
              >
                {labels[type]}
              </Button>
            ))}
            {linkFrom && <Button onClick={() => setLinkFrom('')}>取消连线</Button>}
          </Space>
          <p>
            拖动节点调整位置；点击右侧圆点，再点击目标节点左侧圆点完成连线。条件分支按优先级匹配，相同优先级按连线顺序，最后走默认路径。
          </p>
          <svg
            ref={svg}
            className="wf-graph"
            viewBox="0 0 1000 600"
            onPointerMove={(e) => {
              if (!drag.current) return;
              const p = point(e),
                d = drag.current;
              setSchema((s) => ({
                ...s,
                nodes: s.nodes.map((n) =>
                  n.id === d.id
                    ? {
                        ...n,
                        x: Math.max(5, Math.min(825, p.x - d.dx)),
                        y: Math.max(5, Math.min(540, p.y - d.dy)),
                      }
                    : n,
                ),
              }));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <defs>
              <marker
                id="wf-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
              </marker>
            </defs>
            {schema.edges.map((e) => {
              const a = schema.nodes.find((n) => n.id === e.from),
                b = schema.nodes.find((n) => n.id === e.to);
              if (!a || !b) return null;
              const x = a.x + 170,
                y = a.y + 28,
                xx = b.x,
                yy = b.y + 28;
              return (
                <g
                  key={e.id}
                  onClick={() => {
                    setSelectedEdge(e.id);
                    setSelectedNode('');
                  }}
                >
                  <path
                    d={`M ${x} ${y} C ${x + 65} ${y}, ${xx - 65} ${yy}, ${xx} ${yy}`}
                    stroke={selectedEdge === e.id ? '#1677ff' : '#64748b'}
                    strokeWidth={selectedEdge === e.id ? 4 : 2}
                    fill="none"
                    markerEnd="url(#wf-arrow)"
                  />
                  <text x={(x + xx) / 2} y={(y + yy) / 2 - 10} fontSize="12" fill="#475569">
                    {e.condition
                      ? `${schema.fields.find((f) => f.key === e.condition!.field)?.label ?? '字段'} ${e.condition.op} ${e.condition.value ?? ''}`
                      : a.type === 'BRANCH'
                        ? '默认'
                        : ''}
                  </text>
                </g>
              );
            })}
            {schema.nodes.map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                onPointerDown={(e) => {
                  if ((e.target as Element).tagName === 'circle') return;
                  setSelectedNode(n.id);
                  setSelectedEdge('');
                  const rect = svg.current!.getBoundingClientRect();
                  drag.current = {
                    id: n.id,
                    dx: ((e.clientX - rect.left) * 1000) / rect.width - n.x,
                    dy: ((e.clientY - rect.top) * 600) / rect.height - n.y,
                  };
                  svg.current!.setPointerCapture(e.pointerId);
                }}
                style={{ cursor: 'move' }}
              >
                <rect
                  width="170"
                  height="56"
                  rx={n.type === 'BRANCH' ? 3 : 12}
                  fill={n.id === selectedNode ? '#e6f4ff' : 'white'}
                  stroke={n.id === selectedNode ? '#1677ff' : '#94a3b8'}
                  strokeWidth="2"
                />
                <text x="12" y="22" fontSize="11" fill="#64748b">
                  {labels[n.type]}
                </text>
                <text x="12" y="42" fontSize="14">
                  {n.name.slice(0, 12)}
                </text>
                {n.type !== 'START' && (
                  <circle
                    cx="0"
                    cy="28"
                    r="7"
                    fill={linkFrom ? '#52c41a' : '#cbd5e1'}
                    onClick={() => {
                      if (linkFrom && linkFrom !== n.id) {
                        setSchema((s) => ({
                          ...s,
                          edges: [...s.edges, { id: uid('e'), from: linkFrom, to: n.id }],
                        }));
                        setLinkFrom('');
                      }
                    }}
                  />
                )}
                {n.type !== 'END' && (
                  <circle cx="170" cy="28" r="7" fill="#1677ff" onClick={() => setLinkFrom(n.id)} />
                )}
              </g>
            ))}
          </svg>
        </div>
      </div>
      <aside className="wf-inspector">
        <h3>{edge ? '连线属性' : '节点属性'}</h3>
        {edge && (
          <>
            <p>
              {schema.nodes.find((n) => n.id === edge.from)?.name} →{' '}
              {schema.nodes.find((n) => n.id === edge.to)?.name}
            </p>
            {schema.nodes.find((n) => n.id === edge.from)?.type === 'BRANCH' && (
              <BranchConditions
                edge={edge}
                fields={schema.fields}
                onChange={(patch) =>
                  setSchema((s) => ({
                    ...s,
                    edges: s.edges.map((e) => (e.id === edge.id ? { ...e, ...patch } : e)),
                  }))
                }
              />
            )}
            <Button
              danger
              onClick={() => {
                setSchema((s) => ({ ...s, edges: s.edges.filter((e) => e.id !== edge.id) }));
                setSelectedEdge('');
              }}
            >
              删除连线
            </Button>
          </>
        )}
        {node && (
          <>
            <Field title="节点名称">
              <Input value={node.name} onChange={(e) => updateNode({ name: e.target.value })} />
            </Field>
            <Tabs
              activeKey={nodeTab}
              onChange={setNodeTab}
              items={[
                { key: 'people', label: node.type === 'START' ? '提交范围' : '人员设置' },
                { key: 'fields', label: '表单权限' },
                ...(node.type === 'APPROVAL' ? [{ key: 'actions', label: '操作权限' }] : []),
              ]}
            />
            <div hidden={nodeTab !== 'people'}>
              {node.type === 'START' && (
                <SubmissionScope schema={schema} options={options} onChange={setSchema} />
              )}
              {node.type === 'END' && (
                <p>流程到达结束节点后执行表格回写；如需结束抄送，请在结束前通过＋插入抄送节点。</p>
              )}
              {node.type === 'APPROVAL' && (
                <Field title="审批类型">
                  <Select
                    value={node.approvalType ?? 'MANUAL'}
                    options={[
                      option('MANUAL', '人工审批'),
                      option('APPROVE', '自动同意'),
                      option('REJECT', '自动驳回'),
                    ]}
                    onChange={(approvalType) => updateNode({ approvalType })}
                  />
                  {node.approvalType && node.approvalType !== 'MANUAL' && (
                    <Alert type="warning" title="此节点将按配置自动处理，无需人工操作。" />
                  )}
                </Field>
              )}
              {['APPROVAL', 'CC'].includes(node.type) && (
                <>
                  <Field title="人员来源">
                    <Select
                      style={{ width: '100%' }}
                      value={node.rule?.type}
                      options={[
                        ['USER', '指定成员'],
                        ['ROLE', '指定角色'],
                        ['MANAGER', '部门负责人'],
                        ['SUPERVISOR', '连续多级主管'],
                        ['SELECT', '发起人自选'],
                        ['FIELD', '表单内联系人'],
                        ['SELF', '发起人本人'],
                      ].map(([a, b]) => option(a, b))}
                      onChange={(type) => updateNode({ rule: { type, ids: [], levels: 1 } })}
                    />
                  </Field>
                  {['USER', 'ROLE'].includes(node.rule?.type ?? '') && (
                    <Select
                      style={{ width: '100%' }}
                      mode="multiple"
                      showSearch
                      optionFilterProp="label"
                      value={node.rule?.ids}
                      options={(node.rule?.type === 'USER' ? options.users : options.roles).map((u) =>
                        option(u.id, u.name),
                      )}
                      onChange={(ids) => updateNode({ rule: { ...node.rule!, ids } })}
                    />
                  )}{' '}
                  {node.rule?.type === 'FIELD' && (
                    <Select
                      style={{ width: '100%' }}
                      value={node.rule.field}
                      options={schema.fields
                        .filter((f) => f.type === 'user')
                        .map((f) => option(f.key, f.label))}
                      onChange={(field) => updateNode({ rule: { ...node.rule!, field } })}
                    />
                  )}{' '}
                  {node.rule?.type === 'SUPERVISOR' && (
                    <Field title="连续上溯层级（按顺序逐级审批）">
                      <InputNumber
                        min={1}
                        max={10}
                        value={node.rule.levels}
                        onChange={(levels) =>
                          updateNode({ rule: { ...node.rule!, levels: levels ?? 1 }, mode: 'SEQUENTIAL' })
                        }
                      />
                    </Field>
                  )}
                  {node.type === 'APPROVAL' && (
                    <>
                      <Field title="多人处理方式">
                        <Select
                          disabled={node.rule?.type === 'SUPERVISOR'}
                          value={node.mode ?? 'ALL'}
                          options={[
                            option('ALL', '会签：全员同意'),
                            option('ANY', '或签：一人同意'),
                            option('SEQUENTIAL', '依次审批'),
                          ]}
                          onChange={(mode) => updateNode({ mode })}
                        />
                      </Field>
                      <Checkbox
                        checked={node.skipRepeated}
                        onChange={(e) => updateNode({ skipRepeated: e.target.checked })}
                      >
                        跳过已经同意过的相同审批人
                      </Checkbox>
                      <Field title="超时小时数（留空不启用）">
                        <InputNumber
                          min={1}
                          max={8760}
                          value={node.timeoutHours}
                          onChange={(v) =>
                            updateNode({
                              timeoutHours: v ?? undefined,
                              timeoutAction: node.timeoutAction ?? 'REMIND',
                            })
                          }
                        />
                      </Field>
                      {node.timeoutHours && (
                        <Field title="超时处理">
                          <Select
                            value={node.timeoutAction ?? 'REMIND'}
                            options={[option('REMIND', '自动提醒'), option('APPROVE', '自动同意')]}
                            onChange={(timeoutAction) => updateNode({ timeoutAction })}
                          />
                          {node.timeoutAction === 'APPROVE' && (
                            <Alert type="warning" title="发布后到期将自动同意此节点，请确认适用于该业务。" />
                          )}
                        </Field>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            {nodeTab === 'actions' && node.type === 'APPROVAL' && (
              <Space direction="vertical">
                {(
                  [
                    ['forward', '允许转办'],
                    ['add', '允许加签'],
                    ['return', '允许退回'],
                  ] as const
                ).map(([key, label]) => (
                  <Checkbox
                    key={key}
                    checked={node.actions?.[key] !== false}
                    onChange={(e) => updateNode({ actions: { ...node.actions, [key]: e.target.checked } })}
                  >
                    {label}
                  </Checkbox>
                ))}
                <Checkbox
                  checked={node.actions?.remarkRequired ?? false}
                  onChange={(e) =>
                    updateNode({ actions: { ...node.actions, remarkRequired: e.target.checked } })
                  }
                >
                  同意时必须填写审批意见
                </Checkbox>
                <p>驳回和退回始终要求原因。操作权限仅对拥有该节点待办的账号生效。</p>
              </Space>
            )}
            <div hidden={nodeTab !== 'fields'}>
              {['START', 'APPROVAL', 'CC'].includes(node.type) && (
                <Field title="字段权限">
                  <Space wrap>
                    {modeOptions.map((o) => (
                      <Button
                        key={o.value}
                        size="small"
                        onClick={() => {
                          const fields = Object.fromEntries(
                            schema.fields.map((f) => [f.key, o.value as FieldMode]),
                          );
                          updateNode(
                            role ? { roleFields: { ...node.roleFields, [role]: fields } } : { fields },
                          );
                        }}
                      >
                        全部{o.label}
                      </Button>
                    ))}
                  </Space>
                  <Select
                    style={{ width: '100%' }}
                    value={role}
                    options={[option('', '节点默认'), ...options.roles.map((r) => option(r.id, r.name))]}
                    onChange={setRole}
                  />
                  {schema.fields.map((f) => (
                    <div className="wf-permission" key={f.key}>
                      <span>{f.label}</span>
                      <Select
                        style={{ minWidth: 105 }}
                        value={
                          (role ? node.roleFields?.[role]?.[f.key] : node.fields?.[f.key]) ??
                          (node.type === 'START' ? 'EDIT' : 'READ')
                        }
                        options={modeOptions}
                        onChange={(mode: FieldMode) =>
                          updateNode(
                            role
                              ? {
                                  roleFields: {
                                    ...node.roleFields,
                                    [role]: { ...node.roleFields?.[role], [f.key]: mode },
                                  },
                                }
                              : { fields: { ...node.fields, [f.key]: mode } },
                          )
                        }
                      />
                    </div>
                  ))}
                  <small>多角色冲突时采用更严格的权限。计算字段始终只读。</small>
                </Field>
              )}
            </div>
            {node.type !== 'START' && (
              <Button
                danger
                onClick={() => {
                  setSchema((s) => ({
                    ...s,
                    nodes: s.nodes.filter((n) => n.id !== node.id),
                    edges: s.edges.filter((e) => e.from !== node.id && e.to !== node.id),
                  }));
                  setSelectedNode('');
                }}
              >
                删除节点及连线
              </Button>
            )}
          </>
        )}
      </aside>
    </div>
  );
  const binding = (
    <div className="wf-binding">
      <Alert
        type="info"
        showIcon
        title="审批通过后回写；始终检查发起人的表格、业务和字段权限。现有记录被别人修改时，会暂停回写并提示处理。"
      />
      <Field title="启用多维表格联动">
        <Checkbox
          checked={!!schema.binding}
          onChange={(e) =>
            setSchema((s) => ({
              ...s,
              binding: e.target.checked ? { tableId: '', mode: 'UPDATE', mappings: [] } : undefined,
            }))
          }
        >
          审批通过后同步数据
        </Checkbox>
      </Field>
      {schema.binding && (
        <>
          <Field title="目标业务数据表">
            <Select
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              value={schema.binding.tableId || undefined}
              options={tables.map((t) => option(t.id, t.name))}
              onChange={(tableId) =>
                setSchema((s) => ({ ...s, binding: { ...s.binding!, tableId, mappings: [] } }))
              }
            />
          </Field>
          <Field title="回写方式">
            <Select
              value={schema.binding.mode}
              options={[
                option('UPDATE', '更新发起时选定的记录'),
                ...(table?.table.source === 'CUSTOM' && !table.table.lifecycleKind
                  ? [option('CREATE', '新增一条表格记录')]
                  : []),
              ]}
              onChange={(mode) => setSchema((s) => ({ ...s, binding: { ...s.binding!, mode } }))}
            />
          </Field>
          <h3>字段映射</h3>
          {schema.binding.mappings.map((m, index) => (
            <Space key={index} className="wf-mapping">
              <Select
                style={{ width: 230 }}
                placeholder="审批表单字段"
                value={m.field || undefined}
                options={schema.fields.map((f) => option(f.key, f.label))}
                onChange={(field) =>
                  setSchema((s) => ({
                    ...s,
                    binding: {
                      ...s.binding!,
                      mappings: s.binding!.mappings.map((m, i) => (i === index ? { ...m, field } : m)),
                    },
                  }))
                }
              />
              <span>→</span>
              <Select
                style={{ width: 230 }}
                placeholder="多维表格字段"
                value={m.target || undefined}
                options={(table && table.table.id === schema.binding?.tableId ? table.fields : [])
                  ?.filter((f) => f.writable)
                  .map((f) => option(f.id, f.name))}
                onChange={(target) =>
                  setSchema((s) => ({
                    ...s,
                    binding: {
                      ...s.binding!,
                      mappings: s.binding!.mappings.map((m, i) => (i === index ? { ...m, target } : m)),
                    },
                  }))
                }
              />
              <Button
                danger
                onClick={() =>
                  setSchema((s) => ({
                    ...s,
                    binding: { ...s.binding!, mappings: s.binding!.mappings.filter((_, i) => i !== index) },
                  }))
                }
              >
                移除
              </Button>
            </Space>
          ))}
          <Button
            onClick={() =>
              setSchema((s) => ({
                ...s,
                binding: { ...s.binding!, mappings: [...s.binding!.mappings, { field: '', target: '' }] },
              }))
            }
          >
            添加映射
          </Button>
        </>
      )}
      <Field title="审批结束后触发自动化接口">
        <Select
          style={{ width: '100%' }}
          allowClear
          value={schema.webhook}
          options={options.hooks.map((h) => option(h, h))}
          placeholder={options.hooks.length ? '选择已配置接口' : '尚未配置自动化接口'}
          onChange={(webhook) => setSchema((s) => ({ ...s, webhook }))}
        />
        <p>接口接收带签名的完成通知；投递结果可在审批详情中查看。</p>
      </Field>
    </div>
  );
  return (
    <div className="wf-editor">
      <header>
        <Space>
          <Input
            aria-label="流程名称"
            style={{ width: 300 }}
            placeholder="流程名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Tag>已发布版本 {version}</Tag>
          <Tag color={dirty || !id ? 'orange' : 'green'}>
            {dirty ? '有未保存修改' : id ? '草稿已保存' : '新流程未保存'}
          </Tag>
        </Space>
        <Space>
          <Button
            onClick={() =>
              dirty ? Modal.confirm({ title: '放弃未保存的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose }) : onClose()
            }
          >
            返回
          </Button>
          <Button onClick={() => setPreviewOpen(true)}>预览表单</Button>
          <Button loading={saving} onClick={() => save(false)}>
            保存草稿
          </Button>
          <Button type="primary" loading={saving} onClick={() => save(true)}>
            校验并发布
          </Button>
        </Space>
      </header>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'basic',
            label: '1 · 基础信息',
            children: <BasicSettings schema={schema} options={options} onChange={setSchema} />,
          },
          { key: 'form', label: '2 · 表单设计', children: form },
          { key: 'flow', label: '3 · 流程设计', children: flow },
          {
            key: 'settings',
            label: '4 · 更多设置',
            children: (
              <>
                <MoreSettings schema={schema} onChange={setSchema} />
                <h2 className="wf-section-title">多维表格与自动化</h2>
                {binding}
              </>
            ),
          },
        ]}
      />
      <DraggableModal
        title="申请表单预览（不会提交或上传数据）"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={800}
      >
        <h2>{name || '未命名流程'}</h2>
        <p>{schema.description}</p>
        <WorkflowForm
          fields={schema.fields}
          values={preview}
          onChange={setPreview}
          users={options.users}
          editable={schema.fields.map((f) => f.key)}
          preview
        />
      </DraggableModal>
    </div>
  );
}
