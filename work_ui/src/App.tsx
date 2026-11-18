import {useNavigation,updateLocation} from './navigation'
import {clearAccountDrafts} from './views/task-draft'
import {AiCapabilities} from './views/AiCapabilities'
import {KnowledgeAccess} from './views/KnowledgeAccess'
import { useCallback, useEffect, useState } from 'react'
import type { Account, ViewId } from '@/types'
import { viewToKind, CASE_KIND_LABELS, CASE_KIND_HINTS, hasRole } from '@/types'
import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import { Dashboard } from '@/views/Dashboard'
import {TaskWorkbench} from '@/views/TaskWorkbench'
import { KnowledgeBase } from '@/views/KnowledgeBase'
import {
  getLlmStatus, getMe, logout, listDirectoryUsers, listAccounts,
  type LlmStatus, ApiError,
} from '@/api/client'
import './App.css'

const TITLES: Record<ViewId, { title: string; subtitle: string }> = {
  cases_general:{title:'AI助手',subtitle:'通用法律能力 · 资料整理 → 分析 → 起草 → 复核'},
  specialized:{title:'专项能力',subtitle:'伤残、伤情、医疗损害与交通事故专业流程'},
  settings:{title:'知识库管理',subtitle:'身份与组织由 OA 统一管理'},
  dashboard: { title: '概览', subtitle: '四类鉴定分库管理，快捷进入 AI 助手与知识库' },
  cases_disability: { title: CASE_KIND_LABELS.disability, subtitle: CASE_KIND_HINTS.disability },
  cases_injury: { title: CASE_KIND_LABELS.injury, subtitle: CASE_KIND_HINTS.injury },
  cases_malpractice: { title: CASE_KIND_LABELS.malpractice, subtitle: CASE_KIND_HINTS.malpractice },
  cases_traffic: { title: CASE_KIND_LABELS.traffic, subtitle: CASE_KIND_HINTS.traffic },
  knowledge: { title: '知识库', subtitle: '浏览与检索已授权、已发布的专业知识' },
  accounts: { title: '账号管理', subtitle: '维护人员账号、角色与最小授权' },
  sharing: { title: '数据共享', subtitle: '配置鉴定人员之间的案件数据共享组' },
}


function useLlmStatus(enabled: boolean) {
  const [status, setStatus] = useState<LlmStatus | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () => {
      getLlmStatus()
        .then((s) => { if (!cancelled) setStatus(s) })
        .catch(() => { if (!cancelled) setStatus(null) })
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled])
  return status
}

export default function App() {
  const openExternal=(id:'ai_assistant'|'knowledge_base')=>setView(id==='ai_assistant'?'cases_general':'knowledge')
  const {view,setView}=useNavigation()
  const [user, setUser] = useState<Account | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError,setAuthError]=useState('')
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const llm = useLlmStatus(!!user)

  const refreshAccounts = useCallback(async (me: Account) => {
    try {
      if (hasRole(me, 'platform_admin')) {
        const r = await listAccounts()
        setAccounts(r.accounts ?? [])
      } else {
        const r = await listDirectoryUsers()
        setAccounts((r.users ?? []) as Account[])
      }
    } catch {
      setAccounts([me])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getMe()
      .then(async (r) => {
        if (cancelled) return
        setUser(r.user as Account)
        await refreshAccounts(r.user as Account)
      })
      .catch((e) => {
        if (cancelled) return
        if (!(e instanceof ApiError) || e.status !== 401) console.warn(e)
        setAuthError(e instanceof ApiError&&e.status===403?'暂无智慧办案使用权限，请联系管理员核对授权。':e instanceof ApiError&&e.status===401?'登录已失效，请通过 OA 重新进入。':'登录状态暂时无法确认，请稍后重试。')
        setUser(null)
      })
      .finally(() => { if (!cancelled) setAuthReady(true) })
    return () => { cancelled = true }
  }, [refreshAccounts])

  useEffect(()=>{if(user&&view==='settings'&&!user.isSystemSuperAdmin)updateLocation({view:'dashboard'},true)},[user,view])
  useEffect(()=>{const expired=()=>{setAuthError('登录已失效，请通过 OA 重新进入。');setUser(null);setAccounts([])};window.addEventListener('wb:session-expired',expired);return()=>window.removeEventListener('wb:session-expired',expired)},[])

  const handleLogout = async () => {
    if(loggingOut)return
    setLoggingOut(true);setLogoutError('')
    try {
      await logout()
      if(user)clearAccountDrafts(user.id)
      setUser(null);setAccounts([]);setAuthError('');updateLocation({view:'dashboard',caseId:null,kb:null,kbFilter:null,kbSearch:null,kbPage:null},true)
    } catch {
      setLogoutError('退出未完成，请重试。登录状态尚未清除。')
    } finally {setLoggingOut(false)}
  }

  if (!authReady) {
    return <div className="wb-boot">加载中…</div>
  }
  if (!user) {
    return (
      <div className="wb-login"><section className="oa-panel"><h1>承业智慧办案</h1><p>{authError||'使用 OA 账号进入，无需另设密码。'}</p><a className="oa-primary" href={'/api/auth/start?next='+encodeURIComponent(window.location.pathname+window.location.search)}>通过 OA 登录</a></section></div>
    )
  }

  const canManageAccounts = hasRole(user, 'platform_admin')
  const canWriteKb = user.isSystemSuperAdmin === true
  const canSeeBalance = hasRole(user, 'platform_admin')

  return (
    <div className="wb-app">
      <Sidebar
        current={view}
        onNavigate={setView}
        onOpenExternal={openExternal}
        showAccounts={canManageAccounts}
        showSharing={canManageAccounts}
        showSettings={!!user.isSystemSuperAdmin}
      />
      <div className="wb-app__main">
        <TopBar
          title={TITLES[view].title}
          subtitle={TITLES[view].subtitle}
          onOpenExternal={openExternal}
          onNavigate={setView}
          llm={canSeeBalance ? llm : null}
          user={user}
          onLogout={handleLogout}
          loggingOut={loggingOut}
          showBalance={canSeeBalance}
        />
        <main className="wb-app__content">
          {logoutError&&<p className="oa-error" role="alert">{logoutError}</p>}
          {view === 'dashboard' && (
            <Dashboard
              accounts={canManageAccounts ? accounts : []}
              onNavigate={setView}
              onOpenExternal={openExternal}
              showAccounts={canManageAccounts}
              currentUser={user}
            />
          )}
          {viewToKind(view) && (
            <TaskWorkbench key={user.id+viewToKind(view)!} accountId={user.id} kind={viewToKind(view)!}/>
          )}
          {view === 'knowledge' && (
            <KnowledgeBase key={user.id} canWrite={canWriteKb} canOpenConsole={canWriteKb} />
          )}
          {view==='specialized'&&<div className="oa-workspace"><div className="oa-specialties">{(['disability','injury','malpractice','traffic'] as const).map(k=><button className="oa-panel" key={k} onClick={()=>setView(`cases_${k}`)}><h2>{CASE_KIND_LABELS[k]}</h2><p>{CASE_KIND_HINTS[k]}</p></button>)}</div></div>}
          {view==='settings'&&user.isSystemSuperAdmin&&<div className="oa-workspace"><section className="oa-panel"><h2>账号与权限</h2><p>账号创建、停用、组织和业务权限由 OA 管理。知识审核仅对明确授权的目标库生效。</p><h2>模型与运行</h2><p>新任务的模型与工具组合在下方统一配置；OCR 和知识索引保留部署配置。任务材料和会话独立隔离。</p>{(user as Account&{isSystemSuperAdmin?:boolean}).isSystemSuperAdmin&&<><KnowledgeAccess/><AiCapabilities/></>}<h2>开源组件</h2><p>DeepSeek Harness（MIT）、WeKnora 及法律 Skills 的原许可证与来源声明保留在部署包中。</p></section></div>}

        </main>
      </div>
    </div>
  )
}
