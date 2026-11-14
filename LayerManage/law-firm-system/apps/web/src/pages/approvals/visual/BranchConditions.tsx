import { Button, Checkbox, Input, InputNumber, Select } from 'antd';
import type { Condition, FlowEdge, FormField } from './api';
export default function BranchConditions({
  edge,
  fields,
  onChange,
}: {
  edge: FlowEdge;
  fields: FormField[];
  onChange: (e: Partial<FlowEdge>) => void;
}) {
  const groups = edge.groups ?? (edge.condition ? [[edge.condition]] : undefined);
  const choices = fields.flatMap((f) =>
    f.type === 'detail'
      ? (f.children ?? [])
          .filter((c) => c.type === 'number')
          .map((c) => ({
            value: `${f.key}.${c.key}`,
            label: `${f.label} / ${c.label}（合计）`,
            numeric: true,
          }))
      : [{ value: f.key, label: f.label, numeric: ['number', 'formula'].includes(f.type) }],
  );
  const fresh = (): Condition => ({
    field: choices[0]?.value ?? '',
    op: 'present',
    ...(choices[0]?.value.includes('.') ? { aggregate: 'sum' as const } : {}),
  });
  const set = (groups?: Condition[][]) => onChange({ groups, condition: undefined });
  return (
    <div className="wf-conditions">
      <Checkbox checked={!!groups} onChange={(e) => set(e.target.checked ? [[fresh()]] : undefined)}>
        启用条件路径（关闭为默认路径）
      </Checkbox>
      {groups && (
        <>
          <div className="wf-property">
            <label>优先级（数字越小越先匹配）</label>
            <InputNumber
              aria-label="条件优先级"
              min={1}
              max={160}
              value={edge.priority ?? 1}
              onChange={(priority) => onChange({ priority: priority ?? 1 })}
            />
          </div>
          <p>同一组满足全部条件；任意一组满足即可进入此路径。</p>
          {groups.map((group, g) => (
            <section key={g} className="wf-condition-group">
              <strong>
                {g ? '或：' : ''}条件组 {g + 1}
              </strong>
              {group.map((c, index) => {
                const change = (patch: Partial<Condition>) =>
                  set(
                    groups.map((items, k) =>
                      k === g ? items.map((item, i) => (i === index ? { ...item, ...patch } : item)) : items,
                    ),
                  );
                return (
                  <div key={index} className="wf-property">
                    {index > 0 && <small>并且</small>}
                    <Select
                      style={{ width: '100%' }}
                      aria-label="条件字段"
                      value={c.field || undefined}
                      options={choices}
                      onChange={(field) =>
                        change({
                          field,
                          aggregate: field.includes('.') ? 'sum' : undefined,
                          value: choices.find((x) => x.value === field)?.numeric ? 0 : '',
                        })
                      }
                    />
                    <Select
                      aria-label="条件运算符"
                      value={c.op}
                      options={Object.entries({
                        eq: '等于',
                        ne: '不等于',
                        gt: '大于',
                        gte: '大于等于',
                        lt: '小于',
                        lte: '小于等于',
                        contains: '包含',
                        present: '不为空',
                      }).map(([value, label]) => ({ value, label }))}
                      onChange={(op) =>
                        change({
                          op,
                          value: c.value ?? (choices.find((x) => x.value === c.field)?.numeric ? 0 : ''),
                        })
                      }
                    />
                    {c.op !== 'present' &&
                      (choices.find((x) => x.value === c.field)?.numeric ? (
                        <InputNumber
                          aria-label="条件值"
                          value={Number(c.value) || 0}
                          onChange={(value) => change({ value: value ?? 0 })}
                        />
                      ) : (
                        <Input
                          aria-label="条件值"
                          value={String(c.value ?? '')}
                          onChange={(e) => change({ value: e.target.value })}
                        />
                      ))}
                    <Button
                      size="small"
                      danger
                      disabled={group.length === 1}
                      onClick={() =>
                        set(groups.map((items, k) => (k === g ? items.filter((_, i) => i !== index) : items)))
                      }
                    >
                      删除条件
                    </Button>
                  </div>
                );
              })}
              <Button
                size="small"
                disabled={group.length >= 20}
                onClick={() => set(groups.map((items, k) => (k === g ? [...items, fresh()] : items)))}
              >
                添加条件
              </Button>
              <Button
                size="small"
                danger
                disabled={groups.length === 1}
                onClick={() => set(groups.filter((_, k) => k !== g))}
              >
                删除条件组
              </Button>
            </section>
          ))}
          <Button disabled={groups.length >= 20} onClick={() => set([...groups, [fresh()]])}>
            添加条件组（或）
          </Button>
        </>
      )}
    </div>
  );
}
