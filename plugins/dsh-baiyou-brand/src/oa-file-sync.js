// Native file menus use workspace paths; the OA broker accepts reviewed snapshot keys.
// Never turn a displayed file path directly into an upload request.
export function outputPath(path) {
  if (typeof path !== 'string' || /[\\\0]/.test(path)) return null
  const relative = path.startsWith('/workspace/') ? path.slice(11) : path
  const parts = relative.split('/')
  if (!['reports', 'drafts'].includes(parts[0]) || parts.length < 2 ||
      parts.some(part => !part || part === '.' || part === '..')) return null
  return relative
}

export function registerOaFileSync(ctx, browser = window) {
  const taskId = /^\/harness\/([a-f0-9-]{36})(?:\/|$)/i.exec(browser.location.pathname)?.[1]
  if (!taskId) return
  const pending = new Set()
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
              ctx.contextMenus.notify('此版本已同步，请到承业空间 → 我的资源 → 我的文件查看。', true)
              return
            }
            if (!browser.confirm(`同步OA工作空间\n\n文件：${file.path}\n大小：${Math.ceil(file.size / 1024)} KB\n当前版本：${file.sha256.slice(0, 10)}\n\n保存到：承业空间 → 我的资源 → 我的文件\n只同步这份文件的当前版本；后续修改不会自动同步。此操作不等同于正式归档。\n\n确认同步？`)) return
            ctx.contextMenus.notify('正在同步到 OA，请稍候…', true)
            const task = await api('save', { selection: [file.key] })
            if (task.outputs?.[file.key]?.status !== 'SAVED') throw Error('尚未确认保存成功，请刷新成果列表后重试。')
            ctx.contextMenus.notify(`“${file.name}”已同步到承业空间 → 我的资源 → 我的文件。`, true)
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
