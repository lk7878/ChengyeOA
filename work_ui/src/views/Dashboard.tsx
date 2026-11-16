import { useEffect, useMemo, useState } from 'react'
import type { CaseRecord, Account, CaseStage, CaseKind, ViewId } from '@/types'
import { CASE_STAGE_LABELS, CASE_KIND_LABELS, ROLE_LABELS, kindToView } from '@/types'
import { listCases } from '@/api/client'
import { Button } from '@/components/Button'
import { Tag } from '@/components/Tag'
import { StageTag, PriorityTag } from '@/components/StatusTags'
import { IconSpark, IconBook, IconExternal, IconCase, IconAccount, IconChevron } from '@/components/icons'
import { EXTERNAL_LINKS } from '@/config/links'
import './Dashboard.css'

export interface DashboardProps {
  accounts: Account[]
  onNavigate: (v: ViewId) => void
  onOpenExternal: (id: 'ai_assistant' | 'knowledge_base') => void
  showAccounts?: boolean
  currentUser?: Account | null
}

export function Dashboard({ accounts, onNavigate, onOpenExternal, showAccounts, currentUser }: DashboardProps) {
  const [cases, setCases] = useState<CaseRecord[]>([])
  useEffect(() => {
    listCases().then((r) => setCases(r.cases ?? [])).catch(() => setCases([]))
  }, [])
  const stats = useMemo(() => {
    const byStage = new Map<CaseStage, number>()
    for (const c of cases) byStage.set(c.stage, (byStage.get(c.stage) ?? 0) + 1)
    const active = cases.filter((c) => c.stage !== 'closed').length
    return {
      total: cases.length,
      active,
      byStage,
    }
  }, [cases])

  const accountStats = useMemo(() => {
    const active = accounts.filter((a) => a.status === 'active').length
    const pending = accounts.filter((a) => a.status === 'pending').length
    const byRole = new Map<string, number>()
    for (const a of accounts) {
      for (const r of a.roles) byRole.set(r, (byRole.get(r) ?? 0) + 1)
    }
    return { total: accounts.length, active, pending, byRole }
  }, [accounts])

  const recent = useMemo(
    () => [...cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    [cases],
  )

  return (
    <div className="wb-dash">
      <section className="wb-dash__hero">
        <div className="wb-dash__heroText">
          <h2>承业智慧办案</h2>
          <p>
            按伤残鉴定、伤情鉴定、医疗损害司法鉴定、交通事故鉴定分库管理案件，并可进入知识库浏览已发布的专业知识。
          </p>
          <div className="wb-dash__heroActions">
            <Button variant="primary" icon={<IconSpark size={16} />} onClick={() => onOpenExternal('ai_assistant')}>
              打开 AI 助手
              <IconExternal size={13} />
            </Button>
            <Button variant="outline" icon={<IconBook size={16} />} onClick={() => onNavigate('knowledge')}>
              知识库
            </Button>
          </div>
        </div>
      </section>

      <section className="wb-dash__stats">
        {(Object.keys(CASE_KIND_LABELS) as CaseKind[]).map((kind) => {
          const count = cases.filter((c) => c.kind === kind).length
          const active = cases.filter((c) => c.kind === kind && c.stage !== 'closed').length
          return (
            <StatCard
              key={kind}
              label={CASE_KIND_LABELS[kind]}
              value={count}
              hint={`进行中 ${active}`}
              icon={<IconCase size={18} />}
              onClick={() => onNavigate(kindToView(kind))}
            />
          )
        })}
        {showAccounts ? (
          <StatCard label="账号总数" value={accountStats.total} hint={`正常 ${accountStats.active} · 待激活 ${accountStats.pending}`} icon={<IconAccount size={18} />} onClick={() => onNavigate('accounts')} />
        ) : (
          <StatCard label="当前账号" value={1} hint={currentUser?.displayName || '已登录'} icon={<IconAccount size={18} />} />
        )}
      </section>

      <section className="wb-dash__panels">
        <div className="wb-dash__panel">
          <div className="wb-dash__panelHead">
            <h3>案件阶段分布</h3>
            <Button size="sm" variant="ghost" onClick={() => onNavigate('cases_general')}>
              查看案件 <IconChevron size={14} />
            </Button>
          </div>
          <div className="wb-dash__stageBars">
            {Object.entries(CASE_STAGE_LABELS).map(([id, label]) => {
              const count = stats.byStage.get(id as CaseStage) ?? 0
              const pct = stats.total ? (count / stats.total) * 100 : 0
              return (
                <div key={id} className="wb-dash__stageRow">
                  <span className="wb-dash__stageLabel">{label}</span>
                  <div className="wb-dash__stageTrack">
                    <div className="wb-dash__stageFill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="wb-dash__stageCount">{count}</span>
                </div>
              )
            })}
          </div>
        </div>

        {showAccounts ? (
        <div className="wb-dash__panel">
          <div className="wb-dash__panelHead">
            <h3>角色分布</h3>
            <Button size="sm" variant="ghost" onClick={() => onNavigate('accounts')}>
              管理账号 <IconChevron size={14} />
            </Button>
          </div>
          <div className="wb-dash__roleChips">
            {Object.entries(ROLE_LABELS).map(([id, label]) => (
              <Tag key={id} tone="business">
                {label} · {accountStats.byRole.get(id) ?? 0}
              </Tag>
            ))}
          </div>
        </div>
        ) : (
        <div className="wb-dash__panel">
          <div className="wb-dash__panelHead">
            <h3>可见范围</h3>
          </div>
          <p className="wb-dash__modelsHint">只显示你负责或被指派的案件。知识库按目标库授权开放，未发布投稿不进入检索。</p>
        </div>
        )}
      </section>

      <section className="wb-dash__panel">
        <div className="wb-dash__panelHead">
          <h3>最近更新案件</h3>
          <Button size="sm" variant="ghost" onClick={() => onNavigate('cases_general')}>
            查看案件 <IconChevron size={14} />
          </Button>
        </div>
        <div className="wb-dash__recent">
          {recent.map((c) => (
            <button key={c.id} className="wb-dash__recentRow" onClick={() => onNavigate(kindToView(c.kind))}>
              <div className="wb-dash__recentMain">
                <span className="wb-dash__recentId">{c.id}</span>
                <span className="wb-dash__recentTitle">{c.title}</span>
              </div>
              <div className="wb-dash__recentMeta">
                <Tag>{CASE_KIND_LABELS[c.kind]}</Tag>
                <Tag>{c.category || '—'}</Tag>
                <StageTag stage={c.stage} />
                <PriorityTag priority={c.priority} />
                <span className="wb-dash__recentDate">{c.updatedAt}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="wb-dash__links">
        <LinkCard
          icon={<IconSpark size={20} />}
          title={EXTERNAL_LINKS.ai_assistant.label}
          desc="进入通用法律助手。任务与私人会话仅本人可见，材料需要明确选择。"
          href="从案件进入"
          onClick={() => onOpenExternal('ai_assistant')}
          primary
        />
        <LinkCard
          icon={<IconBook size={20} />}
          title="知识库"
          desc="查看获授权知识库的已发布条目与内容。"
          href="工作台 · 知识库"
          onClick={() => onNavigate('knowledge')}
          external={false}
        />
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
  onClick,
}: {
  label: string
  value: number
  hint: string
  icon?: React.ReactNode
  tone?: 'warn' | 'info'
  onClick?: () => void
}) {
  return (
    <button
      className={onClick ? 'wb-dash__stat is-clickable' : 'wb-dash__stat'}
      onClick={onClick}
      data-tone={tone}
    >
      <div className="wb-dash__statIcon">{icon}</div>
      <div className="wb-dash__statBody">
        <div className="wb-dash__statValue">{value}</div>
        <div className="wb-dash__statLabel">{label}</div>
        <div className="wb-dash__statHint">{hint}</div>
      </div>
    </button>
  )
}

function LinkCard({
  icon,
  title,
  desc,
  href,
  onClick,
  primary,
  external = true,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  href: string
  onClick: () => void
  primary?: boolean
  external?: boolean
}) {
  return (
    <button className={primary ? 'wb-dash__link is-primary' : 'wb-dash__link'} onClick={onClick}>
      <div className="wb-dash__linkIcon">{icon}</div>
      <div className="wb-dash__linkBody">
        <div className="wb-dash__linkTitle">
          {title}
          {external && <IconExternal size={14} />}
        </div>
        <div className="wb-dash__linkDesc">{desc}</div>
        <div className="wb-dash__linkHref">{href}</div>
      </div>
    </button>
  )
}
