import { Form, Input } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { crmNameRules, phoneRules } from './form-rules';

function ContactForm({ onSubmit }: { onSubmit: (value: unknown) => void }) {
  return <Form onFinish={onSubmit}>
    <Form.Item name="name" label="姓名" rules={crmNameRules}><Input /></Form.Item>
    <Form.Item name="phone" label="电话" rules={phoneRules()}><Input /></Form.Item>
    <button type="submit">保存</button>
  </Form>;
}

test('customer and lead forms explain bad names and phones before submission and accept corrected landlines', async () => {
  const submit = vi.fn();
  render(<ContactForm onSubmit={submit} />);
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '张' } });
  fireEvent.change(screen.getByLabelText('电话'), { target: { value: '123abc' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.getByLabelText('电话')).toHaveAttribute('aria-invalid', 'true'));
  expect(screen.getByLabelText('姓名')).toHaveAttribute('aria-invalid', 'true');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '张律师' } });
  fireEvent.change(screen.getByLabelText('电话'), { target: { value: '+86 (010) 1234-5678' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: '张律师', phone: '+86 (010) 1234-5678' }));
});
