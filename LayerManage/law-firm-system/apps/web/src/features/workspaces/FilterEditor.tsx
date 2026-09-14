import { Button, Input, Select, Space } from 'antd';
import type { Field, Filter } from './types';

export default function FilterEditor({
  value,
  onChange,
  fields,
  depth = 0,
}: {
  value?: Filter;
  onChange(value?: Filter): void;
  fields: Field[];
  depth?: number;
}) {
  const update = (i: number, next?: Filter) => {
    const children = value?.children?.flatMap((f, n) => (n === i ? (next ? [next] : []) : [f]));
    onChange(children?.length ? { ...value, children } : undefined);
  };
  if (!value)
    return (
      <Button
        onClick={() =>
          onChange({ join: 'and', children: [{ fieldId: fields[0]?.id, operator: 'eq', value: '' }] })
        }
        disabled={!fields.length}
      >
        添加筛选条件
      </Button>
    );
  if (value.join)
    return (
      <div className="workspace-filter-group">
        <Space wrap>
          <Select
            aria-label="条件关系"
            value={value.join}
            onChange={(join) => onChange({ ...value, join })}
            options={[
              { value: 'and', label: '满足所有条件' },
              { value: 'or', label: '满足任一条件' },
            ]}
          />
          <Button onClick={() => onChange(undefined)}>移除条件组</Button>
        </Space>
        {value.children?.map((f, i) => (
          <FilterEditor
            key={i}
            fields={fields}
            value={f}
            depth={depth + 1}
            onChange={(next) => update(i, next)}
          />
        ))}
        <Space>
          <Button
            onClick={() =>
              onChange({
                ...value,
                children: [...(value.children || []), { fieldId: fields[0]?.id, operator: 'eq', value: '' }],
              })
            }
          >
            ＋条件
          </Button>
          {depth < 3 && (
            <Button
              onClick={() =>
                onChange({
                  ...value,
                  children: [
                    ...(value.children || []),
                    { join: 'or', children: [{ fieldId: fields[0]?.id, operator: 'eq', value: '' }] },
                  ],
                })
              }
            >
              ＋条件组
            </Button>
          )}
        </Space>
      </div>
    );
  return (
    <Space wrap className="workspace-filter-line">
      <Select
        aria-label="筛选字段"
        style={{ width: 145 }}
        value={value.fieldId}
        onChange={(fieldId) => onChange({ ...value, fieldId })}
        options={fields.map((f) => ({ value: f.id, label: f.name }))}
      />
      <Select
        aria-label="筛选比较方式"
        style={{ width: 110 }}
        value={value.operator}
        onChange={(operator) => onChange({ ...value, operator })}
        options={Object.entries({
          eq: '等于',
          ne: '不等于',
          contains: '包含',
          gt: '大于',
          gte: '大于等于',
          lt: '小于',
          lte: '小于等于',
          empty: '为空',
          notEmpty: '不为空',
        }).map(([value, label]) => ({ value, label }))}
      />
      {!['empty', 'notEmpty'].includes(value.operator || '') && (
        <Input
          aria-label="筛选值"
          style={{ width: 155 }}
          value={String(value.value ?? '')}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
        />
      )}
      <Button onClick={() => onChange({ ...value, value: '$currentUser' })}>当前用户</Button>
      <Button aria-label="删除筛选条件" onClick={() => onChange(undefined)}>
        删除
      </Button>
    </Space>
  );
}
