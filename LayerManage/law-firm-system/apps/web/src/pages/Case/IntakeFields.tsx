import CaseSourceSelect from './CaseSourceSelect';
import type { Field } from '@/features/workspaces/types';
import { Checkbox, Col, DatePicker, Divider, Form, Input, InputNumber, Row, Select } from 'antd';
import { CASE_FIELD_ORDER, INTAKE_FIELDS, INTAKE_OPTIONS, intakeSelections } from './intake-contract';
import dayjs from 'dayjs';

export default function IntakeFields({
  contractLinked = false,
  handlingLawyer,
  handlingLawyerName,
  worksheetFields,
  departments,
  employees,
  createdAt,
  updatedAt,
}: {
  contractLinked?: boolean;
  handlingLawyer?: string;
  handlingLawyerName?: string;
  worksheetFields?: Field[];
  departments: { value: string; label: string }[];
  employees: { value: string; label: string }[];
  createdAt?: string;
  updatedAt?: string;
}) {
  const activeFields = INTAKE_FIELDS.filter(([key]) => CASE_FIELD_ORDER.includes('intake.' + key) && (!worksheetFields || worksheetFields.some(f=>f.options.businessKey==='intake.'+key)));
  const procedure = Form.useWatch(['intakeData', 'agencyProcedure']);
  return (
    <>
      {[...new Set(activeFields.map((field) => field[3]))].map((group) => (
        <div key={group}>
          <Divider titlePlacement="left">{group}</Divider>
          <Row gutter={16}>
            {activeFields
              .filter((field) => field[3] === group)
              .map(([key, label, kind]) => {
                if (key === 'customProcedure' && !intakeSelections(procedure).includes('自定义')) return null;
                const column=worksheetFields?.find(f=>f.options.businessKey==='intake.'+key);
                if(column?.options.worksheetMasked || column?.options.conditionalField)
                  return <Col key={key} xs={24} md={12}><Form.Item label={column.name}><Input disabled value="******" aria-label={column.name}/></Form.Item></Col>;
                const locked=column?.writable===false || (contractLinked && ['signedDate','contractNumber','region','customerPhone'].includes(key));
                return (
                  <Col xs={24} md={kind === 'textarea' ? 24 : 12} key={key}>
                    <Form.Item
                      name={['intakeData', key]}
                      label={column?.name || label}
                      valuePropName={kind === 'boolean' ? 'checked' : 'value'}
                      rules={[
                        ...(column?.required && !locked ? [{required:true}] : []),
                        ...(key === 'customProcedure'
                          ? [{ required: true, whitespace: true, message: '请输入自定义代理程序' }]
                          : []),
                        ...(key === 'customerPhone' && !contractLinked
                          ? [{ pattern: /^[+\d][\d\s()-]{2,29}$/, message: '请输入有效客户电话' }]
                          : []),
                      ]}
                    >
                      {kind === 'source' ? (
                        <CaseSourceSelect disabled={locked} />
                      ) : kind.startsWith('formula') ? (
                        <Input disabled aria-label={label} placeholder="待配置计算口径；已有数值保留" />
                      ) : kind === 'boolean' ? (
                        <Checkbox disabled={locked} aria-label={label} />
                      ) : kind === 'datetime' ? (
                        <DatePicker
                          disabled={locked}
                          showTime
                          format="YYYY/MM/DD HH:mm"
                          aria-label={label}
                          style={{ width: '100%' }}
                        />
                      ) : kind === 'money' ||
                        kind === 'ratio' ||
                        kind === 'number' ||
                        kind === 'integerRatio' ? (
                        <InputNumber disabled={locked}
                          aria-label={label}
                          stringMode
                          min="0"
                          max={kind === 'ratio' || kind === 'integerRatio' ? '100' : '9999999999999999.99'}
                          precision={kind === 'integerRatio' ? 0 : 2}
                          suffix={
                            kind === 'ratio' || kind === 'integerRatio'
                              ? '%'
                              : kind === 'money'
                                ? '元'
                                : undefined
                          }
                          style={{ width: '100%' }}
                        />
                      ) : kind === 'select' ||
                        kind === 'department' ||
                        kind === 'multi' ||
                        kind === 'user' ? (
                        <Select disabled={locked}
                          mode={kind === 'multi' ? 'multiple' : undefined}
                          aria-label={label}
                          showSearch
                          placeholder={key === 'handlingLawyer' ? '搜索姓名或工号，选择承办律师' : undefined}
                          labelRender={({ value, label }) =>
                            key === 'handlingLawyer' && value === handlingLawyer && handlingLawyerName
                              ? handlingLawyerName : label ?? String(value ?? '')}
                          optionFilterProp="label"
                          allowClear
                          options={
                            kind === 'department'
                              ? departments
                              : kind === 'user'
                                ? employees
                                : INTAKE_OPTIONS[key].map((value) => ({ value, label: value }))
                          }
                        />
                      ) : kind === 'textarea' ? (
                        <Input.TextArea disabled={locked} aria-label={label} rows={2} maxLength={2000} />
                      ) : (
                        <Input
                          disabled={locked}
                          aria-label={label}
                          maxLength={key === 'customerPhone' ? 30 : 200}
                        />
                      )}
                    </Form.Item>
                  </Col>
                );
              })}
          </Row>
        </div>
      ))}
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="记录创建时间">
            <Input
              disabled
              value={createdAt ? dayjs(createdAt).format('YYYY-MM-DD HH:mm:ss') : '保存后由系统生成'}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="最近修改时间">
            <Input
              disabled
              value={updatedAt ? dayjs(updatedAt).format('YYYY-MM-DD HH:mm:ss') : '保存后由系统生成'}
            />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}
