import { Button } from './Button'
import { IconSpark, IconBook, IconExternal, IconMoon, IconSun } from './icons'
import type { Account, ViewId } from '@/types'
import { EXTERNAL_LINKS } from '@/config/links'
import { ROLE_LABELS } from '@/types'
import { formatBalance, type LlmStatus } from '@/api/client'
import './TopBar.css'

export interface TopBarProps {
  title: string
  subtitle?: string
  onOpenExternal: (id: 'ai_assistant' | 'knowledge_base') => void
  onNavigate?: (v: ViewId) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  llm?: LlmStatus | null
  user: Account
  onLogout: () => void
  showBalance?: boolean
}

export function TopBar({
  title, subtitle, onOpenExternal, onNavigate, theme, onToggleTheme, llm, user, onLogout, showBalance,
}: TopBarProps) {
  const balanceText = llm
    ? (llm.balance.hidden
      ? '—'
      : (llm.balance.ok ? formatBalance(llm.balance.amount, llm.balance.currency) : (llm.balance.configured ? '查询失败' : '未配置')))
    : '…'
  const balanceTone = llm?.balance.ok && (llm.balance.amount ?? 0) < 20 ? 'low' : 'ok'

  return (
    <header className="wb-topbar">
      <div className="wb-topbar__title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>

      <div className="wb-topbar__actions">
        {showBalance ? (
          <div
            className="wb-topbar__balance"
            data-tone={balanceTone}
            title={llm?.balance.error || `CloseAI ${llm?.providerLabel || ''} · 主模型 ${llm?.defaultModel || ''}`}
          >
            <span className="wb-topbar__balanceLabel">余额</span>
            <span className="wb-topbar__balanceValue">{balanceText}</span>
          </div>
        ) : null}
        <Button variant="outline" onClick={onToggleTheme} icon={theme === 'light' ? <IconMoon size={16} /> : <IconSun size={16} />}>
          {theme === 'light' ? '深色' : '浅色'}
        </Button>
        <Button
          variant="outline"
          onClick={() => onNavigate ? onNavigate('knowledge') : onOpenExternal('knowledge_base')}
          icon={<IconBook size={16} />}
        >
          知识库
        </Button>
        <Button
          variant="primary"
          onClick={() => onOpenExternal('ai_assistant')}
          icon={<IconSpark size={16} />}
        >
          {EXTERNAL_LINKS.ai_assistant.label}
          <IconExternal size={13} />
        </Button>

        <div className="wb-topbar__user">
          <div className="wb-topbar__avatar" aria-hidden>
            {user.displayName.slice(0, 1)}
          </div>
          <div className="wb-topbar__userMeta">
            <div className="wb-topbar__userName">{user.displayName}</div>
            <div className="wb-topbar__userRole">
              {user.roles.map((r) => ROLE_LABELS[r]).join(' · ')}
            </div>
          </div>
          <button type="button" className="wb-topbar__logout" onClick={onLogout}>退出</button>
        </div>
      </div>
    </header>
  )
}
