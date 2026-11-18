import type { ExternalLink } from '@/types'

/** 外部入口走工作台同源路径，由 case-service 鉴权后 302。
 * 云上网关把 /api 反代到本机 5181；助手/知识库控制台用子域名，避免与 /api 冲突。
 */
export const EXTERNAL_LINKS: Record<ExternalLink['id'], ExternalLink> = {
  ai_assistant: {
    id: 'ai_assistant',
    label: 'AI 助手',
    href: '/api/go/ai',
    description: '进入鉴定助手。会话按案件权限与数据共享组显示。',
  },
  knowledge_base: {
    id: 'knowledge_base',
    label: '知识库管理',
    href: '/api/go/kb',
    description: '仅平台维护者与公共库管理员可打开知识库控制台。',
  },
}

/** case-service 地址。开发时由 Vite 把 /api 代理到 127.0.0.1:5181；生产走相对路径。 */
export const CASE_SERVICE_BASE = ''

/** 本机工作台（127.0.0.1/localhost）。公网经 frp 访问时返回 false。 */
export function isLocalWorkbench(): boolean {
  return /^(127\.0\.0\.1|localhost)$/i.test(window.location.hostname)
}
