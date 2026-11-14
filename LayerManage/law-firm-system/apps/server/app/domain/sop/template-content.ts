import {
  assertExactKeys,
  normalizeRequiredText,
  normalizeStableCode,
} from '../master-data/master-data-validation';
import { MasterDataError } from '../master-data/master-data-errors';
export const sopFail = (code: string, status = 400): never => {
  throw new MasterDataError(code, status);
};
export interface SopMaterial {
  code: string;
  name: string;
  required: boolean;
  instruction: string;
}
export interface SopNode {
  code: string;
  name: string;
  instruction: string;
  dependsOn: string[];
  materials: SopMaterial[];
  reviewRequired: boolean;
  reviewerRoleId: string | null;
  reminderDays: number | null;
  closeGate: boolean;
}
export interface SopContent {
  schemaVersion: 1;
  nodes: SopNode[];
}
function bool(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') return sopFail('VALIDATION_FAILED');
  return value;
}
function note(value: unknown): string {
  return value === undefined || value === '' ? '' : normalizeRequiredText(value, 1, 2000);
}
export function parseSopContent(raw: unknown): SopContent {
  assertExactKeys(raw, ['schemaVersion', 'nodes']);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 50)
    return sopFail('SOP_NODES_INVALID');
  const nodes: SopNode[] = raw.nodes.map((value) => {
    assertExactKeys(value, [
      'code',
      'name',
      'instruction',
      'dependsOn',
      'materials',
      'reviewRequired',
      'reviewerRoleId',
      'reminderDays',
      'closeGate',
    ]);
    if (value.dependsOn !== undefined && (!Array.isArray(value.dependsOn) || value.dependsOn.length > 50))
      sopFail('SOP_DEPENDENCIES_INVALID');
    if (value.materials !== undefined && (!Array.isArray(value.materials) || value.materials.length > 30))
      sopFail('SOP_MATERIALS_INVALID');
    const materials = ((value.materials || []) as unknown[]).map((item) => {
      assertExactKeys(item, ['code', 'name', 'required', 'instruction']);
      return {
        code: normalizeStableCode(item.code),
        name: normalizeRequiredText(item.name, 1, 100),
        required: bool(item.required),
        instruction: note(item.instruction),
      };
    });
    if (new Set(materials.map((item) => item.code)).size !== materials.length)
      sopFail('SOP_MATERIALS_DUPLICATE');
    const days = value.reminderDays;
    if (
      days !== undefined &&
      days !== null &&
      (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365)
    )
      sopFail('SOP_REMINDER_INVALID');
    return {
      code: normalizeStableCode(value.code),
      name: normalizeRequiredText(value.name, 1, 100),
      instruction: note(value.instruction),
      dependsOn: ((value.dependsOn || []) as unknown[]).map(normalizeStableCode),
      materials,
      reviewRequired: bool(value.reviewRequired),
      reviewerRoleId:
        value.reviewerRoleId === undefined || value.reviewerRoleId === null
          ? null
          : normalizeRequiredText(value.reviewerRoleId, 1, 100),
      reminderDays: (days ?? null) as number | null,
      closeGate: bool(value.closeGate),
    };
  });
  const index = new Map(nodes.map((node) => [node.code, node]));
  if (index.size !== nodes.length) sopFail('SOP_NODE_DUPLICATE');
  const done = new Set<string>(),
    visiting = new Set<string>();
  function visit(code: string) {
    if (done.has(code)) return;
    if (visiting.has(code)) sopFail('SOP_DEPENDENCY_CYCLE');
    const node = index.get(code);
    if (!node) return sopFail('SOP_DEPENDENCY_MISSING');
    visiting.add(code);
    for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(code);
    done.add(code);
  }
  nodes.forEach((node) => visit(node.code));
  return { schemaVersion: 1, nodes };
}
export const SOP_PRESETS = [
  {
    code: 'MEDICAL',
    name: '医疗纠纷',
    names: [
      '客户到访',
      '病历收集',
      '材料完整性核验',
      '病历分析报告',
      '目标对齐',
      '正式签约',
      '深度分析报告',
      '证据收集与鉴定诉讼调解',
      '结案复盘',
    ],
  },
  {
    code: 'EXECUTION',
    name: '执行',
    names: [
      '证据收集和分析委托',
      '全面网查与证据收集',
      '案件分析报告',
      '执行可能性判断',
      '目标对齐与正式签约',
      '深度分析和执行方案',
      '衍生诉讼与执行措施',
      '执行进展更新',
      '结案复盘',
    ],
  },
  {
    code: 'CRIMINAL',
    name: '刑事辩护',
    names: [
      '首次接待',
      '会见提纲',
      '会见',
      '委托合同',
      '不予提捕不予批捕意见',
      '取保候审申请',
      '办案机关沟通提纲',
      '陈述意见',
      '阅卷笔录',
      '开庭提纲',
      '质证意见',
      '辩护词',
    ],
  },
].map((preset) => ({
  code: preset.code,
  name: preset.name,
  content: parseSopContent({
    schemaVersion: 1,
    nodes: preset.names.map((name, index) => ({
      code:
        preset.code === 'CRIMINAL'
          ? [
              'CR_FIRST_RECEPTION',
              'CR_MEETING_OUTLINE',
              'CR_MEETING',
              'CR_RETENTION',
              'CR_NO_ARREST_OPINION',
              'CR_BAIL_APPLICATION',
              'CR_AUTHORITY_COMMUNICATION',
              'CR_STATEMENT',
              'CR_FILE_REVIEW',
              'CR_TRIAL_OUTLINE',
              'CR_CROSS_EXAMINATION',
              'CR_DEFENSE_STATEMENT',
            ][index]
          : preset.code + '_' + String(index + 1).padStart(2, '0'),
      name,
    })),
  }),
}));
