import { Button, InputNumber, Select } from 'antd';
import { recipientRules, type AssigneeRule, type FlowNode, type Options, type FormField } from './api';

export default function CcRecipients({
  node,
  options,
  fields,
  onChange,
}: {
  node: FlowNode;
  options: Options;
  fields: FormField[];
  onChange: (patch: Partial<FlowNode>) => void;
}) {
  const rules = recipientRules(node);
  const update = (next: AssigneeRule[]) => onChange({ ccRules: next, rule: undefined });
  return (
    <div className="wf-cc-recipients">
      <p>可添加多组抄送对象，指定成员和角色支持多选；同一人员只抄送一次。</p>
      {rules.map((rule, index) => {
        const change = (next: AssigneeRule) => update(rules.map((r, i) => (i === index ? next : r)));
        return (
          <section key={index} aria-label={`抄送对象 ${index + 1}`} className="wf-cc-group">
            <div className="wf-cc-heading">
              <strong>抄送对象 {index + 1}</strong>
              <Button
                danger
                size="small"
                aria-label={`删除抄送对象 ${index + 1}`}
                onClick={() => update(rules.filter((_, i) => i !== index))}
              >
                删除
              </Button>
            </div>
            <Select
              aria-label={`抄送对象 ${index + 1}来源`}
              value={rule.type}
              style={{ width: '100%' }}
              options={[
                { value: 'USER', label: '指定成员' },
                { value: 'ROLE', label: '指定角色' },
                { value: 'MANAGER', label: '部门负责人' },
                { value: 'SUPERVISOR', label: '连续多级主管' },
                { value: 'SELF', label: '发起人本人' },
                { value: 'SELECT', label: '发起人自选' },
                { value: 'FIELD', label: '表单内联系人' },
              ]}
              onChange={(type) => change({ type, ids: [], levels: 1 })}
            />
            {['USER', 'ROLE'].includes(rule.type) && (
              <Select
                aria-label={`抄送对象 ${index + 1}成员或角色`}
                mode="multiple"
                showSearch
                optionFilterProp="label"
                placeholder="可同时选择多个"
                style={{ width: '100%' }}
                value={rule.ids}
                options={(rule.type === 'USER' ? options.users : options.roles).map((u) => ({
                  value: u.id,
                  label: u.name,
                }))}
                onChange={(ids) => change({ ...rule, ids })}
              />
            )}
            {rule.type === 'FIELD' && (
              <Select
                aria-label={`抄送对象 ${index + 1}表单联系人`}
                placeholder="选择人员字段"
                style={{ width: '100%' }}
                value={rule.field}
                options={fields
                  .filter((f) => f.type === 'user')
                  .map((f) => ({ value: f.key, label: f.label }))}
                onChange={(field) => change({ ...rule, field })}
              />
            )}
            {rule.type === 'SUPERVISOR' && (
              <label>
                上溯主管层级{' '}
                <InputNumber
                  aria-label={`抄送对象 ${index + 1}主管层级`}
                  min={1}
                  max={10}
                  value={rule.levels}
                  onChange={(levels) => change({ ...rule, levels: levels ?? 1 })}
                />
              </label>
            )}
            {rule.type === 'SELECT' && (
              <small>发起申请时可选择多个人员；多组自选使用该节点同一份选择。</small>
            )}
          </section>
        );
      })}
      <Button
        block
        disabled={rules.length >= 20}
        onClick={() => update([...rules, { type: 'USER', ids: [] }])}
      >
        添加抄送对象
      </Button>
    </div>
  );
}
