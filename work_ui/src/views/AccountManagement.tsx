import { useEffect, useMemo, useState } from 'react'
import type { Account, Role, AccountStatus } from '@/types'
import { ROLE_LABELS, ACCOUNT_STATUS_LABELS } from '@/types'
import { Button } from '@/components/Button'
import { Tag } from '@/components/Tag'
import { Modal, ModalActions } from '@/components/Modal'
import { AccountStatusTag } from '@/components/StatusTags'
import { IconPlus, IconSearch, IconEdit, IconClose } from '@/components/icons'
import { createAccount, updateAccount } from '@/api/client'
import './AccountManagement.css'

export interface AccountManagementProps {
  accounts: Account[]
  onChanged?: () => void
}

const ROLE_OPTIONS: Role[] = [
  'platform_admin',
  'public_admin',
  'case_owner',
  'appraiser',
  'reviewer',
]

const STATUS_FILTERS: { id: AccountStatus | 'all'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '正常' },
  { id: 'pending', label: '待激活' },
  { id: 'disabled', label: '已停用' },
]

export function AccountManagement({ accounts, onChanged }: AccountManagementProps) {
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<AccountStatus | 'all'>('all')
  const [editing, setEditing] = useState<Account | null>(null)
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return accounts.filter((a) => {
      if (status !== 'all' && a.status !== status) return false
      if (!kw) return true
      return (
        a.username.toLowerCase().includes(kw) ||
        a.displayName.toLowerCase().includes(kw) ||
        (a.email || '').toLowerCase().includes(kw)
      )
    })
  }, [accounts, keyword, status])

  return (
    <div className="wb-accounts">
      <div className="wb-accounts__toolbar">
        <div className="wb-accounts__search">
          <IconSearch size={16} />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="按姓名、用户名、邮箱搜索"
          />
          {keyword && (
            <button className="wb-accounts__clear" onClick={() => setKeyword('')} aria-label="清除">
              <IconClose size={14} />
            </button>
          )}
        </div>

        <div className="wb-accounts__filters">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              className={status === f.id ? 'wb-accounts__filter is-active' : 'wb-accounts__filter'}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>
          新建账号
        </Button>
      </div>

      <div className="wb-accounts__table">
        <table>
          <thead>
            <tr>
              <th>用户</th>
              <th>用户名</th>
              <th>角色</th>
              <th>状态</th>
              <th>最近活跃</th>
              <th>创建时间</th>
              <th className="wb-accounts__colAction">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="wb-accounts__user">
                    <div className="wb-accounts__avatar">{a.displayName.slice(0, 1)}</div>
                    <div>
                      <div className="wb-accounts__name">{a.displayName}</div>
                      <div className="wb-accounts__email">{a.email}</div>
                    </div>
                  </div>
                </td>
                <td className="wb-accounts__mono">{a.username}</td>
                <td>
                  <div className="wb-accounts__roles">
                    {a.roles.map((r) => (
                      <Tag key={r} tone="business">
                        {ROLE_LABELS[r]}
                      </Tag>
                    ))}
                  </div>
                </td>
                <td>
                  <AccountStatusTag status={a.status} />
                </td>
                <td>{a.lastActiveAt ?? '—'}</td>
                <td>{a.createdAt}</td>
                <td className="wb-accounts__colAction">
                  <Button size="sm" variant="outline" icon={<IconEdit size={14} />} onClick={() => setEditing(a)}>
                    编辑
                  </Button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="wb-accounts__emptyRow">没有匹配的账号</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AccountEditModal
        key={editing?.id ?? 'edit'}
        open={editing !== null}
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); onChanged?.() }}
      />
      <AccountCreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); onChanged?.() }}
      />
    </div>
  )
}

function AccountEditModal({
  open,
  account,
  onClose,
  onSaved,
}: {
  open: boolean
  account: Account | null
  onClose: () => void
  onSaved: () => void
}) {
  const [roles, setRoles] = useState<Role[]>(account?.roles ?? [])
  const [accStatus, setAccStatus] = useState<AccountStatus>(account?.status ?? 'active')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setRoles(account?.roles ?? [])
    setAccStatus(account?.status ?? 'active')
    setPassword('')
    setError(null)
  }, [account])

  const save = async () => {
    if (!account) return
    if (!roles.length) { setError('至少选择一个角色'); return }
    setBusy(true)
    setError(null)
    try {
      await updateAccount(account.id, {
        roles,
        status: accStatus,
        ...(password ? { password } : {}),
      })
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="编辑账号"
      description={account ? `${account.displayName}（${account.username}）` : ''}
      width={560}
      footer={
        <ModalActions
          onCancel={onClose}
          onConfirm={save}
          confirmText={busy ? '保存中…' : '保存'}
        />
      }
    >
      {account && (
        <div className="wb-form">
          {error && <div className="wb-accounts__banner">{error}</div>}
          <div className="wb-form__row">
            <label className="wb-form__label">角色（可多选，最小授权）</label>
            <div className="wb-accounts__roleGrid">
              {ROLE_OPTIONS.map((r) => {
                const checked = roles.includes(r)
                return (
                  <label key={r} className={checked ? 'wb-accounts__role is-on' : 'wb-accounts__role'}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setRoles((prev) =>
                          prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
                        )
                      }
                    />
                    <span>{ROLE_LABELS[r]}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <div className="wb-form__row">
            <label className="wb-form__label">账号状态</label>
            <select
              className="wb-form__input"
              value={accStatus}
              onChange={(e) => setAccStatus(e.target.value as AccountStatus)}
            >
              {Object.entries(ACCOUNT_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="wb-form__row">
            <label className="wb-form__label">重置密码（留空则不改）</label>
            <input
              className="wb-form__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="新密码"
            />
          </div>
        </div>
      )}
    </Modal>
  )
}

function AccountCreateModal({
  open, onClose, onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<Role[]>(['appraiser'])
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [initialPassword, setInitialPassword] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDisplayName('')
    setUsername('')
    setEmail('')
    setRoles(['appraiser'])
    setPassword('')
    setError(null)
    setInitialPassword(null)
    setBusy(false)
  }, [open])

  const save = async () => {
    setError(null)
    setBusy(true)
    try {
      const r = await createAccount({
        displayName: displayName.trim(),
        username: username.trim(),
        email: email.trim(),
        roles,
        status: 'active',
        password: password.trim() || undefined,
      })
      if (r.initialPassword) setInitialPassword(r.initialPassword)
      else onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建账号"
      description="创建后即可登录。未填密码时系统会生成初始密码。"
      width={560}
      footer={
        initialPassword
          ? <ModalActions onCancel={onSaved} onConfirm={onSaved} confirmText="我已记下密码" />
          : <ModalActions onCancel={onClose} onConfirm={save} confirmText={busy ? '创建中…' : '创建'} />
      }
    >
      {initialPassword ? (
        <div className="wb-form">
          <p>账号已创建。请把初始密码交给本人，并提醒首次登录后修改。</p>
          <code className="wb-accounts__mono">{initialPassword}</code>
        </div>
      ) : (
        <div className="wb-form">
          {error && <div className="wb-accounts__banner">{error}</div>}
          <div className="wb-form__row wb-form__row--2">
            <div>
              <label className="wb-form__label">姓名</label>
              <input className="wb-form__input" placeholder="显示名称" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label className="wb-form__label">用户名</label>
              <input className="wb-form__input" placeholder="登录用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
          </div>
          <div className="wb-form__row">
            <label className="wb-form__label">邮箱</label>
            <input className="wb-form__input" placeholder="name@org.local" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="wb-form__row">
            <label className="wb-form__label">初始密码（可空）</label>
            <input className="wb-form__input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="留空则自动生成" />
          </div>
          <div className="wb-form__row">
            <label className="wb-form__label">初始角色</label>
            <div className="wb-accounts__roleGrid">
              {ROLE_OPTIONS.map((r) => {
                const checked = roles.includes(r)
                return (
                  <label key={r} className={checked ? 'wb-accounts__role is-on' : 'wb-accounts__role'}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setRoles((prev) =>
                          prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
                        )
                      }
                    />
                    <span>{ROLE_LABELS[r]}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
