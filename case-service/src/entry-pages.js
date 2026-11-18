// Only top-level HTML navigation receives these pages. JSON APIs and live channels
// retain their status codes and authentication/authorization enforcement.
export function isEntryNavigation(req){
 if(req.method!=='GET'||!String(req.headers.accept||'').includes('text/html'))return false
 const p=req.url.split('?')[0]
 return /^\/harness\/[a-f0-9-]{36}\/(?:index\.html)?$/.test(p)||p==='/api/auth/oa/callback'||(/^\/knowledge-native\/(?!api(?:\/|$)|assets(?:\/|$))/.test(p)&&(!p.split('/').at(-1).includes('.')||p.endsWith('/index.html')))
}
export function safeWorkbenchNext(value){
 if(typeof value!=='string'||value.length>3000||!value.startsWith('/wb/')||/[\\\r\n]/.test(value))return null
 const url=new URL(value,'http://local')
 if(url.origin!=='http://local'||url.pathname!=='/wb/'||url.hash)return null
 const allowed=new Set(['view','caseId','kb','kbFilter','kbPage','kbSearch'])
 for(const key of [...url.searchParams.keys()])if(!allowed.has(key))url.searchParams.delete(key)
 return url.pathname+url.search
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export function entryErrorPage(status,native=false){
 const back='/wb/?view='+(native?'knowledge':'cases_general')
 const [title,message]=status===401?['登录已失效','请使用 OA 账号重新进入，完成登录后再打开需要的页面。']:status===403?['暂无访问权限',native?'原生知识管理仅对具有目标库审核授权的超级管理员开放，请联系管理员核对逐库授权。':'此任务或材料的访问权限不足或已被撤销，请返回任务列表核对。']:status===409?['任务已停止或中断','请返回 AI 任务查看状态。需要继续时，由您点击“启动任务”后再打开新会话。']:status===404?['页面或任务不可用','该任务可能已删除，或不属于当前账号。请返回工作台查看您可访问的内容。']:status===400?['登录校验已过期','请从 OA 重新进入，再打开需要的页面。']:['暂时无法打开','服务连接暂时不可用，请稍后重试，或返回工作台查看状态。']
 const login=status===401||status===400
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · 承业智慧办案</title><link rel="icon" href="/wb/favicon.svg"><style>body{font:16px/1.7 system-ui,sans-serif;background:#f6f8fc;color:#182238;margin:0;padding:24px}main{max-width:620px;margin:10vh auto;padding:32px;background:white;border:1px solid #dce2ee;border-radius:16px}h1{font-size:24px}a{display:inline-block;margin:12px 16px 0 0;color:#245bea}p{color:#526078}</style></head><body><main><h1>${title}</h1><p>${message}</p>${status>=500?'<a href="">重试打开</a>':''}${login?`<a href="/api/auth/start?next=${escape(encodeURIComponent(back))}">通过 OA 重新进入</a>`:''}<a href="${back}">返回${native?'知识库':'AI 任务'}</a></main></body></html>`
}
export function registerEntryPages(app){
 app.addHook('onSend',async(req,reply,payload)=>{
  if(reply.statusCode<400||!isEntryNavigation(req))return payload
  // An upstream error stream is no longer forwarded to the browser.
  if(payload&&typeof payload.destroy==='function')payload.destroy()
  reply.removeHeader('content-length');reply.removeHeader('content-encoding')
  reply.type('text/html; charset=utf-8').header('Cache-Control','private, no-store').header('Referrer-Policy','no-referrer').header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'self'")
  return entryErrorPage(reply.statusCode,req.url.startsWith('/knowledge-native/'))
 })
}
