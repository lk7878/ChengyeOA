import { INTAKE_FIELDS, INTAKE_OPTIONS } from '../case/intake-contract';

export function editableCaseKey(key: string) {
  return (
    ['title', 'caseType', 'priority', 'lawyerId', 'fee'].includes(key) ||
    INTAKE_FIELDS.some(([name, , kind]) => name !== 'customerPhone' && key === 'intake.' + name && !kind.startsWith('formula'))
  );
}

export function caseGridChoices(key: string) {
  if (key === 'priority')
    return [
      { id: 'LOW', name: '低' },
      { id: 'NORMAL', name: '普通' },
      { id: 'HIGH', name: '高' },
      { id: 'URGENT', name: '紧急' },
    ];
  const field = INTAKE_FIELDS.find(([name]) => key === 'intake.' + name);
  return field?.[2] === 'select' || field?.[2] === 'multi'
    ? INTAKE_OPTIONS[field[0]].map((name) => ({ id: name, name }))
    : undefined;
}
