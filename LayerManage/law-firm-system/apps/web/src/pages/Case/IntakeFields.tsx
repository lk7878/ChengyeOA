import { Col, DatePicker, Divider, Form, Input, InputNumber, Row, Select } from 'antd';
import { INTAKE_FIELDS, INTAKE_OPTIONS } from './intake-contract';

export default function IntakeFields({ departments }: { departments: { value: string; label: string }[] }) {
  const procedure = Form.useWatch(['intakeData', 'agencyProcedure']);
  return <>
    {[...new Set(INTAKE_FIELDS.map(field => field[3]))].map(group => <div key={group}>
      <Divider titlePlacement="left">{group}</Divider>
      <Row gutter={16}>
        {INTAKE_FIELDS.filter(field => field[3] === group).map(([key, label, kind]) => {
          if (key === 'customProcedure' && procedure !== '自定义') return null;
          return <Col xs={24} md={kind === 'textarea' ? 24 : 12} key={key}>
            <Form.Item name={['intakeData', key]} label={label} rules={[
              ...(key === 'customProcedure' ? [{ required: true, whitespace: true, message: '请输入自定义代理程序' }] : []),
              ...(key === 'customerPhone' ? [{ pattern: /^[+\d][\d\s()-]{2,29}$/, message: '请输入有效客户电话' }] : []),
            ]}>
              {kind === 'date' ? <DatePicker aria-label={label} style={{ width: '100%' }} />
                : kind === 'money' || kind === 'ratio' ? <InputNumber aria-label={label} stringMode min="0" max={kind === 'ratio' ? '100' : '9999999999999999.99'} precision={2} suffix={kind === 'ratio' ? '%' : '元'} style={{ width: '100%' }} />
                : kind === 'select' || kind === 'department' ? <Select aria-label={label} showSearch optionFilterProp="label" allowClear options={kind === 'department' ? departments : INTAKE_OPTIONS[key].map(value => ({ value, label: value }))} />
                : kind === 'textarea' ? <Input.TextArea aria-label={label} rows={2} maxLength={2000} />
                : <Input aria-label={label} maxLength={key === 'customerPhone' ? 30 : 200} />}
            </Form.Item>
          </Col>;
        })}
      </Row>
    </div>)}
    <Row gutter={16}>
      <Col span={12}><Form.Item label="记录创建时间"><Input disabled value="保存后由系统生成" /></Form.Item></Col>
      <Col span={12}><Form.Item label="最近修改时间"><Input disabled value="保存后由系统生成" /></Form.Item></Col>
    </Row>
  </>;
}
