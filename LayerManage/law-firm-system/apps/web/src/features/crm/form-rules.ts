import type { Rule } from 'antd/es/form';

export const crmNameRules: Rule[] = [{ required: true, min: 2, max: 100,
  transform: value => typeof value === 'string' ? value.trim() : value,
  message: '姓名须为 2–100 个字符，不能仅填写空格',
}];

export function phoneRules(required = true): Rule[] {
  return [{ validator: async (_, raw: string | undefined) => {
    if (!required && !raw?.trim()) return;
    if (!raw || !/^[0-9+\-() ]+$/.test(raw) || raw.replace(/\D/g, '').length < 7) {
      throw new Error('电话至少包含 7 位数字，仅支持数字、空格、横线、括号和加号');
    }
  } }];
}
