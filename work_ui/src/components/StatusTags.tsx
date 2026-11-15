import type {
  CasePriority,
  CaseStage,
  CaseKind,
  AccountStatus,
} from '@/types'
import {
  CASE_PRIORITY_LABELS,
  CASE_STAGE_LABELS,
  CASE_KIND_LABELS,
  ACCOUNT_STATUS_LABELS,
  normalizeCaseStage,
  normalizeCaseKind,
} from '@/types'
import { Tag, type TagTone } from '@/components/Tag'
import './Tag.css'

const STAGE_TONE: Record<CaseStage, TagTone> = {
  intake: 'neutral',
  processing: 'business',
  review: 'warn',
  closed: 'neutral',
}

const PRIORITY_TONE: Record<CasePriority, TagTone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warn',
  urgent: 'error',
}

const STATUS_TONE: Record<AccountStatus, TagTone> = {
  active: 'success',
  disabled: 'neutral',
  pending: 'warn',
}

export function KindTag({ kind }: { kind: CaseKind }) {
  return <Tag tone="business">{CASE_KIND_LABELS[normalizeCaseKind(kind)]}</Tag>
}

export function StageTag({ stage }: { stage: CaseStage }) {
  const current = normalizeCaseStage(stage)
  return (
    <Tag tone={STAGE_TONE[current]} dot>
      {CASE_STAGE_LABELS[current]}
    </Tag>
  )
}

export function StageSelect({
  stage,
  disabled,
  onChange,
}: {
  stage: CaseStage
  disabled?: boolean
  onChange: (stage: CaseStage) => void
}) {
  const current = normalizeCaseStage(stage)
  return (
    <label className={`wb-stageSelect wb-tag wb-tag--${STAGE_TONE[current]}`}>
      <span className="wb-tag__dot" />
      <select
        value={current}
        disabled={disabled}
        aria-label="更换案件状态"
        onChange={(e) => onChange(e.target.value as CaseStage)}
      >
        {Object.entries(CASE_STAGE_LABELS).map(([id, label]) => (
          <option key={id} value={id}>{label}</option>
        ))}
      </select>
    </label>
  )
}

export function PriorityTag({ priority }: { priority: CasePriority }) {
  return <Tag tone={PRIORITY_TONE[priority]}>{CASE_PRIORITY_LABELS[priority]}</Tag>
}

export function AccountStatusTag({ status }: { status: AccountStatus }) {
  return (
    <Tag tone={STATUS_TONE[status]} dot>
      {ACCOUNT_STATUS_LABELS[status]}
    </Tag>
  )
}
