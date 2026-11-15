import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Account, SharingGroup } from '@/types'
import { Button } from '@/components/Button'
import { Tag } from '@/components/Tag'
import { Modal, ModalActions } from '@/components/Modal'
import { IconPlus, IconEdit } from '@/components/icons'
import {
  listSharingGroups,
  createSharingGroup,
  updateSharingGroup,
  deleteSharingGroup,
} from '@/api/client'
import './AccountManagement.css'

export interface SharingManagementProps {
  accounts: Account[]
}

function accountLabel(accounts: Account[], id: string) {
  const a = accounts.find((x) => x.id === id)
  return a ? `${a.displayName}（${a.username}）` : id
}

export function SharingManagement({ accounts }: SharingManagementProps) {
  const [groups, setGroups] = useState<SharingGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SharingGroup | null>(null)
  const [creating, setCreating] = useState(false)

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.status === 'active' && !a.roles.includes('platform_admin')),
    [accounts],
  )

  const assignedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of groups) {
      for (const id of g.memberIds) ids.add(id)
    }
    return ids
  }, [groups])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await listSharingGroups()
      setGroups(r.groups ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const removeGroup = async (g: SharingGroup) => {
    if (!window.confirm(`确定删除共享组「${g.name}」？成员将不再互见案件。`)) return
    try {
      await deleteSharingGroup(g.id)
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="wb-accounts">
      <div className="wb-accounts__toolbar">
        <p className="wb-sharing__intro">
          同一共享组内的鉴定人员可<strong>互见彼此负责的案件</strong>（可查看材料、使用 AI 助手），
          但不能删除案件或指派成员。每人只能加入一个共享组。
        </p>
        <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>
          新建共享组
        </Button>
      </div>

      {error && <div className="wb-accounts__banner">{error}</div>}

      <div className="wb-accounts__table">
        <table>
          <thead>
            <tr>
              <th>共享组</th>
              <th>成员</th>
              <th>更新时间</th>
              <th className="wb-accounts__colAction">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="wb-accounts__emptyRow">加载中…</td>
              </tr>
            )}
            {!loading && groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <div className="wb-accounts__name">{g.name}</div>
                  <div className="wb-accounts__email wb-accounts__mono">{g.id}</div>
                </td>
                <td>
                  <div className="wb-accounts__roles">
                    {g.memberIds.map((id) => (
                      <Tag key={id} tone="business">
                        {accountLabel(accounts, id)}
                      </Tag>
                    ))}
                  </div>
                </td>
                <td>{g.updatedAt.slice(0, 19).replace('T', ' ')}</td>
                <td className="wb-accounts__colAction">
                  <div className="wb-sharing__actions">
                    <Button size="sm" variant="outline" icon={<IconEdit size={14} />} onClick={() => setEditing(g)}>
                      编辑
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void removeGroup(g)}>
                      删除
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && groups.length === 0 && (
              <tr>
                <td colSpan={4} className="wb-accounts__emptyRow">
                  尚未配置共享组。例如：创建「鉴定一组」，加入刘律师与陈红利，两人即可互见案件。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <SharingGroupModal
        key={editing?.id ?? 'edit'}
        open={editing !== null}
        group={editing}
        accounts={activeAccounts}
        assignedIds={assignedIds}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void refresh() }}
      />
      <SharingGroupModal
        key="create"
        open={creating}
        group={null}
        accounts={activeAccounts}
        assignedIds={assignedIds}
        onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); void refresh() }}
      />
    </div>
  )
}

function SharingGroupModal({
  open,
  group,
  accounts,
  assignedIds,
  onClose,
  onSaved,
}: {
  open: boolean
  group: SharingGroup | null
  accounts: Account[]
  assignedIds: Set<string>
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(group?.memberIds ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(group?.name ?? '')
    setMemberIds(group?.memberIds ?? [])
    setError(null)
    setBusy(false)
  }, [group, open])

  const toggleMember = (id: string) => {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const save = async () => {
    if (!name.trim()) { setError('请填写共享组名称'); return }
    if (memberIds.length < 2) { setError('至少选择 2 名成员'); return }
    setBusy(true)
    setError(null)
    try {
      if (group) {
        await updateSharingGroup(group.id, { name: name.trim(), memberIds })
      } else {
        await createSharingGroup({ name: name.trim(), memberIds })
      }
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
      title={group ? '编辑共享组' : '新建共享组'}
      description="选择需要互见案件数据的鉴定人员"
      width={560}
      footer={
        <ModalActions
          onCancel={onClose}
          onConfirm={save}
          confirmText={busy ? '保存中…' : '保存'}
        />
      }
    >
      <div className="wb-form">
        {error && <div className="wb-accounts__banner">{error}</div>}
        <div className="wb-form__row">
          <label className="wb-form__label">组名称</label>
          <input
            className="wb-form__input"
            placeholder="例如：鉴定一组"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="wb-form__row">
          <label className="wb-form__label">成员（至少 2 人）</label>
          <div className="wb-accounts__roleGrid">
            {accounts.map((a) => {
              const inOtherGroup = assignedIds.has(a.id) && !(group?.memberIds.includes(a.id))
              const checked = memberIds.includes(a.id)
              return (
                <label
                  key={a.id}
                  className={checked ? 'wb-accounts__role is-on' : 'wb-accounts__role'}
                  title={inOtherGroup ? '该用户已在其他共享组' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={inOtherGroup}
                    onChange={() => toggleMember(a.id)}
                  />
                  <span>{a.displayName}</span>
                  <span className="wb-sharing__username">{a.username}</span>
                </label>
              )
            })}
          </div>
          {accounts.length === 0 && (
            <p className="wb-sharing__hint">暂无可用账号，请先在「账号管理」创建鉴定人员。</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
