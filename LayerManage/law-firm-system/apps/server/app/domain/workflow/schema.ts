/** Versioned, JSON-only workflow contract. No executable expressions are accepted. */
export type FieldMode = 'EDIT' | 'READ' | 'HIDDEN';
export type Values = Record<string, unknown>;
export interface Condition {
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'present';
  value?: string | number | boolean;
}
export interface FormField {
  key: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'date'
    | 'select'
    | 'multi'
    | 'file'
    | 'user'
    | 'relation'
    | 'detail'
    | 'moneyUpper'
    | 'formula';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  options?: string[];
  visibleWhen?: Condition;
  requiredWhen?: Condition;
  children?: FormField[];
  formula?: { op: 'add' | 'subtract' | 'multiply' | 'divide' | 'sum'; fields: string[] };
  sourceField?: string;
  tableId?: string;
}
export interface AssigneeRule {
  type: 'USER' | 'ROLE' | 'MANAGER' | 'SUPERVISOR' | 'SELECT' | 'FIELD';
  ids?: string[];
  field?: string;
  levels?: number;
}
export interface FlowNode {
  id: string;
  name: string;
  type: 'START' | 'APPROVAL' | 'CC' | 'BRANCH' | 'END';
  x: number;
  y: number;
  rule?: AssigneeRule;
  mode?: 'ALL' | 'ANY' | 'SEQUENTIAL';
  skipRepeated?: boolean;
  timeoutHours?: number;
  timeoutAction?: 'REMIND' | 'APPROVE';
  fields?: Record<string, FieldMode>;
  roleFields?: Record<string, Record<string, FieldMode>>;
}
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  condition?: Condition;
}
export interface WorkflowSchema {
  fields: FormField[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  binding?: {
    tableId: string;
    mode: 'UPDATE' | 'CREATE';
    mappings: Array<{ field: string; target: string }>;
  };
  webhook?: string;
}
export class WorkflowError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}
export function check(ok: unknown, message: string, status = 422): asserts ok {
  if (!ok) throw new WorkflowError(message, status);
}
const keyPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const modes = ['EDIT', 'READ', 'HIDDEN'];
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const types = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multi',
  'file',
  'user',
  'relation',
  'detail',
  'moneyUpper',
  'formula',
];
export const empty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
export function matches(c: Condition | undefined, values: Values): boolean {
  if (!c) return true;
  const a = values[c.field],
    b = c.value;
  if (c.op === 'present') return !empty(a);
  if (c.op === 'eq') return a === b;
  if (c.op === 'ne') return a !== b;
  if (c.op === 'contains')
    return Array.isArray(a) ? a.includes(b) : typeof a === 'string' && a.includes(String(b));
  if (empty(a) || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false;
  return c.op === 'gt'
    ? Number(a) > Number(b)
    : c.op === 'gte'
      ? Number(a) >= Number(b)
      : c.op === 'lt'
        ? Number(a) < Number(b)
        : Number(a) <= Number(b);
}
function condition(c: Condition | undefined, keys: Set<string>) {
  if (!c) return;
  check(
    keys.has(c.field) && ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'present'].includes(c.op),
    '条件引用了不存在的字段或运算符',
  );
  check(c.op === 'present' || ['string', 'number', 'boolean'].includes(typeof c.value), '请填写条件比较值');
}
export function validateSchema(raw: unknown): WorkflowSchema {
  check(raw && typeof raw === 'object' && !Array.isArray(raw), '流程配置格式错误');
  const s = raw as WorkflowSchema;
  check(
    Array.isArray(s.fields) &&
      s.fields.length <= 80 &&
      Array.isArray(s.nodes) &&
      s.nodes.length <= 80 &&
      Array.isArray(s.edges) &&
      s.edges.length <= 160,
    '表单或流程大小超出限制',
  );
  check(
    [...s.fields, ...s.nodes, ...s.edges].every((x) => x && typeof x === 'object' && !Array.isArray(x)),
    '字段、节点或连线格式错误',
  );
  const keys = new Set(s.fields.map((f) => f.key));
  check(keys.size === s.fields.length, '表单字段标识不能重复');
  function fields(list: FormField[], child = false) {
    check(list.length <= 80 && list.every(object), '明细字段格式错误或数量过多');
    const localKeys = new Set(list.map((f) => f.key));
    check(localKeys.size === list.length, '明细字段标识不能重复');
    for (const f of list) {
      check(
        keyPattern.test(f.key) &&
          !['__proto__', 'prototype', 'constructor'].includes(f.key) &&
          typeof f.label === 'string' &&
          f.label.trim() &&
          f.label.length <= 100 &&
          types.includes(f.type),
        '字段名称、标识或类型无效',
      );
      for (const n of [f.minLength, f.maxLength])
        check(
          n === undefined || (Number.isSafeInteger(n) && n >= 0 && n <= 2000),
          '字段长度限制必须介于0至2000',
        );
      check(
        f.minLength === undefined || f.maxLength === undefined || f.minLength <= f.maxLength,
        '最小长度不能大于最大长度',
      );
      check(f.required === undefined || typeof f.required === 'boolean', '必填配置格式错误');
      check(f.pattern === undefined || typeof f.pattern === 'string', '正则表达式格式错误');
      if (f.pattern) {
        // Deliberately a bounded regular-expression subset; no groups, alternation or backrefs.
        check(
          (f.pattern.match(/(?<!\\)[*+?{]/g) ?? []).length <= 1 &&
            f.pattern.length <= 120 &&
            !/[()|]/.test(f.pattern) &&
            !/\\[1-9]/.test(f.pattern) &&
            !/[+*?}]\s*[+*?{]/.test(f.pattern),
          '正则仅支持基础字符、字符集、锚点与单次量词，不支持分组或回溯引用',
        );
        try {
          new RegExp(f.pattern);
        } catch {
          throw new WorkflowError('正则表达式格式错误');
        }
      }
      if (['select', 'multi'].includes(f.type))
        check(
          Array.isArray(f.options) &&
            f.options.length > 0 &&
            f.options.length <= 100 &&
            f.options.every((o) => typeof o === 'string' && o.length <= 100) &&
            new Set(f.options).size === f.options.length,
          '请选择控件的选项，且选项不能重复',
        );
      condition(f.visibleWhen, child ? localKeys : keys);
      condition(f.requiredWhen, child ? localKeys : keys);
      if (f.type === 'detail') {
        check(
          !child && Array.isArray(f.children) && f.children.length > 0,
          '明细表仅支持一层，且必须包含字段',
        );
        fields(f.children, true);
      }
      check(
        !child || !['formula', 'moneyUpper', 'file', 'relation'].includes(f.type),
        '明细列支持基础控件和人员控件',
      );
      if (f.type === 'relation')
        check(typeof f.tableId === 'string' && f.tableId.length > 0, '请选择关联业务数据表');
      if (f.type === 'moneyUpper')
        check(
          keys.has(f.sourceField!) && s.fields.find((x) => x.key === f.sourceField)?.type === 'number',
          '金额大写须关联数字字段',
        );
      if (f.type === 'formula') {
        check(
          f.formula &&
            ['add', 'subtract', 'multiply', 'divide', 'sum'].includes(f.formula.op) &&
            Array.isArray(f.formula.fields) &&
            f.formula.fields.length > 0 &&
            f.formula.fields.length <= 20,
          '请配置公式运算与输入字段',
        );
        for (const ref of f.formula.fields) {
          check(typeof ref === 'string' && ref.split('.').length <= 2, '公式引用格式错误');
          const [a, b] = ref.split('.');
          const source = s.fields.find((x) => x.key === a);
          check(
            b
              ? f.formula.op === 'sum' &&
                  source?.type === 'detail' &&
                  source.children?.some((x) => x.key === b && x.type === 'number')
              : source?.type === 'number',
            '公式仅引用数字字段，明细求和使用“明细.数字列”',
          );
        }
      }
    }
  }
  fields(s.fields);
  check(
    s.nodes.filter((n) => n.type === 'START').length === 1 && s.nodes.some((n) => n.type === 'END'),
    '流程需要一个发起节点和至少一个结束节点',
  );
  const ids = new Set(s.nodes.map((n) => n.id));
  check(
    ids.size === s.nodes.length && new Set(s.edges.map((e) => e.id)).size === s.edges.length,
    '节点或连线标识重复',
  );
  for (const n of s.nodes) {
    check(
      keyPattern.test(n.id) &&
        typeof n.name === 'string' &&
        n.name.trim() &&
        n.name.length <= 100 &&
        ['START', 'END', 'APPROVAL', 'CC', 'BRANCH'].includes(n.type) &&
        Number.isFinite(n.x) &&
        Number.isFinite(n.y),
      '节点配置无效',
    );
    if (n.type === 'APPROVAL' || n.type === 'CC') {
      check(
        n.rule && ['USER', 'ROLE', 'MANAGER', 'SUPERVISOR', 'SELECT', 'FIELD'].includes(n.rule.type),
        '请配置审批或抄送人员',
      );
      if (n.rule.type === 'USER' || n.rule.type === 'ROLE')
        check(
          Array.isArray(n.rule.ids) &&
            n.rule.ids.length > 0 &&
            n.rule.ids.length <= 50 &&
            n.rule.ids.every((id) => typeof id === 'string' && id.length <= 100),
          '请选择成员或角色',
        );
      if (n.rule.type === 'FIELD')
        check(
          s.fields.some((f) => f.key === n.rule!.field && f.type === 'user'),
          '表单审批人必须来自人员控件',
        );
      if (n.rule.type === 'SUPERVISOR')
        check(
          Number.isInteger(n.rule.levels) && n.rule.levels! >= 1 && n.rule.levels! <= 10,
          '主管层级须为1至10',
        );
      if (n.rule.type === 'SUPERVISOR') check(!n.mode || n.mode === 'SEQUENTIAL', '连续主管必须使用依次审批');
      check(!n.mode || ['ALL', 'ANY', 'SEQUENTIAL'].includes(n.mode), '审批方式无效');
      if (n.timeoutHours !== undefined)
        check(
          Number.isFinite(n.timeoutHours) &&
            n.timeoutHours >= 1 &&
            n.timeoutHours <= 8760 &&
            ['REMIND', 'APPROVE'].includes(n.timeoutAction!),
          '超时须为1至8760小时并指定处理方式',
        );
    }
    check(n.roleFields === undefined || object(n.roleFields), '角色字段权限格式错误');
    for (const map of [n.fields ?? {}, ...Object.values(n.roleFields ?? {})]) {
      check(object(map), '节点字段权限格式错误');
      for (const [k, v] of Object.entries(map))
        check(keys.has(k) && modes.includes(v), '节点字段权限配置无效');
    }
    const outgoing = s.edges.filter((e) => e.from === n.id);
    check(
      n.type === 'END'
        ? outgoing.length === 0
        : n.type === 'BRANCH'
          ? outgoing.length >= 2 && outgoing.filter((e) => !e.condition).length === 1
          : outgoing.length === 1,
      '普通节点须有一条连线；分支须有条件路径和唯一默认路径；结束节点不能有出线',
    );
  }
  for (const e of s.edges) {
    check(ids.has(e.from) && ids.has(e.to) && e.from !== e.to, '连线引用无效节点');
    condition(e.condition, keys);
    check(
      !e.condition || s.nodes.find((n) => n.id === e.from)?.type === 'BRANCH',
      '条件仅可配置在分支连线上',
    );
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string) {
    check(!visiting.has(id), '流程连线不能构成循环，请使用退回操作');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const e of s.edges.filter((e) => e.from === id)) visit(e.to);
    visiting.delete(id);
    visited.add(id);
  }
  visit(s.nodes.find((n) => n.type === 'START')!.id);
  check(visited.size === ids.size, '存在未连接到发起节点的孤立节点');
  if (s.binding) {
    check(
      typeof s.binding.tableId === 'string' &&
        ['CREATE', 'UPDATE'].includes(s.binding.mode) &&
        Array.isArray(s.binding.mappings) &&
        s.binding.mappings.every(object) &&
        s.binding.mappings.length > 0,
      '请配置回写目标和字段映射',
    );
    check(
      new Set(s.binding.mappings.map((m) => m.target)).size === s.binding.mappings.length,
      '回写目标字段不能重复',
    );
    for (const m of s.binding.mappings)
      check(
        keys.has(m.field) && typeof m.target === 'string' && m.target.length > 0,
        '回写映射引用了不存在的字段',
      );
  }
  if (s.webhook) check(/^[a-zA-Z0-9_-]{1,64}$/.test(s.webhook), '请选择已配置的自动化接口');
  return s;
}
export function fieldMode(n: FlowNode, key: string, roles: string[] = []): FieldMode {
  const overrides = roles.map((r) => n.roleFields?.[r]?.[key]).filter(Boolean);
  if (overrides.includes('HIDDEN')) return 'HIDDEN';
  if (overrides.includes('READ')) return 'READ';
  return overrides.includes('EDIT') ? 'EDIT' : (n.fields?.[key] ?? (n.type === 'START' ? 'EDIT' : 'READ'));
}
export function moneyUpper(value: number): string {
  check(Number.isFinite(value) && value >= 0 && value < 1e12, '金额大写仅支持0至一万亿以内金额');
  const digits = '零壹贰叁肆伍陆柒捌玖',
    units = ['', '拾', '佰', '仟'];
  const cents = Math.round(value * 100),
    integer = Math.floor(cents / 100);
  const group = (v: number) => {
    let out = '',
      zero = false;
    for (let i = 3; i >= 0; i--) {
      const d = Math.floor(v / 10 ** i) % 10;
      if (d) {
        if (zero) out += '零';
        out += digits[d] + units[i];
        zero = false;
      } else if (out) zero = true;
    }
    return out;
  };
  let out = '';
  const parts = [Math.floor(integer / 1e8), Math.floor(integer / 1e4) % 10000, integer % 10000];
  parts.forEach((p, i) => {
    if (p) {
      if (out && (p < 1000 || (i === 2 && !parts[1]))) out += '零';
      out += group(p) + ['亿', '万', ''][i];
    }
  });
  out = (out || '零') + '元';
  const j = Math.floor(cents / 10) % 10,
    f = cents % 10;
  return out + (!j && !f ? '整' : (j ? digits[j] + '角' : f ? '零' : '') + (f ? digits[f] + '分' : ''));
}
export function calculate(fields: FormField[], values: Values): Values {
  const result = { ...values };
  for (const f of fields) {
    if (f.type === 'moneyUpper')
      result[f.key] = empty(result[f.sourceField!]) ? null : moneyUpper(Number(result[f.sourceField!]));
    if (f.type === 'formula' && f.formula) {
      const nums = f.formula.fields.flatMap((ref) => {
        const [a, b] = ref.split('.');
        return b
          ? Array.isArray(result[a])
            ? (result[a] as Values[]).map((row) => Number(row[b] ?? 0))
            : []
          : [Number(result[a] ?? 0)];
      });
      let n = f.formula.op === 'multiply' ? 1 : (nums[0] ?? 0);
      if (f.formula.op === 'sum' || f.formula.op === 'add') n = nums.reduce((a, b) => a + b, 0);
      else
        for (const v of f.formula.op === 'multiply' ? nums : nums.slice(1)) {
          if (f.formula.op === 'divide') {
            check(v !== 0, `${f.label}：除数不能为零`);
            n /= v;
          } else if (f.formula.op === 'subtract') n -= v;
          else n *= v;
        }
      check(Number.isFinite(n), `${f.label}：公式结果无效`);
      result[f.key] = Math.round(n * 1e8) / 1e8;
    }
  }
  return result;
}
export function validateValues(fields: FormField[], values: Values, requiredKeys?: Set<string>): Values {
  check(values && typeof values === 'object' && !Array.isArray(values), '表单数据格式错误');
  check(
    Object.keys(values).every((k) => fields.some((f) => f.key === k)),
    '表单包含未知字段',
  );
  const result = calculate(fields, values);
  for (const f of fields) {
    const v = result[f.key];
    if (!matches(f.visibleWhen, result)) continue;
    if (
      (f.required || (f.requiredWhen && matches(f.requiredWhen, result))) &&
      (!requiredKeys || requiredKeys.has(f.key))
    )
      check(!empty(v), `请填写${f.label}`);
    if (empty(v)) continue;
    if (['text', 'textarea', 'date', 'select', 'user', 'moneyUpper'].includes(f.type))
      check(typeof v === 'string' && v.length <= 2000, `${f.label}：文本格式无效`);
    if (typeof v === 'string') {
      check(
        v.length >= (f.minLength ?? 0) && v.length <= (f.maxLength ?? 2000),
        `${f.label}：长度不符合要求`,
      );
      if (f.pattern) check(new RegExp(f.pattern).test(v), `${f.label}：格式不符合要求`);
    }
    if (f.type === 'date')
      check(
        /^\d{4}-\d{2}-\d{2}$/.test(String(v)) &&
          Number.isFinite(Date.parse(String(v))) &&
          new Date(String(v)).toISOString().startsWith(String(v)),
        `${f.label}：日期无效`,
      );
    if (['number', 'formula'].includes(f.type))
      check(typeof v === 'number' && Number.isFinite(v), `${f.label}：请输入有限数字`);
    if (f.type === 'select') check(f.options?.includes(String(v)), `${f.label}：选项无效`);
    if (f.type === 'multi')
      check(
        Array.isArray(v) && v.length <= 100 && v.every((x) => f.options?.includes(x)),
        `${f.label}：选项无效`,
      );
    if (f.type === 'file')
      check(
        Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === 'string' && x.length <= 100),
        `${f.label}：附件格式无效`,
      );
    if (f.type === 'relation') check(typeof v === 'string' && v.length <= 100, `${f.label}：请选择业务记录`);
    if (f.type === 'detail') {
      check(Array.isArray(v) && v.length <= 200, `${f.label}：明细最多200行`);
      result[f.key] = v.map((row) => validateValues(f.children!, row));
    }
  }
  return result;
}
