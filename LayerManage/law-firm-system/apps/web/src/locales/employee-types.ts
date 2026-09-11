const employeeTypes: Record<string, string> = {
  PARTNER: '合伙人', LAWYER: '律师', SENIOR_LAWYER: '资深律师', JUNIOR_LAWYER: '初级律师',
  ASSISTANT: '助理', SALES: '销转', ADMIN: '行政', HR: '人事', FINANCE: '财务',
  OPERATOR: '运营', TECHNICAL: '技术', OTHER: '其他',
};

export const employeeTypeOptions = Object.entries(employeeTypes).map(([value, label]) => ({ value, label }));
export function employeeTypeLabel(value: string): string {
  return Object.hasOwn(employeeTypes, value) ? employeeTypes[value] : value || '-';
}
