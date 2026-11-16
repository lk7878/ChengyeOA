import {AdminSettings} from './views/AdminSettings'
import {api} from './api/integration'
import { useEffect, useState } from 'react'
import type { Account, ViewId } from '@/types'
import { viewToKind, CASE_KIND_LABELS, CASE_KIND_HINTS, hasRole } from '@/types'
import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import { Dashboard } from '@/views/Dashboard'
import {TaskWorkbench} from '@/views/TaskWorkbench'
import { KnowledgeBase } from '@/views/KnowledgeBase'
import {
  getMe, logout,
  ApiError,
} from '@/api/client'
import './App.css'

const TITLES: Record<ViewId, { title: string; subtitle: string }> = {
  cases_general:{title:'AI助手',subtitle:'通用法律能力 · 资料整理 → 分析 → 起草 → 复核'},
  specialized:{title:'专项能力',subtitle:'伤残、伤情、医疗损害与交通事故专业流程'},
  settings:{title:'系统管理',subtitle:'统一配置模型、办案能力与角色授权'},
  dashboard: { title: '概览', subtitle: '四类鉴定分库管理，快捷进入 AI 助手与知识库' },
  cases_disability: { title: CASE_KIND_LABELS.disability, subtitle: CASE_KIND_HINTS.disability },
  cases_injury: { title: CASE_KIND_LABELS.injury, subtitle: CASE_KIND_HINTS.injury },
  cases_malpractice: { title: CASE_KIND_LABELS.malpractice, subtitle: CASE_KIND_HINTS.malpractice },
  cases_traffic: { title: CASE_KIND_LABELS.traffic, subtitle: CASE_KIND_HINTS.traffic },
  knowledge: { title: '知识库', subtitle: '查看已接入的知识库与标准，并可导入材料' },
  accounts: { title: '账号管理', subtitle: '维护人员账号、角色与最小授权' },
  sharing: { title: '数据共享', subtitle: '配置鉴定人员之间的案件数据共享组' },
}


export default function App() {
  const openExternal=(id:'ai_assistant'|'knowledge_base')=>setView(id==='ai_assistant'?'cases_general':'knowledge')
  const [view, setView] = useState<ViewId>(new URLSearchParams(window.location.search).has('caseId')?'cases_general':'dashboard')
  const [user, setUser] = useState<Account | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [capabilities,setCapabilities]=useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    getMe()
      .then(async (r) => {
        if (cancelled) return
        setUser(r.user as Account)
        setAccounts([r.user as Account]);const allowed=await api<{items:{id:string}[]}>('/api/capabilities');setCapabilities(allowed.items.map(c=>c.id))
      })
      .catch((e) => {
        if (cancelled) return
        if (!(e instanceof ApiError) || e.status !== 401) console.warn(e)
        setUser(null)
      })
      .finally(() => { if (!cancelled) setAuthReady(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (user && view === 'accounts' && !hasRole(user, 'platform_admin')) {
      setView('dashboard')
    }
    if (user && view === 'sharing' && !hasRole(user, 'platform_admin')) {
      setView('dashboard')
    }
  }, [user, view])

  const handleLogout = async () => {
    try { await logout() } catch { /* ignore */ }
    setUser(null)
    setAccounts([])
    setView('dashboard')
  }

  if (!authReady) {
    return <div className="wb-boot">加载中…</div>
  }
  if (!user) {
    return (
      <div className="wb-login"><section className="oa-panel"><h1>承业智慧办案</h1><p>使用 OA 账号进入，无需另设密码。</p><a className="oa-primary" href="/api/auth/start">通过 OA 登录</a></section></div>
    )
  }

  const canManageAccounts = false
  const canWriteKb = hasRole(user, 'platform_admin', 'public_admin')
  const canSeeBalance = false

  return (
    <div className="wb-app">
      <Sidebar
        current={view}
        onNavigate={setView}
        onOpenExternal={openExternal}
        showSettings={user.isSystemSuperAdmin===true}
        showAccounts={canManageAccounts}
        showSharing={canManageAccounts}
      />
      <div className="wb-app__main">
        <TopBar
          title={TITLES[view].title}
          subtitle={TITLES[view].subtitle}
          onOpenExternal={openExternal}
          onNavigate={setView}
          llm={null}
          user={user}
          onLogout={handleLogout}
          showBalance={canSeeBalance}
        />
        <main className="wb-app__content">
          {view === 'dashboard' && (
            <Dashboard
              capabilities={capabilities}
              accounts={canManageAccounts ? accounts : []}
              onNavigate={setView}
              onOpenExternal={openExternal}
              showAccounts={canManageAccounts}
              currentUser={user}
            />
          )}
          {viewToKind(view) && (
            <TaskWorkbench key={viewToKind(view)!} kind={viewToKind(view)!}/>
          )}
          {view === 'knowledge' && (
            <KnowledgeBase canWrite={canWriteKb} canOpenConsole={false} />
          )}
          {view==='specialized'&&<div className="oa-workspace"><div className="oa-specialties">{(['disability','injury','malpractice','traffic'] as const).filter(k=>capabilities.includes(k)).map(k=><button className="oa-panel" key={k} onClick={()=>setView(`cases_${k}`)}><h2>{CASE_KIND_LABELS[k]}</h2><p>{CASE_KIND_HINTS[k]}</p></button>)}</div></div>}
          {view==='settings'&&user.isSystemSuperAdmin&&<AdminSettings/>}

        </main>
      </div>
    </div>
  )
}
