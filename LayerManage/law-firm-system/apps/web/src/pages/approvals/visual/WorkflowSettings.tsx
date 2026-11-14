import { Alert, Checkbox, Input, Select } from 'antd';
import type { Options, WorkflowSchema } from './api';

export function SubmissionScope({
  schema,
  options,
  onChange,
}: {
  schema: WorkflowSchema;
  options: Options;
  onChange: (s: WorkflowSchema) => void;
}) {
  const audience = schema.settings?.audience ?? { mode: 'ALL' as const };
  const change = (patch: Partial<typeof audience>) =>
    onChange({ ...schema, settings: { ...schema.settings, audience: { ...audience, ...patch } } });
  return (
    <div className="wf-property">
      <label>谁可以提交此流程</label>
      <Select
        aria-label="提交范围"
        value={audience.mode}
        onChange={(mode) => change({ mode })}
        options={[
          { value: 'ALL', label: '所有拥有申请权限的账号' },
          { value: 'SELECTED', label: '指定成员或角色' },
          { value: 'NONE', label: '暂不允许提交' },
        ]}
      />
      {audience.mode === 'SELECTED' && (
        <>
          <p>成员与角色取并集，同时仍须拥有审批申请权限。</p>
          <Select
            aria-label="允许提交的成员"
            mode="multiple"
            showSearch
            optionFilterProp="label"
            placeholder="选择成员"
            value={audience.users ?? []}
            onChange={(users) => change({ users })}
            options={options.users.map((u) => ({ value: u.id, label: u.name }))}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <Select
            aria-label="允许提交的角色"
            mode="multiple"
            showSearch
            optionFilterProp="label"
            placeholder="选择角色"
            value={audience.roles ?? []}
            onChange={(roles) => change({ roles })}
            options={options.roles.map((u) => ({ value: u.id, label: u.name }))}
            style={{ width: '100%' }}
          />
        </>
      )}
    </div>
  );
}
export function BasicSettings(props: {
  schema: WorkflowSchema;
  options: Options;
  onChange: (s: WorkflowSchema) => void;
}) {
  const { schema, onChange } = props;
  return (
    <div className="wf-settings">
      <h2>基础信息</h2>
      <p>先说明申请用途，再设置允许发起的人员范围。</p>
      <div className="wf-property">
        <label>流程分组</label>
        <Input
          aria-label="流程分组"
          maxLength={100}
          placeholder="例如：综合行政、人力资源、财务"
          value={schema.category}
          onChange={(e) => onChange({ ...schema, category: e.target.value })}
        />
      </div>
      <div className="wf-property">
        <label>申请说明</label>
        <Input.TextArea
          aria-label="申请说明"
          rows={4}
          maxLength={2000}
          showCount
          placeholder="说明申请用途、所需材料和注意事项"
          value={schema.description}
          onChange={(e) => onChange({ ...schema, description: e.target.value })}
        />
      </div>
      <SubmissionScope {...props} />
      <Alert
        type="info"
        showIcon
        title="保存草稿不会影响已发布流程；重新发布后，新申请使用新版本，进行中的申请继续使用原版本。"
      />
    </div>
  );
}
export function MoreSettings({
  schema,
  onChange,
}: {
  schema: WorkflowSchema;
  onChange: (s: WorkflowSchema) => void;
}) {
  const settings = schema.settings ?? {};
  const set = (patch: Partial<NonNullable<WorkflowSchema['settings']>>) =>
    onChange({ ...schema, settings: { ...settings, ...patch } });
  return (
    <div className="wf-settings">
      <h2>申请与展示设置</h2>
      <div className="wf-property">
        <Checkbox
          checked={settings.allowWithdraw !== false}
          onChange={(e) => set({ allowWithdraw: e.target.checked })}
        >
          发起人可撤回审批中的申请
        </Checkbox>
      </div>
      <div className="wf-property">
        <Checkbox
          checked={settings.allowCorrection !== false}
          onChange={(e) => set({ allowCorrection: e.target.checked })}
        >
          已通过申请允许发起更正，重新审批
        </Checkbox>
        <p>保留原单和历史。更正单通过后才更新原业务记录；已通过申请不能直接撤销或覆盖。</p>
      </div>
      <div className="wf-property">
        <Checkbox
          checked={settings.printEnabled !== false}
          onChange={(e) => set({ printEnabled: e.target.checked })}
        >
          允许参与人打印审批单
        </Checkbox>
        <p>打印仅包含当前账号可见且允许打印的字段、审批意见及处理记录。</p>
      </div>
      <div className="wf-property">
        <label>审批摘要字段（最多6项）</label>
        <Select
          aria-label="审批摘要字段"
          mode="multiple"
          maxCount={6}
          style={{ width: '100%' }}
          value={settings.summaryFields ?? []}
          placeholder="不选择时使用前3个可见字段"
          options={schema.fields.map((f) => ({ value: f.key, label: f.label }))}
          onChange={(summaryFields) => set({ summaryFields })}
        />
      </div>
    </div>
  );
}
