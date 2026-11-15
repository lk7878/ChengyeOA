import { useState, type FormEvent } from 'react'
import { login } from '@/api/client'
import type { Account } from '@/types'
import './Login.css'
import { BrandMark } from '@/components/BrandMark'

export function Login({ onLoggedIn }: { onLoggedIn: (user: Account) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const r = await login(username.trim(), password)
      onLoggedIn(r.user as Account)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wb-login">
      <form className="wb-login__card" onSubmit={submit}>
        <div className="wb-login__brand">
          <div className="wb-login__logo" aria-hidden>
            <BrandMark size={32} />
          </div>
          <div>
            <h1>百佑智业</h1>
            <p>鉴定助手工作台</p>
          </div>
        </div>
        {error && <div className="wb-login__error">{error}</div>}
        <label className="wb-login__field">
          <span>用户名</span>
          <input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入用户名"
          />
        </label>
        <label className="wb-login__field">
          <span>密码</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
          />
        </label>
        <button className="wb-login__submit" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? '登录中…' : '登录'}
        </button>
        <p className="wb-login__hint">首次部署的管理员密码写在本机 data/admin-initial-password.txt，登录后请立即修改。</p>
      </form>
    </div>
  )
}
