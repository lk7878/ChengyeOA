import {BillingAdmin} from './views/Billing'
import {useNavigation,updateLocation} from './navigation'
import {clearAccountDrafts} from './views/task-draft'
import {AiCapabilities} from './views/AiCapabilities'
import {BusinessPresets} from './views/BusinessPresets'
import {api} from '@/api/integration'
import {KnowledgeAccess} from './views/KnowledgeAccess'
import { useCallback, useEffect, useState } from 'react'
import type { Account, ViewId, CaseKind } from '@/types'
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
  settings:{title:'AI 与授权管理',subtitle:'身份与组织由 OA 统一管理'},
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
  const [choices,setChoices]=useState<{defaultKind:CaseKind|null;items:{id:CaseKind;name:string;hint:string;version:number;error?:string}[]}>()
  const [choicesError,setChoicesError]=useState(''),[retryChoices,setRetryChoices]=useState(0)
  const go=(v:ViewId)=>setView(v==='cases_general'&&choices?.defaultKind?`cases_${choices.defaultKind}`:v)
  const openExternal=(id:'ai_assistant'|'knowledge_base')=>go(id==='ai_assistant'?'cases_general':'knowledge')
  const {view,setView}=useNavigation()
  const [user, setUser] = useState<Account | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError,setAuthError]=useState('')
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const llm = useLlmStatus(!!user)

  useEffect(()=>{
    let active=true
    if(user)void api<NonNullable<typeof choices>>('/api/my-presets').then(v=>{if(active){setChoices(v);setChoicesError('')}}).catch(e=>{if(active){setChoices(undefined);setChoicesError(e.message)}})
    return ()=>{active=false}
  },[user,view,retryChoices])
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
  useEffect(() => {
    const closeSession = (message: string) => { setAuthError(message); setUser(null); setAccounts([]) }
    const expired = () => closeSession('登录已失效，请通过 OA 重新进入。')
    const revoked = () => closeSession('智慧办案使用资格已撤销，请联系管理员。')
    window.addEventListener('wb:session-expired', expired)
    window.addEventListener('wb:access-revoked', revoked)
    return () => {
      window.removeEventListener('wb:session-expired', expired)
      window.removeEventListener('wb:access-revoked', revoked)
    }
  }, [])

  useEffect(()=>{
    if(view==='cases_general'&&choices?.defaultKind&&choices.defaultKind!=='general'&&new URLSearchParams(location.search).get('preset')!=='general'){
      updateLocation({view:`cases_${choices.defaultKind}`},true)
    }
  },[view,choices])
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
        onNavigate={go}
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
          onNavigate={go}
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
              onNavigate={go}
              onOpenExternal={openExternal}
              showAccounts={canManageAccounts}
              currentUser={user} allowedKinds={choices?.items.map(p=>p.id)||[]}
            />
          )}
          {viewToKind(view) && (
            <div className="oa-workspace"><section className="oa-panel"><label>办案类型 <select value={viewToKind(view)!} onChange={e=>updateLocation({view:`cases_${e.target.value as CaseKind}`,preset:e.target.value})}>
             {!choices?.items.some(p=>p.id===viewToKind(view))&&<option value={viewToKind(view)!}>请选择已获配预设</option>}
             {choices?.items.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
             <p aria-live="polite">{choicesError||(!choices?'正在读取办案授权…':choices.items.find(p=>p.id===viewToKind(view))?.hint||'当前类型未获配，请选择已授权预设或联系管理员。')}</p>{choicesError&&<button onClick={()=>setRetryChoices(n=>n+1)}>重新校验草稿</button>}</section>
            {choices?.items.some(p=>p.id===viewToKind(view))&&<TaskWorkbench key={user.id+viewToKind(view)!} accountId={user.id} kind={viewToKind(view)!} currentVersion={choices.items.find(p=>p.id===viewToKind(view))!.version}/>}</div>
          )}
          {view === 'knowledge' && (
            <KnowledgeBase key={user.id} canWrite={canWriteKb} canOpenConsole={canWriteKb} />
          )}
          {view==='settings'&&user.isSystemSuperAdmin&&(
            <div className="oa-workspace">
              <BusinessPresets/>
              <KnowledgeAccess/>
              <AiCapabilities/>
              <BillingAdmin/>
              <section className="oa-panel"><h2>开源组件</h2><p>DeepSeek Harness（MIT）、WeKnora 及法律 Skills 的原许可证与来源声明保留在部署包中。</p></section>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}
