window.__ModuleLoader__.load({ id: "dsh-baiyou-brand", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var { useEffect, useRef } = require("react");
var { jsx, jsxs } = require("react/jsx-runtime");
// Native file menus use workspace paths; the OA broker accepts reviewed snapshot keys.
// Never turn a displayed file path directly into an upload request.
function outputPath(path) {
  if (typeof path !== 'string' || /[\\\0]/.test(path)) return null
  const relative = path.startsWith('/workspace/') ? path.slice(11) : path
  const parts = relative.split('/')
  if (!['reports', 'drafts'].includes(parts[0]) || parts.length < 2 ||
      parts.some(part => !part || part === '.' || part === '..')) return null
  return relative
}

function registerOaFileSync(ctx, browser = window) {
  const taskId = /^\/harness\/([a-f0-9-]{36})(?:\/|$)/i.exec(browser.location.pathname)?.[1]
  if (!taskId) return
  const pending = new Set()
  const viewSavedFile = {
    label: '查看文件',
    run: () => { browser.open('/workspaces?workspace=__all__&scope=mine', '_blank', 'noopener,noreferrer') },
    failureLabel: '无法打开文件列表，请进入承业空间 → 我的资源查看。',
  }
  const api = async (suffix, body) => {
    const response = await browser.fetch(`/api/tasks/${taskId}/${suffix}`, {
      credentials: 'include',
      ...(body === undefined ? {} : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw Error(data.message || data.error ||
      (response.status === 401 ? '登录已失效，请重新登录 OA 后再同步。' : '同步服务暂不可用，请稍后重试。'))
    return data
  }
  ctx.effect(() => ctx.contextMenus.register({
    id: 'oa.sync-file', target: 'file', order: 300,
    resolve: ({ path }) => {
      const relative = outputPath(path)
      if (!relative) return []
      return [{
        id: 'sync', label: '同步OA工作空间', disabled: pending.has(relative),
        run: async () => {
          if (pending.has(relative)) return
          pending.add(relative)
          try {
            ctx.contextMenus.notify('正在检查文件版本…', true)
            const { items } = await api('outputs')
            const file = items?.find(item => item.path === relative)
            if (!file) throw Error('文件不存在或仍在生成中，请等待生成完成后重试。仅支持同步 reports、drafts 中的成果文件。')
            if (file.saved) {
              ctx.contextMenus.notify('此版本已保存到承业空间 → 我的资源。', true, viewSavedFile)
              return
            }
            if (!browser.confirm(`同步OA工作空间\n\n文件：${file.path}\n大小：${Math.ceil(file.size / 1024)} KB\n当前版本：${file.sha256.slice(0, 10)}\n\n保存到：承业空间 → 我的资源 → 我的文件\n只同步这份文件的当前版本；后续修改不会自动同步。此操作不等同于正式归档。\n\n确认同步？`)) return
            ctx.contextMenus.notify('正在同步到 OA，请稍候…', true)
            const task = await api('save', { selection: [file.key] })
            if (task.outputs?.[file.key]?.status !== 'SAVED') throw Error('尚未确认保存成功，请刷新成果列表后重试。')
            ctx.contextMenus.notify(`“${file.name}”已保存到承业空间 → 我的资源。`, true, viewSavedFile)
          } catch (error) {
            ctx.contextMenus.notify(`同步失败：${error.message || '请稍后重试'}`, false)
          } finally {
            pending.delete(relative)
          }
        },
      }]
    },
  }), 'oa: explicit single file synchronization')
}

// Upload originals to the authenticated owner's OA files, then attach the saved
// version to this task. Generated outputs still require explicit confirmation.
async function uploadTaskFile(taskId, file, state, progress, browser=window) {
 const base=`/api/tasks/${taskId}/material-uploads`
 const call=async(url,options={})=>{
  const r=await browser.fetch(url,{credentials:'include',signal:state.controller?.signal,...options}),data=await r.json().catch(()=>({}))
  if(!r.ok)throw Error(data.message||data.error||'上传失败，请重试')
  return data
 }
 const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 if(!state.id)state.id=(await call(base,post({name:file.name,size:file.size}))).id
 const url=base+'/'+state.id,status=await call(url)
 if(!Number.isSafeInteger(status.chunkSize)||status.chunkSize<1||status.chunkSize>4*1024*1024||!Number.isSafeInteger(status.offset)||status.offset<0||status.offset>file.size)throw Error('上传状态无效，请重新打开上传窗口')
 for(let offset=status.offset;offset<file.size;){
  const bytes=file.slice(offset,offset+status.chunkSize)
  const next=await call(url+'/chunk?offset='+offset,{method:'PUT',headers:{'content-type':'application/octet-stream'},body:bytes})
  if(!Number.isSafeInteger(next.offset)||next.offset<=offset||next.offset>file.size)throw Error('上传进度异常，请重试')
  offset=next.offset;progress(Math.round(offset/file.size*100))
 }
 progress(100);state.finalizing=true;progress(100)
 return call(url+'/complete',post({}))
}

function bindOaUpload(ctx,inputActions,browser=window,anchor) {
 const taskId=/^\/harness\/([a-f0-9-]{36})(?:\/|$)/i.exec(browser.location.pathname)?.[1]
 if(!taskId||!inputActions)return()=>{}
 const doc=browser.document;let dialog=null,busy=0,disposed=false,timer=null,badgeTimer=null
 const badge=doc.createElement('button');badge.className='oa-material-badge';badge.type='button';badge.hidden=true;badge.onclick=()=>anchor?.click();anchor?.after(badge)
 const updateBadge=data=>{const rows=data.items||[],pending=rows.filter(r=>['QUEUED','PARSING','SAVED'].includes(r.status)),failed=rows.filter(r=>['FAILED','INTERRUPTED'].includes(r.status));badge.hidden=!rows.length;badge.textContent=pending.length?`材料解析中 ${pending.length} 份`:failed.length?`材料需处理 ${failed.length} 份`:`材料 ${rows.length} 份 · 可读取`;return pending.length>0}
 const poll=async()=>{let active=false;try{if(!dialog&&!doc.hidden){const r=await browser.fetch(`/api/tasks/${taskId}/materials`,{credentials:'include'});if(r.ok)active=updateBadge(await r.json());else if([401,403,404].includes(r.status)){badge.textContent='材料访问已失效';badge.hidden=false;return}}}catch{}finally{if(!disposed)badgeTimer=browser.setTimeout(poll,active?5000:15000)}}
 void poll()
 const click=event=>{
  const button=event.target.closest?.('.oa-upload-trigger')
  if(!button||button!==anchor||button.disabled)return
  event.preventDefault();event.stopImmediatePropagation()
  if(dialog){dialog.focus();return}
  const insertion=inputActions.captureInsertion()
  dialog=doc.createElement('dialog');dialog.className='oa-upload-dialog';dialog.dataset.oaUpload='';dialog.setAttribute('aria-label','上传文件到 OA 和当前任务')
  const title=doc.createElement('h2');title.textContent='上传任务材料'
  const hint=doc.createElement('p');hint.textContent='选择的文件将保存到承业空间 → 我的资源，并加入当前任务。解析进度会在下方显示；只有标记可读取的内容才可作为引用。'
  const picker=doc.createElement('input');picker.type='file';picker.multiple=true;picker.setAttribute('aria-label','选择上传文件')
  const list=doc.createElement('div');list.className='oa-upload-list';list.setAttribute('aria-live','polite')
  const status=doc.createElement('p');status.setAttribute('role','status')
  const insert=doc.createElement('button');insert.textContent='将已上传文件加入输入框';insert.disabled=true
  const close=doc.createElement('button');close.textContent='关闭'
  const saved=[];let queue=Promise.resolve()
  const materials=doc.createElement('div');materials.className='oa-material-status';materials.setAttribute('aria-live','polite')
  const request=async(url,body)=>{const r=await browser.fetch(url,{credentials:'include',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message||data.error||'材料操作失败');return data}
  const refresh=async()=>{
   try{const data=await request(`/api/tasks/${taskId}/materials`);if(!dialog)return;updateBadge(data);materials.replaceChildren();
    for(const item of data.items||[]){
     const row=doc.createElement('div'),name=doc.createElement('strong'),info=doc.createElement('span'),retry=doc.createElement('button'),remove=doc.createElement('button')
     name.textContent=item.name+' · v'+item.version;const labels={SAVED:'已保存',QUEUED:'等待解析',PARSING:'正在解析',READY:'可读取',FAILED:'解析失败',INTERRUPTED:'解析中断'}
     info.textContent=(labels[item.status]||item.status)+` · ${item.done||0}/${item.total||0} 页`+(item.startedAt?' · 已用 '+Math.max(0,Math.round((Date.parse(item.completedAt||new Date().toISOString())-Date.parse(item.startedAt))/1000))+' 秒':'')+(item.error?' · '+item.error:'')
     retry.textContent='重试失败页';retry.hidden=!['FAILED','INTERRUPTED'].includes(item.status);retry.onclick=async()=>{retry.disabled=true;try{await request(`/api/tasks/${taskId}/materials/retry`,{fileId:item.fileId,version:item.version});await refresh()}catch(e){status.textContent=e.message}finally{retry.disabled=false}}
     remove.textContent='从任务移除';remove.onclick=async()=>{if(!browser.confirm('仅从当前任务移除，OA 原文件保留。正在运行的会话将结束，需重新打开；历史回答不变。继续？'))return;remove.disabled=true;try{const result=await request(`/api/tasks/${taskId}/materials/remove`,{fileId:item.fileId,version:item.version});for(let i=saved.length-1;i>=0;i--)if(saved[i].fileId===item.fileId&&saved[i].version===item.version)saved.splice(i,1);insert.disabled=busy>0||!saved.length;status.textContent=result.message;await refresh()}catch(e){status.textContent=e.message}finally{remove.disabled=false}}
     row.append(name,info,retry,remove);materials.append(row)
    }
   }catch(e){if(dialog)status.textContent=e.message}
  }
  void refresh();timer=browser.setInterval(()=>void refresh(),3000)
  const dismiss=()=>{if(busy){status.textContent='文件正在上传，请等待完成或失败后关闭。';return}browser.clearInterval(timer);dialog?.close();dialog?.remove();dialog=null;button.focus()}
  close.onclick=dismiss;dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss()})
  insert.onclick=()=>{
   const text='\n'+saved.map(f=>`已上传任务材料：${f.name}（${f.path}）`).join('\n')+'\n'
   if(!inputActions.insertText(text,insertion)){status.textContent='输入内容已变化。文件已保存并加入任务，可关闭窗口后在文件列表查看。';return}
   inputActions.persistDraft();dismiss()
  }
  picker.onchange=()=>{
   for(const file of picker.files||[]){
    const row=doc.createElement('div'),name=doc.createElement('strong'),message=doc.createElement('span'),retry=doc.createElement('button'),cancel=doc.createElement('button'),state={controller:new AbortController()}
    name.textContent=file.name;retry.textContent='重试';retry.hidden=true;cancel.textContent='取消上传';row.append(name,message,retry,cancel);list.append(row)
    cancel.onclick=async()=>{if(state.finalizing)return;state.cancelled=true;state.controller.abort();cancel.disabled=true;if(state.id){try{const r=await browser.fetch(`/api/tasks/${taskId}/material-uploads/${state.id}`,{method:'DELETE',credentials:'include'});if(!r.ok)throw Error('取消未完成，请重试');message.textContent='已取消上传'}catch(e){message.textContent=e.message;state.cancelled=false;retry.hidden=false}}else message.textContent='已取消上传'}
    const run=async()=>{if(disposed||state.cancelled){busy--;insert.disabled=busy>0||!saved.length;return}message.textContent='正在上传…'
     try{
      const result=await uploadTaskFile(taskId,file,state,n=>{cancel.disabled=Boolean(state.finalizing);message.textContent=`上传 ${n}% · 正在保存并加入任务…`},browser)
      if(disposed)return
      saved.push(result);cancel.hidden=true;message.textContent='已保存到 OA · 已加入当前任务';void refresh()
     }catch(error){if(!disposed&&!state.cancelled){message.textContent=error.message;retry.hidden=false}}
     finally{busy--;if(!disposed)insert.disabled=busy>0||!saved.length}
    }
    const enqueue=()=>{busy++;retry.hidden=true;insert.disabled=true;message.textContent='等待上传…';queue=queue.then(run)}
    retry.onclick=()=>{state.cancelled=false;state.controller=new AbortController();enqueue()};enqueue()
   }
   picker.value=''
  }
  dialog.append(title,hint,picker,list,materials,status,insert,close);doc.body.append(dialog);dialog.showModal()
 }
 doc.addEventListener('click',click,true)
 return()=>{disposed=true;browser.clearInterval(timer);browser.clearTimeout(badgeTimer);badge.remove();doc.removeEventListener('click',click,true);dialog?.remove();dialog=null}
}

const inject = ['slots', 'theme', 'contextMenus']

const TITLE = '智慧办案 AI助手'
const CSS_ID = 'dsh-baiyou-brand/css'
const MARK = '<rect width="32" height="32" rx="9" fill="#3370ff"/><text x="16" y="23" text-anchor="middle" fill="white" font-size="23" font-family="sans-serif" font-weight="700">承</text>'
const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${MARK}</svg>`)}`

const EXACT = new Map([
  ['探索未至之境', '开始本次办案任务'],
  ['Into the Unknown', '开始本次办案任务'],
  ['预览版', ''],
  ['Preview', ''],
  ['Preview Notice', '使用说明'],
  ['配置 DeepSeek 官方模型，即可开始使用。', '模型由系统管理员统一配置。'],
  ['Configure the official DeepSeek provider to start building.', '模型由系统管理员统一配置。'],
  ['内测声明', '使用说明'],
  ['Internal Testing Notice', '使用说明'],
  ['HARNESS', '承业智慧办案'],
  ['DeepSeek Harness', '承业智慧办案'],
  ['DSH 本地构建', 'AI 助手'],
  ['DSH Local Build', 'AI 助手'],
])

const CSS = [
  'html[data-oa-harness-role=member] nav[class*="_panelList"]{display:none!important}',
  'html[data-oa-harness-role=member] [data-composer-card]:has(.oa-upload-trigger) button[class*="_add"]{display:none!important}.oa-upload-trigger{border:0;border-radius:50%;min-width:28px;height:28px;cursor:pointer;background:var(--dsw-alias-background-secondary,#f4f5f7);color:inherit;font-size:18px}.oa-upload-trigger[data-admin]{border-radius:6px;font-size:13px;padding:0 8px}',
  '.oa-material-badge{font-size:12px;color:var(--dsw-alias-label-secondary,#52617a);background:none;border:0;cursor:pointer;margin-left:6px}.oa-material-status>div{display:flex;flex-wrap:wrap;gap:8px;padding:12px 0;border-bottom:1px solid #dce2ee}.oa-material-status strong,.oa-material-status span{width:100%;overflow-wrap:anywhere}.oa-upload-dialog{width:min(620px,90vw);max-height:80vh;overflow:auto;padding:24px;border:1px solid #dce2ee;border-radius:16px;background:var(--dsw-alias-background-primary,#fff);color:var(--dsw-alias-label-primary,#182238)}.oa-upload-dialog::backdrop{background:#0006}.oa-upload-dialog p{line-height:1.7}.oa-upload-dialog button{margin:8px;padding:8px 12px;border:1px solid #ccc;border-radius:6px;cursor:pointer}.oa-upload-list>div{display:flex;flex-direction:column;gap:8px;padding:12px 0;overflow-wrap:anywhere}',
  '.by-mark{display:inline-flex;flex:none;border-radius:8px;overflow:hidden}',
  '.by-name{display:flex;flex-direction:column;justify-content:center;line-height:normal;gap:2px;min-width:0;white-space:nowrap}',
  '.by-name__zh{line-height:21px}.by-name__en{line-height:17px}',
  '[class*="_brandIdentity"]:has(.by-name){gap:10px}.by-name{text-align:left;letter-spacing:normal}.by-sidebar-mark text{font-size:20px;font-weight:400}',
  '[class*=\"_brandName\"]:has(.by-name),[class*=\"_brandIdentity\"]:has(.by-name){height:auto;min-height:36px}',
  '.by-name__zh{font-size:15px;font-weight:600;letter-spacing:normal;color:var(--dsw-alias-label-primary)}',
  '.by-name__en{font-size:12px;font-weight:400;letter-spacing:normal;color:var(--dsw-alias-label-secondary)}',
].join('')

function ensureCss() {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-baiyou-brand'
  tag.dataset.pluginCss = CSS_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

function markSvg(size) {
  const px = Number(size) || 24
  return `<svg class="by-mark" viewBox="0 0 32 32" width="${px}" height="${px}" aria-hidden="true">${MARK}</svg>`
}

function BrandMark({ size = 24, className = '' }) {
  ensureCss()
  const px = Number(size) || 24
  return jsxs('svg', {
    className: 'by-mark '+className,
    viewBox: '0 0 32 32',
    width: px,
    height: px,
    'aria-hidden': 'true',
    fill: 'none',
    dangerouslySetInnerHTML: { __html: MARK },
  })
}

function SidebarBrandMark() { return jsx(BrandMark, {size:32,className:'by-sidebar-mark'}) }

function BrandName() {
  ensureCss()
  return jsxs('span', {
    className: 'by-name',
    children: [
      jsx('span', { className: 'by-name__zh', children: '承业智慧办案' }),
      jsx('span', { className: 'by-name__en', children: 'AI 助手' }),
    ],
  })
}

function applyTitle() {
  if (typeof document === 'undefined') return
  if (document.title !== TITLE) document.title = TITLE
}

function applyFavicon() {
  if (typeof document === 'undefined') return
  // The native page declares separate light and dark icons. Replace both so
  // the browser cannot select an unbranded icon when its color scheme changes.
  let links = [...document.querySelectorAll('link[rel~="icon"]')]
  if (!links.length) {
    const link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
    links = [link]
  }
  for (const link of links) {
    link.type = 'image/svg+xml'
    if (link.getAttribute('href') !== FAVICON) link.setAttribute('href', FAVICON)
  }
}

function officialArtwork(svg) {
  if (svg.classList.contains('by-mark') || svg.closest('.by-mark')) return false
  const drawn = [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d') || '').join(' ')
  if (drawn.includes('48.8354')) return true
  if (drawn.startsWith('M22.403') || drawn.startsWith('M23.271')) return true
  const box = svg.getAttribute('viewBox') || ''
  return box === '26 0 156 24' || box === '0 0 182 24'
}

function replaceArtwork(svg) {
  if (svg.dataset.byPatched === '1') return
  svg.dataset.byPatched = '1'
  const box = svg.getAttribute('viewBox') || ''
  const wordmark = box === '26 0 156 24' || box === '0 0 182 24'
  if (wordmark) {
    const name = document.createElement('span')
    name.className = 'by-name'
    name.innerHTML = '<span class="by-name__zh">承业智慧办案</span><span class="by-name__en">AI 助手</span>'
    svg.replaceWith(name)
    return
  }
  const width = Number.parseFloat(svg.getAttribute('width') || '') || 24
  const holder = document.createElement('span')
  holder.innerHTML = markSvg(width)
  svg.replaceWith(holder.firstChild)
}

function patchLabels() {
  const nodes = document.querySelectorAll('span, p, h1, h2, div')
  for (const el of nodes) {
    if (el.childNodes.length !== 1 || el.firstChild.nodeType !== Node.TEXT_NODE) continue
    if (el.closest('textarea, input, pre, code, [contenteditable="true"]')) continue
    const text = el.textContent || ''
    if (/^单页内容超过 .+ 上限，无法读取$/.test(text)) { el.textContent = text.replace('单页内容', '文件内容') + '。请缩小文件后重试。'; continue }
    if (EXACT.has(text)) {
      const next = EXACT.get(text)
      if (!next) {
        el.hidden = true
        continue
      }
      if (text !== next) el.textContent = next
      continue
    }
    if (text.includes('DeepSeek Harness') && text.length > 80) {
      el.textContent = text.replaceAll('DeepSeek Harness', '承业智慧办案')
    }
  }
}

function patchOfficialDom() {
  if (typeof document === 'undefined') return
  ensureCss()
  applyTitle()
  applyFavicon()
  document.querySelectorAll('svg').forEach((svg) => {
    if (officialArtwork(svg)) replaceArtwork(svg)
  })
  patchLabels()
}

// Shadow the upstream onboarding step using its public slot contract. This
// completes the coordinator without showing a modal or storing fake acceptance.
function SkipPreviewNotice({ complete }) {
  useEffect(() => { complete() }, [complete])
  return null
}
function HiddenSettings() { return null }

function apply(ctx) {
  registerOaFileSync(ctx)
  function UploadBinding({inputActions,sessionId}) {
    const anchor=useRef(null),isAdmin=window.__oaHarness?.isSuperAdmin===true
    useEffect(()=>bindOaUpload(ctx,inputActions,window,anchor.current),[inputActions,sessionId])
    return jsx('button',{ref:anchor,type:'button',className:'oa-upload-trigger','data-admin':isAdmin?'':undefined,'aria-label':'上传文件到 OA 和当前任务',children:isAdmin?'上传文件':'＋'})
  }
  ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({name:'conversation.input.left',id:'oa-upload'},UploadBinding))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', id: 'welcome-notice', order: -100, priority: -10,
  }, SkipPreviewNotice))
  // Hide the owning settings surface too: keyboard shortcuts must not open it.
  // This flag is injected by the authenticated OA proxy before the native app boots.
  const ModelLabel = () => jsx('span',{'aria-label':'任务模型',children:window.__oaHarness?.model||'任务模型未配置'})
  ctx.slots.inject('conversation.input.model',()=>ctx.slots.register({name:'conversation.input.model',priority:-100},ModelLabel))
  ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'models',order:10,priority:-100,label:()=>'模型'},()=>jsx('p',{children:'请到智慧办案「授权与 AI 管理」配置模型连接及任务策略。'})))
  if (window.__oaHarness?.isSuperAdmin !== true) {
    for (const name of ['conversation.hero.agentPreset','conversation.input.permission']) {
      ctx.slots.inject(name, () => ctx.slots.register({name,priority:-100},HiddenSettings))
    }
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({name:'conversation.session.header.actions',id:'agent-preset',priority:-100},HiddenSettings))
    document.documentElement.dataset.oaHarnessRole = 'member'
    for (const id of ['plugins','schedules']) {
      ctx.slots.inject('main', () => ctx.slots.register({name:'main',key:id,priority:-100},HiddenSettings))
    }
    ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
      name: 'sidebar.settings', priority: -10,
    }, HiddenSettings))
  }

  const syncTheme = event => ctx.theme.setTheme(event?.detail || window.__oaTheme || 'light');
  window.addEventListener('oa-theme-change', syncTheme);
  if (window.__oaTheme) syncTheme();
  const themeScript = document.createElement('script');
  themeScript.src = '/api/oa/theme.js';
  document.head.appendChild(themeScript);
  ctx.effect(() => () => { window.removeEventListener('oa-theme-change', syncTheme); themeScript.remove(); }, 'oa-theme-sync');
  ensureCss()
  applyTitle()
  applyFavicon()
  patchOfficialDom()
  const timer = setInterval(patchOfficialDom, 1500)
  ctx.effect(() => () => clearInterval(timer), 'dsh-baiyou-brand: title')

  const brandSeat = { priority: -1 }
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', function* () {
    yield ctx.slots.register({ name: 'sidebar.brand.mark', ...brandSeat }, SidebarBrandMark)
    yield ctx.slots.register({ name: 'sidebar.brand.name', ...brandSeat }, BrandName)
  }))
  ctx.slots.inject('conversation.hero.brand.mark', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.brand.mark', ...brandSeat }, BrandMark)
  })

  if (typeof document !== 'undefined') {
    const observer = new MutationObserver(patchOfficialDom)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    ctx.effect(() => () => observer.disconnect(), 'oa-brand: observer')
  }
}

exports.inject = inject; exports.apply = apply;
return module.exports; } });
